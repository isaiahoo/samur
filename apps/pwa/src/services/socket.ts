// SPDX-License-Identifier: AGPL-3.0-only
import { io, Socket } from "socket.io-client";
import type { ServerToClientEvents, ClientToServerEvents } from "@samur/shared";

export type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: TypedSocket | null = null;

export function getSocket(): TypedSocket {
  if (!socket) {
    const token = (() => {
      try {
        const raw = localStorage.getItem("auth");
        return raw ? JSON.parse(raw)?.state?.token : undefined;
      } catch {
        return undefined;
      }
    })();

    socket = io({
      path: "/socket.io",
      auth: token ? { token } : {},
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    });
  }
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
