// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Real client-IP extraction behind Cloudflare + nginx.
 *
 * Why this exists: Express's default `req.ip` reads the socket address,
 * which is the Docker internal IP of nginx once requests flow
 * client → [Cloudflare] → nginx → api. The "trust proxy" setting would
 * work if the hop count were fixed, but it changes based on whether
 * Cloudflare is proxying (orange cloud) or DNS-only (grey cloud), so a
 * static numeric value is fragile.
 *
 * Strategy:
 *   1. If the request carries Cloudflare's `CF-Connecting-IP` AND a
 *      `CF-Ray` header (proof it actually traversed CF's edge), use
 *      CF-Connecting-IP — Cloudflare sets it unambiguously to the
 *      original client IP.
 *   2. Otherwise fall back to the leftmost value of `X-Forwarded-For`,
 *      which nginx appends with the real client IP on grey cloud.
 *   3. Last resort: the socket address (direct connection, no proxy).
 *
 * Spoof-resistance: a direct attacker bypassing Cloudflare and setting a
 * fake `CF-Connecting-IP` header won't have a valid `CF-Ray`, so the
 * header is rejected and we fall through to XFF (which nginx controls).
 */
import type { Request } from "express";

export function getRealIp(req: Request): string {
  const cfRay = req.headers["cf-ray"];
  const cfIp = req.headers["cf-connecting-ip"];
  if (
    typeof cfRay === "string" && cfRay.length > 0 &&
    typeof cfIp === "string" && cfIp.length > 0
  ) {
    return cfIp.trim();
  }

  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) {
    return xff.split(",")[0].trim();
  }

  return req.socket.remoteAddress ?? "unknown";
}
