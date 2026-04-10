// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shared HTTP fetch helper with retry, timeout, and abort support.
 * Replaces 5 duplicate fetchJSON implementations across weather/API clients.
 */

import { logger } from "./logger.js";

const log = logger.child({ service: "fetch" });

const DEFAULT_TIMEOUT = 15_000;
const DEFAULT_RETRIES = 2;

export interface FetchJSONOptions {
  /** Request timeout in ms (default: 15000) */
  timeout?: number;
  /** Max retries on failure (default: 2) */
  retries?: number;
  /** Service name for log context */
  service?: string;
}

/**
 * Fetch JSON from a URL with retry logic, timeout, and exponential backoff.
 * Returns null on failure after all retries are exhausted.
 */
export async function fetchJSON<T>(
  url: string,
  opts: FetchJSONOptions = {},
): Promise<T | null> {
  const { timeout = DEFAULT_TIMEOUT, retries = DEFAULT_RETRIES, service } = opts;
  const ctx = service ? { service } : {};

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "User-Agent": "Samur-FloodMonitor/1.0 (flood relief platform)",
        },
      });
      clearTimeout(timer);

      if (!res.ok) {
        log.warn({ ...ctx, url: url.slice(0, 120), status: res.status, attempt }, "HTTP error");
        continue;
      }

      return (await res.json()) as T;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ ...ctx, attempt, error: msg }, "Fetch failed");
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
  }
  return null;
}
