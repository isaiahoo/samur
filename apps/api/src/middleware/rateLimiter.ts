// SPDX-License-Identifier: AGPL-3.0-only
import type { Request, Response, NextFunction } from "express";
import { RateLimiterRedis, RateLimiterMemory } from "rate-limiter-flexible";
import type { Redis } from "ioredis";
import { logger } from "../lib/logger.js";

const LIMITS = {
  anonymous: { points: 30, duration: 60 },
  authenticated: { points: 120, duration: 60 },
  coordinator: { points: 600, duration: 60 },
} as const;

let limiters: Record<string, RateLimiterRedis | RateLimiterMemory>;

export function initRateLimiter(redisClient: Redis | null): void {
  const create = (key: string, opts: { points: number; duration: number }) => {
    if (redisClient) {
      return new RateLimiterRedis({
        storeClient: redisClient,
        keyPrefix: `samur_rl_${key}`,
        points: opts.points,
        duration: opts.duration,
        blockDuration: 30,
      });
    }
    return new RateLimiterMemory({
      keyPrefix: `samur_rl_${key}`,
      points: opts.points,
      duration: opts.duration,
      blockDuration: 30,
    });
  };

  limiters = {
    anonymous: create("anon", LIMITS.anonymous),
    authenticated: create("auth", LIMITS.authenticated),
    coordinator: create("coord", LIMITS.coordinator),
  };

  if (!redisClient) {
    logger.warn("Rate limiter using in-memory store (Redis unavailable)");
  }
}

export async function rateLimiterMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!limiters) {
    return next();
  }

  const user = req.user;
  let limiterKey: string;
  let consumeKey: string;

  if (!user) {
    limiterKey = "anonymous";
    consumeKey = req.ip ?? "unknown";
  } else if (user.role === "coordinator" || user.role === "admin") {
    limiterKey = "coordinator";
    consumeKey = user.sub;
  } else {
    limiterKey = "authenticated";
    consumeKey = user.sub;
  }

  try {
    const result = await limiters[limiterKey].consume(consumeKey);
    res.setHeader("X-RateLimit-Remaining", result.remainingPoints);
    res.setHeader("X-RateLimit-Limit", LIMITS[limiterKey as keyof typeof LIMITS].points);
    next();
  } catch {
    res.status(429).json({
      success: false,
      error: {
        code: "RATE_LIMIT_EXCEEDED",
        message: "Слишком много запросов. Попробуйте позже.",
      },
    });
  }
}
