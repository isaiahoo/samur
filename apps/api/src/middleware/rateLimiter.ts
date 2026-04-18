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
  // Chat-message sends. The global 300/min/auth cap works out to ~5
  // msg/sec — enough for a single user to flood a conversation for a
  // full minute and take the other end of a hub chat with them.
  // Tighten to 30/min (0.5/sec sustained) which is still plenty for
  // rapid human back-and-forth but blunts bot-style spam. Coordinators
  // get 4× the ceiling for broadcast-style coordination during a
  // surge — still well under the global cap.
  messagesAuthenticated: { points: 30, duration: 60 },
  messagesCoordinator: { points: 120, duration: 60 },
  // Password login / register attempts. The global 90/min anon cap is
  // far too loose for these endpoints — an attacker with a known phone
  // number gets 90 password tries/minute against that single account.
  // Two stacked per-hour buckets: phone-keyed (blunts credential
  // stuffing against one account) and IP-keyed (blunts spray-and-pray
  // across many accounts from one source). Legitimate use is ≤3
  // attempts per user per forgot-password episode; shared Wi-Fi with
  // a family of 4 stays comfortably under the IP cap.
  authPerPhone: { points: 5, duration: 3600 },
  authPerIP: { points: 50, duration: 3600 },
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
    messagesAuthenticated: create("msg_auth", LIMITS.messagesAuthenticated),
    messagesCoordinator: create("msg_coord", LIMITS.messagesCoordinator),
    authPerPhone: create("auth_phone", LIMITS.authPerPhone),
    authPerIP: create("auth_ip", LIMITS.authPerIP),
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

/** Per-minute limit for chat-message sends. Requires the route to run
 * `requireAuth` first — anonymous messages aren't allowed. Additive to
 * the global per-minute limiter, so a spammer hits whichever is
 * tighter (this one, at 30 vs 300). */
export async function messagesRateLimiter(
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
      ? "messagesCoordinator"
      : "messagesAuthenticated";
  try {
    const result = await limiters[key].consume(user.sub);
    res.setHeader("X-Messages-RateLimit-Remaining", result.remainingPoints);
    res.setHeader("X-Messages-RateLimit-Limit", LIMITS[key as keyof typeof LIMITS].points);
    next();
  } catch {
    res.status(429).json({
      success: false,
      error: {
        code: "MESSAGE_RATE_LIMIT_EXCEEDED",
        message: "Слишком частые сообщения. Подождите немного.",
      },
    });
  }
}

/** Per-hour limiter for password login/register attempts. Place AFTER
 * `validateBody(...)` on the route so `req.body.phone` is the
 * normalized form (zod transform produces +7XXXXXXXXXX). Consumes
 * against TWO buckets: the phone's hourly budget and the IP's hourly
 * budget. Either exhausting returns 429 — the two buckets catch
 * different attack shapes (one account getting hammered vs one IP
 * spraying many accounts).
 *
 * Consumes on every attempt, successes included — a successful
 * probe still leaks info. No separate "failure-only" mode: attackers
 * don't care if their probe succeeds, they care about the response. */
export async function authAttemptsRateLimiter(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!limiters) return next();
  const phone = typeof req.body?.phone === "string" ? req.body.phone : null;
  const ip = getRealIp(req);
  try {
    // Promise.all rejects on first failure but both consumes are
    // already in flight — the "losing" bucket still deducts. That's
    // intentional: both caps should apply to every attempt. Waiting
    // for one before starting the other would let an attacker who
    // exhausts the phone bucket skip the IP count.
    await Promise.all([
      phone ? limiters.authPerPhone.consume(phone) : Promise.resolve(null),
      limiters.authPerIP.consume(ip),
    ]);
    next();
  } catch {
    res.status(429).json({
      success: false,
      error: {
        code: "AUTH_RATE_LIMIT_EXCEEDED",
        message: "Слишком много попыток входа. Попробуйте через час.",
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
