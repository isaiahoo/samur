// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Local queue for submissions when the API is unreachable.
 * Retries every 30 seconds, max 10 retries per entry.
 */

interface QueueEntry {
  id: number;
  chatId: number;
  method: string;
  path: string;
  body: unknown;
  token: string;
  retries: number;
  createdAt: number;
}

let nextId = 1;
const queue: QueueEntry[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
let processFn: ((entry: QueueEntry) => Promise<boolean>) | null = null;

export function enqueue(
  chatId: number,
  method: string,
  path: string,
  body: unknown,
  token: string,
): void {
  queue.push({
    id: nextId++,
    chatId,
    method,
    path,
    body,
    token,
    retries: 0,
    createdAt: Date.now(),
  });
}

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
  if (!processFn || queue.length === 0) return;

  const batch = [...queue];
  for (const entry of batch) {
    try {
      const ok = await processFn(entry);
      if (ok) {
        const idx = queue.indexOf(entry);
        if (idx !== -1) queue.splice(idx, 1);
      } else {
        entry.retries++;
        if (entry.retries >= 10) {
          const idx = queue.indexOf(entry);
          if (idx !== -1) queue.splice(idx, 1);
        }
      }
    } catch {
      entry.retries++;
      if (entry.retries >= 10) {
        const idx = queue.indexOf(entry);
        if (idx !== -1) queue.splice(idx, 1);
      }
    }
  }
}

export function getQueueSize(): number {
  return queue.length;
}
