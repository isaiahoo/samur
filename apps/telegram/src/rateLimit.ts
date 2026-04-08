// SPDX-License-Identifier: AGPL-3.0-only
import { config } from "./config.js";

// Sliding window rate limit: max N reports per user per hour
const windows = new Map<number, number[]>();

export function checkRateLimit(chatId: number): boolean {
  const now = Date.now();
  const cutoff = now - 3600_000;
  const timestamps = (windows.get(chatId) ?? []).filter((t) => t > cutoff);
  windows.set(chatId, timestamps);
  return timestamps.length < config.MAX_REPORTS_PER_HOUR;
}

export function recordAction(chatId: number): void {
  const now = Date.now();
  const cutoff = now - 3600_000;
  const timestamps = (windows.get(chatId) ?? []).filter((t) => t > cutoff);
  timestamps.push(now);
  windows.set(chatId, timestamps);
}
