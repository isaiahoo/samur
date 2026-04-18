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
 *      CF-Connecting-IP — Cloudflare sets it unambiguously.
 *   2. Otherwise use `X-Real-IP`, which nginx sets with
 *      `proxy_set_header X-Real-IP $remote_addr`. Crucially,
 *      `proxy_set_header` OVERWRITES the header — a client-supplied
 *      X-Real-IP is always replaced by the real connecting IP.
 *   3. Last resort: the socket address (direct connection, no proxy).
 *
 * Why we do NOT read X-Forwarded-For: nginx's `$proxy_add_x_forwarded_for`
 * APPENDS to any client-supplied XFF rather than resetting it. An
 * attacker who sends `X-Forwarded-For: 1.2.3.4` becomes the leftmost
 * token in the final chain, and any `split(",")[0]` reader keys them as
 * `1.2.3.4`. That would let a single IP rotate through infinite
 * rate-limit buckets — especially damaging for the uploads limiter
 * (anon 10/hr cap) which is IP-keyed.
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

  const realIp = req.headers["x-real-ip"];
  if (typeof realIp === "string" && realIp.length > 0) {
    return realIp.trim();
  }

  return req.socket.remoteAddress ?? "unknown";
}
