// SPDX-License-Identifier: AGPL-3.0-only
import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import type { JwtPayload, UserRole } from "@samur/shared";
import { getTokenVersion } from "../lib/tokenVersion.js";

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

/** Algorithm pinning. Without this, an attacker who knows the JWT
 * library's defaults could forge tokens using "alg":"none" (historically)
 * or trigger alg-confusion with RS-vs-HS if the secret is ever misused
 * as a public key. We only issue HS256, so we only verify HS256. */
const VERIFY_OPTS = { algorithms: ["HS256"] as jwt.Algorithm[] };

/** Compare the token's payload.tokenVersion against the user's current
 * tokenVersion (Redis-cached 30 s, falls through to DB on miss).
 * Returns `true` if the token is still valid, `false` if it's been
 * revoked or the user no longer exists.
 *
 * Legacy tokens issued before the field existed carry no tokenVersion
 * — we treat that as 0, which matches every user's default. So the
 * rollout doesn't invalidate any in-flight session; only tokens older
 * than a later user-initiated revocation (tokenVersion bumped past 0)
 * get rejected. */
async function isTokenVersionCurrent(payload: JwtPayload): Promise<boolean> {
  const current = await getTokenVersion(payload.sub);
  if (current === null) return false; // user deleted
  const claimed = payload.tokenVersion ?? 0;
  return claimed >= current;
}

/**
 * Extract and verify JWT from Authorization header.
 * If no token is present, req.user remains undefined (anonymous access).
 * Revoked tokens (tokenVersion below current) are silently dropped here
 * — we don't want optionalAuth-gated endpoints to 401, they should just
 * treat the caller as unauthenticated.
 */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return next();
  }

  try {
    const token = header.slice(7);
    const payload = jwt.verify(token, config.JWT_SECRET, VERIFY_OPTS) as JwtPayload;
    if (await isTokenVersionCurrent(payload)) {
      req.user = payload;
    }
  } catch {
    // Invalid token — treat as anonymous rather than blocking
  }
  next();
}

/**
 * Require a valid JWT. Returns 401 if missing/invalid/revoked.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({
      success: false,
      error: { code: "UNAUTHORIZED", message: "Требуется авторизация" },
    });
    return;
  }

  try {
    const token = header.slice(7);
    const payload = jwt.verify(token, config.JWT_SECRET, VERIFY_OPTS) as JwtPayload;
    if (!(await isTokenVersionCurrent(payload))) {
      res.status(401).json({
        success: false,
        error: { code: "TOKEN_REVOKED", message: "Сессия отозвана. Войдите снова." },
      });
      return;
    }
    req.user = payload;
    next();
  } catch {
    res.status(401).json({
      success: false,
      error: { code: "INVALID_TOKEN", message: "Недействительный токен" },
    });
  }
}

/**
 * Require one of the specified roles. Must be used after requireAuth.
 */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Требуется авторизация" },
      });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        success: false,
        error: { code: "FORBIDDEN", message: "Недостаточно прав" },
      });
      return;
    }

    next();
  };
}
