// SPDX-License-Identifier: AGPL-3.0-only
import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import type { Redis } from "ioredis";
import type { ServerToClientEvents, ClientToServerEvents } from "@samur/shared";
import { logger } from "./lib/logger.js";

type SamurSocket = Socket<ClientToServerEvents, ServerToClientEvents> & {
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

  io.on("connection", (rawSocket) => {
    const socket = rawSocket as SamurSocket;
    logger.debug({ socketId: socket.id }, "Socket connected");

    socket.on("subscribe:area", (sub) => {
      if (
        typeof sub.lat !== "number" || typeof sub.lng !== "number" ||
        typeof sub.radius !== "number" || sub.radius <= 0
      ) {
        return;
      }
      socket.geoSub = { lat: sub.lat, lng: sub.lng, radius: sub.radius };
    });

    socket.on("unsubscribe:area", () => {
      socket.geoSub = undefined;
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
