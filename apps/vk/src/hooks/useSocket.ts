// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef } from "react";
import { getSocket } from "../services/socket";
import type { ServerToClientEvents } from "@samur/shared";

/**
 * Subscribe to a Socket.IO event. The callback is stable across re-renders
 * (uses a ref internally). Automatically cleans up on unmount.
 */
export function useSocketEvent<K extends keyof ServerToClientEvents>(
  event: K,
  callback: ServerToClientEvents[K],
): void {
  const cbRef = useRef(callback);
  cbRef.current = callback;

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    // Use type assertion to work with Socket.IO's typed event system
    const handler = (...args: unknown[]) => {
      (cbRef.current as (...a: unknown[]) => void)(...args);
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (socket as any).on(event, handler);
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (socket as any).off(event, handler);
    };
  }, [event]);
}
