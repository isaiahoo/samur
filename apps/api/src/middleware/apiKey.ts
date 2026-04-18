// SPDX-License-Identifier: AGPL-3.0-only
import type { Request, Response, NextFunction } from "express";
import crypto from "node:crypto";
import { config } from "../config.js";

/**
 * Require a valid API key in the X-API-Key header.
 * Used for webhook endpoints (SMS gateway, Meshtastic bridge).
 *
 * Production always has a non-empty key (enforced at config load via
 * superRefine on WEBHOOK_API_KEY). The only branch where
 * config.WEBHOOK_API_KEY can be empty is development — and in that
 * case we skip auth so local integration tests don't need a secret.
 */
export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  if (!config.WEBHOOK_API_KEY) {
    // Only reachable in development; production boot fails without a key.
    next();
    return;
  }

  const key = req.headers["x-api-key"];
  if (
    !key ||
    typeof key !== "string" ||
    key.length !== config.WEBHOOK_API_KEY.length ||
    !crypto.timingSafeEqual(Buffer.from(key), Buffer.from(config.WEBHOOK_API_KEY))
  ) {
    res.status(401).json({
      success: false,
      error: { code: "INVALID_API_KEY", message: "Недействительный API-ключ" },
    });
    return;
  }

  next();
}
