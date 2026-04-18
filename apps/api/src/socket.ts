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

type SamurSocket = Socket<ClientToServerEvents, ServerToClientEvents> & {
  userId?: string;
  /** Lazily resolved on first typing event — one DB hit per session. */
  userName?: string;
  geoSub?: { lat: number; lng: number; radius: number };
};

let io: Server<ClientToServerEvents, ServerToClientEvents> | null = null;

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

  // Authenticate Socket.IO connections via JWT
  io.use((socket, next) => {
    const token = socket.handshake.auth.token as string | undefined;
    if (!token) {
      return next(new Error("Требуется авторизация"));
    }
    try {
      const payload = jwt.verify(token, config.JWT_SECRET) as JwtPayload;
      (socket as SamurSocket).userId = payload.sub;
      next();
    } catch {
      next(new Error("Недействительный токен"));
    }
  });

  io.on("connection", (rawSocket) => {
    const socket = rawSocket as SamurSocket;
    logger.debug({ socketId: socket.id }, "Socket connected");

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

    // Transient typing signal — not persisted. Client throttles to at
    // most once every 3 s per chat; we just resolve the sender's name
    // (lazily, cached per socket) and rebroadcast so other participants
    // can render "X печатает…". Authenticated-only; no DB access check
    // for the specific help-request (cost isn't worth the protection
    // — a malicious authenticated user could at most spoof their own
    // typing indicator into a chat, no data exfiltration).
    socket.on("help:typing", async (payload) => {
      if (!socket.userId) return;
      if (!payload || typeof payload.helpRequestId !== "string") return;
      if (payload.helpRequestId.length === 0 || payload.helpRequestId.length > 64) return;

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

      socket.broadcast.emit("help:typing", {
        helpRequestId: payload.helpRequestId,
        userId: socket.userId,
        userName: socket.userName,
      });
    });

    socket.on("disconnect", () => {
      logger.debug({ socketId: socket.id }, "Socket disconnected");
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
