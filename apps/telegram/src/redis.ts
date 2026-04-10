// SPDX-License-Identifier: AGPL-3.0-only
import Redis from "ioredis";
import { config } from "./config.js";

export const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
});

redis.on("error", (err) => {
  console.error("Redis error:", err.message);
});

redis.on("connect", () => {
  console.log("Redis connected");
});
