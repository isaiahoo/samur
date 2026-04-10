// SPDX-License-Identifier: AGPL-3.0-only

/**
 * localStorage-based offline queue for VK Mini App.
 * Stores failed API submissions and retries them when online.
 */

const QUEUE_KEY = "samur:vk:outbox";
const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 5_000;

interface QueueEntry {
  id: string;
  endpoint: string;
  method: "POST" | "PATCH";
  body: Record<string, unknown>;
  createdAt: number;
  retryCount: number;
  lastRetryAt?: number;
}

function getEntries(): QueueEntry[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveEntries(entries: QueueEntry[]): void {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(entries));
}

export function addToQueue(
  endpoint: string,
  method: "POST" | "PATCH",
  body: Record<string, unknown>,
): void {
  const entries = getEntries();
  entries.push({
    id: crypto.randomUUID(),
    endpoint,
    method,
    body,
    createdAt: Date.now(),
    retryCount: 0,
  });
  saveEntries(entries);
}

export function getQueueSize(): number {
  return getEntries().length;
}

function backoffMs(retries: number): number {
  return BASE_BACKOFF_MS * 2 ** Math.min(retries, 8);
}

export async function flushQueue(
  doRequest: (endpoint: string, method: string, body: Record<string, unknown>) => Promise<boolean>,
): Promise<number> {
  const entries = getEntries();
  if (entries.length === 0) return 0;

  const now = Date.now();
  const keep: QueueEntry[] = [];
  let flushed = 0;

  for (const entry of entries) {
    // Respect backoff
    if (entry.lastRetryAt && now - entry.lastRetryAt < backoffMs(entry.retryCount)) {
      keep.push(entry);
      continue;
    }

    try {
      const ok = await doRequest(entry.endpoint, entry.method, entry.body);
      if (ok) {
        flushed++;
      } else {
        entry.retryCount++;
        entry.lastRetryAt = now;
        if (entry.retryCount < MAX_RETRIES) {
          keep.push(entry);
        }
      }
    } catch {
      entry.retryCount++;
      entry.lastRetryAt = now;
      if (entry.retryCount < MAX_RETRIES) {
        keep.push(entry);
      }
    }
  }

  saveEntries(keep);
  return flushed;
}

// Auto-flush when coming back online
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    // Import api dynamically to avoid circular deps
    import("./api").then(({ createIncident, createHelpRequest }) => {
      flushQueue(async (endpoint, _method, body) => {
        try {
          if (endpoint === "/incidents") {
            await createIncident(body);
          } else if (endpoint === "/help-requests") {
            await createHelpRequest(body);
          }
          return true;
        } catch {
          return false;
        }
      });
    });
  });
}
