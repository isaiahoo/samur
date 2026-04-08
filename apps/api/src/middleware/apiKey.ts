// SPDX-License-Identifier: AGPL-3.0-only
import type { Request, Response, NextFunction } from "express";
import { config } from "../config.js";

/**
 * Require a valid API key in the X-API-Key header.
 * Used for webhook endpoints (SMS gateway, Meshtastic bridge).
 * In development, skips validation if WEBHOOK_API_KEY is not set.
 */
export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const key = req.headers["x-api-key"];

  if (!config.WEBHOOK_API_KEY) {
    // Dev mode — no key configured, allow all
    return next();
  }

  if (!key || key !== config.WEBHOOK_API_KEY) {
    res.status(401).json({
      success: false,
      error: { code: "INVALID_API_KEY", message: "Недействительный API-ключ" },
    });
    return;
  }

  next();
}
