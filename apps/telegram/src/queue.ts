// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Persistent queue for submissions when the API is unreachable.
 * Stored in Redis. Retries with exponential backoff, max 10 retries.
 */

import { redis } from "./redis.js";
import crypto from "node:crypto";

const QUEUE_KEY = "tg:queue";
const MAX_RETRIES = 10;
const BASE_BACKOFF_MS = 5_000;

interface QueueEntry {
  id: string;
  chatId: number;
  method: string;
  path: string;
  body: unknown;
  token: string;
  retries: number;
  createdAt: number;
  lastRetryAt?: number;
}

function backoffMs(retries: number): number {
  return BASE_BACKOFF_MS * 2 ** Math.min(retries, 8);
}

export async function enqueue(
  chatId: number,
  method: string,
  path: string,
  body: unknown,
  token: string,
): Promise<void> {
  const entry: QueueEntry = {
    id: crypto.randomUUID(),
    chatId,
    method,
    path,
    body,
    token,
    retries: 0,
    createdAt: Date.now(),
  };
  await redis.rpush(QUEUE_KEY, JSON.stringify(entry));
}

let timer: ReturnType<typeof setInterval> | null = null;
let processFn: ((entry: QueueEntry) => Promise<boolean>) | null = null;

export function startQueueProcessor(
  fn: (entry: QueueEntry) => Promise<boolean>,
): void {
  processFn = fn;
  if (timer) return;
  timer = setInterval(processQueue, 30_000);
}

export function stopQueueProcessor(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

async function processQueue(): Promise<void> {
  if (!processFn) return;

  const raw = await redis.lrange(QUEUE_KEY, 0, -1);
  if (raw.length === 0) return;

  const entries: QueueEntry[] = raw.map((r) => JSON.parse(r));
  const now = Date.now();
  const keep: QueueEntry[] = [];

  for (const entry of entries) {
    // Respect backoff
    if (entry.lastRetryAt && now - entry.lastRetryAt < backoffMs(entry.retries)) {
      keep.push(entry);
      continue;
    }

    try {
      const ok = await processFn(entry);
      if (!ok) {
        entry.retries++;
        entry.lastRetryAt = now;
        if (entry.retries < MAX_RETRIES) {
          keep.push(entry);
        }
      }
    } catch {
      entry.retries++;
      entry.lastRetryAt = now;
      if (entry.retries < MAX_RETRIES) {
        keep.push(entry);
      }
    }
  }

  // Replace queue atomically
  const multi = redis.multi();
  multi.del(QUEUE_KEY);
  if (keep.length > 0) {
    multi.rpush(QUEUE_KEY, ...keep.map((e) => JSON.stringify(e)));
  }
  await multi.exec();
}

export async function getQueueSize(): Promise<number> {
  return redis.llen(QUEUE_KEY);
}
