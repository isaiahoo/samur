// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef } from "react";
import { getSocket, type TypedSocket } from "../services/socket.js";
import type { ServerToClientEvents } from "@samur/shared";

type EventName = keyof ServerToClientEvents;

export function useSocketEvent<K extends EventName>(
  event: K,
  handler: ServerToClientEvents[K],
) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const socket = getSocket();
    const wrapper = (...args: unknown[]) => {
      (handlerRef.current as (...a: unknown[]) => void)(...args);
    };
    (socket as unknown as { on: (ev: string, fn: (...args: unknown[]) => void) => void }).on(event, wrapper);
    return () => {
      (socket as unknown as { off: (ev: string, fn: (...args: unknown[]) => void) => void }).off(event, wrapper);
    };
  }, [event]);
}

export function useSocketSubscription(lat: number | null, lng: number | null, radius: number) {
  const socketRef = useRef<TypedSocket | null>(null);

  useEffect(() => {
    if (lat == null || lng == null) return;

    const socket = getSocket();
    socketRef.current = socket;

    socket.emit("subscribe:area", { lat, lng, radius });

    return () => {
      socket.emit("unsubscribe:area");
    };
  }, [lat, lng, radius]);
}
