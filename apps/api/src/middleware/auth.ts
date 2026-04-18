// SPDX-License-Identifier: AGPL-3.0-only
import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import type { JwtPayload, UserRole } from "@samur/shared";

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

/**
 * Extract and verify JWT from Authorization header.
 * If no token is present, req.user remains undefined (anonymous access).
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return next();
  }

  try {
    const token = header.slice(7);
    const payload = jwt.verify(token, config.JWT_SECRET, VERIFY_OPTS) as JwtPayload;
    req.user = payload;
  } catch {
    // Invalid token — treat as anonymous rather than blocking
  }
  next();
}

/**
 * Require a valid JWT. Returns 401 if missing/invalid.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
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
