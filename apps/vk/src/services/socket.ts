// SPDX-License-Identifier: AGPL-3.0-only
import { io, type Socket } from "socket.io-client";
import type { ServerToClientEvents, ClientToServerEvents } from "@samur/shared";

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: AppSocket | null = null;

export function connectSocket(): AppSocket {
  if (socket?.connected) return socket;

  socket = io(window.location.origin, {
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 2_000,
    reconnectionDelayMax: 30_000,
  }) as AppSocket;

  socket.on("connect", () => {
    console.log("VK Socket.IO connected");
  });

  socket.on("disconnect", (reason) => {
    console.log(`VK Socket.IO disconnected: ${reason}`);
  });

  return socket;
}

export function getSocket(): AppSocket | null {
  return socket;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
