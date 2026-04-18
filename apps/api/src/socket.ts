// SPDX-License-Identifier: AGPL-3.0-only
import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import jwt from "jsonwebtoken";
import type { Redis } from "ioredis";
import type { ServerToClientEvents, ClientToServerEvents, JwtPayload } from "@samur/shared";
import { prisma } from "@samur/db";
import { config } from "./config.js";
import { logger } from "./lib/logger.js";
import { isHelpChatParticipant } from "./lib/helpAccess.js";
import { getTokenVersion } from "./lib/tokenVersion.js";
import { wsConnectionsGauge } from "./lib/metrics.js";

type SamurSocket = Socket<ClientToServerEvents, ServerToClientEvents> & {
  userId?: string;
  userRole?: string;
  /** Lazily resolved on first typing event — one DB hit per session. */
  userName?: string;
  geoSub?: { lat: number; lng: number; radius: number };
};

let io: Server<ClientToServerEvents, ServerToClientEvents> | null = null;

/** Room name for per-user fan-out (notifications, forced leave). Every
 * authenticated socket auto-joins its own user-room on connect, so the
 * server can target "this user, wherever their tabs are" by name. */
export function userRoom(userId: string): string {
  return `user:${userId}`;
}

/** Room name for a help-request chat. Populated via the help:subscribe
 * handler, which is gated by participant-access check. */
export function helpRoom(helpRequestId: string): string {
  return `help:${helpRequestId}`;
}

/** Force every socket belonging to a user out of a help-request room.
 * Called after a responder cancels so they stop receiving realtime
 * messages (their historical cache survives — that's by design). */
export async function evictUserFromHelpRoom(userId: string, helpRequestId: string): Promise<void> {
  if (!io) return;
  const sockets = await io.in(userRoom(userId)).fetchSockets();
  const room = helpRoom(helpRequestId);
  for (const s of sockets) {
    s.leave(room);
  }
}

/** Tear down a help-request room entirely. Used when a request is
 * soft-deleted — any subscribers stop receiving events, and the next
 * help:subscribe will fail the access check (deletedAt IS NOT NULL).
 *
 * Best-effort and fire-and-forget on the multi-node (Redis adapter)
 * path: the broadcast to peer nodes is async, but socket.io-redis
 * doesn't expose a completion promise. Callers should not assume peer
 * nodes have evicted by the time this returns — soft-delete already
 * blocks new POSTs, so any in-flight emit from another node is
 * harmless. */
export function clearHelpRoom(helpRequestId: string): void {
  if (!io) return;
  io.in(helpRoom(helpRequestId)).socketsLeave(helpRoom(helpRequestId));
}

/** Force-disconnect every open socket belonging to a user. Called
 * after a tokenVersion bump (logout-all, role change, admin force-
 * logout) so the user's realtime channel doesn't survive the HTTP
 * revocation — otherwise a revoked session could keep receiving chat
 * messages and broadcasts until the socket naturally closed.
 *
 * The Redis adapter propagates this across nodes. Matches the fire-
 * and-forget contract of clearHelpRoom. */
export function disconnectUserSockets(userId: string): void {
  if (!io) return;
  io.in(userRoom(userId)).disconnectSockets(true);
}


