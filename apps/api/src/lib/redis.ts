// SPDX-License-Identifier: AGPL-3.0-only
import { Redis } from "ioredis";
import { config } from "../config.js";
import { logger } from "./logger.js";

let client: Redis | null = null;

export function getRedis(): Redis | null {
  if (client) return client;

  try {
    client = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 5) return null;
        return Math.min(times * 200, 2000);
      },
    });

    client.on("error", (err) => {
      logger.error({ err: err.message }, "Redis (shared) error");
    });

    return client;
  } catch {
    return null;
  }
}
