// SPDX-License-Identifier: AGPL-3.0-only
import { getOutboxEntries, removeFromOutbox, incrementOutboxRetry } from "./db.js";

const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 5_000; // 5s, 10s, 20s, 40s, 80s

function getToken(): string | null {
  try {
    const raw = localStorage.getItem("auth");
    if (!raw) return null;
    return JSON.parse(raw)?.state?.token ?? null;
  } catch {
    return null;
  }
}

/** Compute exponential backoff delay for a given retry count */
function backoffMs(retryCount: number): number {
  return BASE_BACKOFF_MS * Math.pow(2, retryCount);
}

/** Deduplicate entries: if multiple entries target the same endpoint+method, keep only the latest */
function deduplicateEntries<T extends { endpoint: string; method: string; createdAt?: number; id: string }>(
  entries: T[],
): { keep: T[]; duplicateIds: string[] } {
  const seen = new Map<string, T>();
  const duplicateIds: string[] = [];

  for (const entry of entries) {
    const key = `${entry.method}:${entry.endpoint}`;
    const existing = seen.get(key);
    if (existing) {
      // Keep the newer one (higher createdAt or later in array)
      duplicateIds.push(existing.id);
      seen.set(key, entry);
    } else {
      seen.set(key, entry);
    }
  }
  return { keep: [...seen.values()], duplicateIds };
}

export async function syncOutbox(): Promise<{ synced: number; failed: number }> {
  const allEntries = await getOutboxEntries();
  let synced = 0;
  let failed = 0;

  // Deduplicate — remove older entries for same endpoint+method
  const { keep: entries, duplicateIds } = deduplicateEntries(allEntries);
  for (const id of duplicateIds) {
    await removeFromOutbox(id);
  }

  for (const entry of entries) {
    if (entry.retryCount >= MAX_RETRIES) {
      await removeFromOutbox(entry.id); // give up after max retries
      failed++;
      continue;
    }

    // Exponential backoff: skip if not enough time has passed since last retry
    if (entry.retryCount > 0 && entry.lastRetryAt) {
      const elapsed = Date.now() - entry.lastRetryAt;
      if (elapsed < backoffMs(entry.retryCount - 1)) {
        continue; // not ready to retry yet
      }
    }

    try {
      const token = getToken();
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      if (entry.body) headers["Content-Type"] = "application/json";

      const res = await fetch(`/api/v1${entry.endpoint}`, {
        method: entry.method,
        headers,
        body: entry.body ? JSON.stringify(entry.body) : undefined,
      });

      if (res.ok) {
        await removeFromOutbox(entry.id);
        synced++;
      } else if (res.status >= 500) {
        // Server error — retry with backoff
        await incrementOutboxRetry(entry.id);
        failed++;
      } else {
        // Client error (4xx) — don't retry, discard
        await removeFromOutbox(entry.id);
        failed++;
      }
    } catch {
      // Network error — retry with backoff
      await incrementOutboxRetry(entry.id);
      failed++;
    }
  }

  return { synced, failed };
}

// Poll-based sync fallback when Background Sync API is not available
let pollInterval: ReturnType<typeof setInterval> | null = null;

export function startOutboxPolling() {
  if (pollInterval) return;
  pollInterval = setInterval(async () => {
    if (navigator.onLine) {
      await syncOutbox();
    }
  }, 30_000);
}

export function stopOutboxPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}