export function initSocketIO(
  httpServer: HttpServer,
  corsOrigins: string[],
  redisClient: Redis | null
): Server<ClientToServerEvents, ServerToClientEvents> {
  io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: {
      origin: corsOrigins,
      methods: ["GET", "POST"],
    },
    transports: ["websocket", "polling"],
  });

  if (redisClient) {
    const pubClient = redisClient.duplicate();
    const subClient = redisClient.duplicate();
    io.adapter(createAdapter(pubClient, subClient));
    logger.info("Socket.IO using Redis adapter");
  } else {
    logger.warn("Socket.IO using in-memory adapter (Redis unavailable)");
  }

  // Authenticate Socket.IO connections via JWT. Algorithm pinned to
  // HS256 explicitly — without it, a forged token claiming "alg":"none"
  // or "alg":"RS256" with the secret-as-pubkey trick could pass verify
  // on some jsonwebtoken config paths. Also verifies the token's
  // tokenVersion against the user's current value, so a revoked
  // session can't open a new socket with its old credentials.
  io.use(async (socket, next) => {
    const token = socket.handshake.auth.token as string | undefined;
    if (!token) {
      return next(new Error("Требуется авторизация"));
    }
    try {
      const payload = jwt.verify(token, config.JWT_SECRET, {
        algorithms: ["HS256"],
      }) as JwtPayload;
      const current = await getTokenVersion(payload.sub);
      if (current === null || (payload.tokenVersion ?? 0) < current) {
        return next(new Error("Сессия отозвана"));
      }
      (socket as SamurSocket).userId = payload.sub;
      (socket as SamurSocket).userRole = payload.role;
      next();
    } catch {
      next(new Error("Недействительный токен"));
    }
  });

  io.on("connection", (rawSocket) => {
    const socket = rawSocket as SamurSocket;
    logger.debug({ socketId: socket.id }, "Socket connected");
    wsConnectionsGauge.inc();

    // Auto-join the user's own room so the server can target this user
    // across every tab they have open (fan-out for notify events and
    // forced room eviction on response cancel).
    if (socket.userId) {
      socket.join(userRoom(socket.userId));
    }

    socket.on("subscribe:area", (sub) => {
      if (
        typeof sub.lat !== "number" || typeof sub.lng !== "number" ||
        typeof sub.radius !== "number" || sub.radius <= 0 ||
        Math.abs(sub.lat) > 90 || Math.abs(sub.lng) > 180 ||
        sub.radius > 50_000_000
      ) {
        return;
      }
      socket.geoSub = { lat: sub.lat, lng: sub.lng, radius: sub.radius };
    });

    socket.on("unsubscribe:area", () => {
      socket.geoSub = undefined;
    });

    // ── Help-request chat rooms ────────────────────────────────────
    // subscribe: verify caller is a participant (author / non-cancelled
    // responder / coordinator / admin), then join help:${id}. Must be
    // re-emitted on every socket reconnect since rooms don't persist.
    socket.on("help:subscribe", async (payload) => {
      if (!socket.userId) return;
      if (!payload || typeof payload.helpRequestId !== "string") return;
      const helpRequestId = payload.helpRequestId;
      if (helpRequestId.length === 0 || helpRequestId.length > 64) return;
      try {
        const allowed = await isHelpChatParticipant(helpRequestId, {
          id: socket.userId,
          role: socket.userRole,
        });
        if (!allowed) return;
        socket.join(helpRoom(helpRequestId));
      } catch {
        // Silent — socket handlers don't propagate errors to clients.
      }
    });

    socket.on("help:unsubscribe", (payload) => {
      if (!payload || typeof payload.helpRequestId !== "string") return;
      socket.leave(helpRoom(payload.helpRequestId));
    });

    // Transient typing signal. Gate: the socket must already be in the
    // help-request room — i.e. a prior help:subscribe passed the
    // participant check. This prevents typing-indicator spoofing into
    // conversations the caller is not part of, AND prevents non-
    // participants from listening to typing events (the rebroadcast now
    // targets the room, not `socket.broadcast`).
    socket.on("help:typing", async (payload) => {
      if (!socket.userId) return;
      if (!payload || typeof payload.helpRequestId !== "string") return;
      const room = helpRoom(payload.helpRequestId);
      if (!socket.rooms.has(room)) return;

      if (!socket.userName) {
        try {
          const u = await prisma.user.findUnique({
            where: { id: socket.userId },
            select: { name: true },
          });
          socket.userName = u?.name ?? "";
        } catch {
          return;
        }
      }

      socket.to(room).emit("help:typing", {
        helpRequestId: payload.helpRequestId,
        userId: socket.userId,
        userName: socket.userName,
      });
    });

    socket.on("disconnect", () => {
      logger.debug({ socketId: socket.id }, "Socket disconnected");
      wsConnectionsGauge.dec();
    });
  });

  return io;
}

export function getIO(): Server<ClientToServerEvents, ServerToClientEvents> {
  if (!io) {
    throw new Error("Socket.IO not initialized — call initSocketIO first");
  }
  return io;
}
