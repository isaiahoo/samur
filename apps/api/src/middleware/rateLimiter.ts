// SPDX-License-Identifier: AGPL-3.0-only
import type { Request, Response, NextFunction } from "express";
import { RateLimiterRedis, RateLimiterMemory } from "rate-limiter-flexible";
import type { Redis } from "ioredis";
import { logger } from "../lib/logger.js";
import { getRealIp } from "../lib/clientIp.js";

const LIMITS = {
  anonymous: { points: 90, duration: 60 },
  authenticated: { points: 300, duration: 60 },
  coordinator: { points: 600, duration: 60 },
  // Uploads are hourly and much tighter than the global per-minute
  // limit: each request can write up to 5 × 5 MB to disk, so a 90/min
  // anon cap translates to 450 MB/min/IP of durable storage writes,
  // which is a usable storage-exhaustion tool. Per-hour windows make
  // each ceiling the actual daily budget a well-behaved caller needs.
  uploadsAnonymous: { points: 10, duration: 3600 },
  uploadsAuthenticated: { points: 60, duration: 3600 },
  uploadsCoordinator: { points: 200, duration: 3600 },
  // Message-report submissions. Report abuse is real, but mass-report
  // brigading of a single target is also real; 20/hr/user lets a busy
  // moderator work without friction, stops a brigade before it can
  // swamp the review queue. Anonymous report submissions aren't
  // possible (the endpoint is requireAuth).
  reportsAuthenticated: { points: 20, duration: 3600 },
  reportsCoordinator: { points: 200, duration: 3600 },
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
        blockDuration: 10,
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
    uploadsAnonymous: create("up_anon", LIMITS.uploadsAnonymous),
    uploadsAuthenticated: create("up_auth", LIMITS.uploadsAuthenticated),
    uploadsCoordinator: create("up_coord", LIMITS.uploadsCoordinator),
    reportsAuthenticated: create("rep_auth", LIMITS.reportsAuthenticated),
    reportsCoordinator: create("rep_coord", LIMITS.reportsCoordinator),
  };

  if (!redisClient) {
    logger.warn("Rate limiter using in-memory store (Redis unavailable)");
  }
}

/** Pick the appropriate limiter + key for the caller. Anonymous callers
 * get keyed by real client IP (CF+nginx chain is unreliable on req.ip);
 * authenticated callers by user id, with coordinators/admins on a
 * higher tier. */
function pickLimiter(
  req: Request,
  tier: "global" | "uploads",
): { key: string; consumeKey: string } {
  const user = req.user;
  if (!user) {
    return {
      key: tier === "uploads" ? "uploadsAnonymous" : "anonymous",
      consumeKey: getRealIp(req),
    };
  }
  if (user.role === "coordinator" || user.role === "admin") {
    return {
      key: tier === "uploads" ? "uploadsCoordinator" : "coordinator",
      consumeKey: user.sub,
    };
  }
  return {
    key: tier === "uploads" ? "uploadsAuthenticated" : "authenticated",
    consumeKey: user.sub,
  };
}

export async function rateLimiterMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!limiters) return next();
  const { key, consumeKey } = pickLimiter(req, "global");
  try {
    const result = await limiters[key].consume(consumeKey);
    res.setHeader("X-RateLimit-Remaining", result.remainingPoints);
    res.setHeader("X-RateLimit-Limit", LIMITS[key as keyof typeof LIMITS].points);
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

/** Stricter per-hour limit for file uploads — runs in addition to the
 * global per-minute limiter. Place AFTER `optionalAuth` in the route
 * chain so authenticated callers are keyed by user id, not IP. */
export async function uploadsRateLimiter(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!limiters) return next();
  const { key, consumeKey } = pickLimiter(req, "uploads");
  try {
    const result = await limiters[key].consume(consumeKey);
    res.setHeader("X-Uploads-RateLimit-Remaining", result.remainingPoints);
    res.setHeader("X-Uploads-RateLimit-Limit", LIMITS[key as keyof typeof LIMITS].points);
    next();
  } catch {
    res.status(429).json({
      success: false,
      error: {
        code: "UPLOAD_RATE_LIMIT_EXCEEDED",
        message: "Слишком много загрузок за час. Попробуйте позже.",
      },
    });
  }
}

/** Per-hour limit for message-report submissions. Requires the route
 * to run `requireAuth` first — anonymous reports aren't allowed. */
export async function reportsRateLimiter(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!limiters) return next();
  const user = req.user;
  if (!user) {
    res.status(401).json({
      success: false,
      error: { code: "UNAUTHORIZED", message: "Требуется авторизация" },
    });
    return;
  }
  const key =
    user.role === "coordinator" || user.role === "admin"
      ? "reportsCoordinator"
      : "reportsAuthenticated";
  try {
    const result = await limiters[key].consume(user.sub);
    res.setHeader("X-Reports-RateLimit-Remaining", result.remainingPoints);
    res.setHeader("X-Reports-RateLimit-Limit", LIMITS[key as keyof typeof LIMITS].points);
    next();
  } catch {
    res.status(429).json({
      success: false,
      error: {
        code: "REPORT_RATE_LIMIT_EXCEEDED",
        message: "Слишком много жалоб за час. Попробуйте позже.",
      },
    });
  }
}
