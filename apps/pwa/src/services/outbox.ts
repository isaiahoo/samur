// SPDX-License-Identifier: AGPL-3.0-only
import { getOutboxEntries, removeFromOutbox, incrementOutboxRetry } from "./db.js";

const MAX_RETRIES = 3;

function getToken(): string | null {
  try {
    const raw = localStorage.getItem("auth");
    if (!raw) return null;
    return JSON.parse(raw)?.state?.token ?? null;
  } catch {
    return null;
  }
}

export async function syncOutbox(): Promise<{ synced: number; failed: number }> {
  const entries = await getOutboxEntries();
  let synced = 0;
  let failed = 0;

  for (const entry of entries) {
    if (entry.retryCount >= MAX_RETRIES) {
      failed++;
      continue;
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
      } else if (res.status >= 400 && res.status < 500) {
        // Client error — don't retry
        await removeFromOutbox(entry.id);
        failed++;
      } else {
        await incrementOutboxRetry(entry.id);
        failed++;
      }
    } catch {
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
