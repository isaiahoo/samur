// SPDX-License-Identifier: AGPL-3.0-only
import { RateLimiterMemory, RateLimiterRedis } from "rate-limiter-flexible";
import { prisma } from "@samur/db";
import { Prisma } from "@prisma/client";
import { getRedis } from "./redis.js";

/**
 * Tier 1 SOS Verification — per-IP rate limiting, anonymous dedup,
 * contextual confidence scoring, adaptive crisis mode.
 *
 * See SOS_VERIFICATION.md for full design rationale.
 */

// ---------- 1.1 Per-IP SOS Rate Limit ----------
// 1 SOS per IP per 5 minutes. Redis-backed when available so the limit
// survives container restarts and is shared across API nodes — the
// in-memory fallback would let a spammer reset their bucket by
// waiting for the next deploy. Memory fallback is kept so local dev
// without Redis still rate-limits sensibly.
let sosRateLimiter: RateLimiterRedis | RateLimiterMemory | null = null;
function getSosLimiter(): RateLimiterRedis | RateLimiterMemory {
  if (sosRateLimiter) return sosRateLimiter;
  const redis = getRedis();
  if (redis) {
    sosRateLimiter = new RateLimiterRedis({
      storeClient: redis,
      keyPrefix: "samur_sos_ip",
      points: 1,
      duration: 300,
      blockDuration: 10,
    });
  } else {
    sosRateLimiter = new RateLimiterMemory({
      keyPrefix: "samur_sos_ip",
      points: 1,
      duration: 300,
    });
  }
  return sosRateLimiter;
}

export interface SosRateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

export async function checkSosRateLimit(ip: string): Promise<SosRateLimitResult> {
  try {
    await getSosLimiter().consume(ip);
    return { allowed: true };
  } catch (err: unknown) {
    const rlErr = err as { msBeforeNext?: number };
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((rlErr.msBeforeNext ?? 300000) / 1000),
    };
  }
}

/** Clear the per-IP SOS rate-limit token. Called when the author
 * retracts an SOS as a false alarm — otherwise the 1-per-5-min cap
 * blocks them from re-sending a real SOS if the first was a test. */
export async function clearSosRateLimit(ip: string): Promise<void> {
  try {
    await getSosLimiter().delete(ip);
  } catch {
    /* best-effort — a leftover token just means 5 minutes of cooldown */
  }
}

// ---------- 1.2 Anonymous Dedup by IP + Coordinates ----------
// For anonymous users: check for existing active SOS from same IP within 30 min and ~1km
export async function findExistingAnonymousSOS(
  ip: string,
  lat: number,
  lng: number,
): Promise<{ id: string } | null> {
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);

  // Use PostGIS ST_DWithin for accurate 1km radius check
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM help_requests
    WHERE source_ip = ${ip}
      AND is_sos = true
      AND status IN ('open', 'claimed', 'in_progress')
      AND deleted_at IS NULL
      AND created_at >= ${thirtyMinAgo}
      AND location IS NOT NULL
      AND ST_DWithin(
        location,
        ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
        1000
      )
    ORDER BY created_at DESC
    LIMIT 1
  `;

  return rows.length > 0 ? rows[0] : null;
}

// ---------- 1.3 Contextual Confidence Score (0–100) ----------

interface ConfidenceInput {
  lat: number;
  lng: number;
  isAuthenticated: boolean;
  hasSituation: boolean;
  batteryLevel?: number | null;
}

/**
 * Compute confidence score based on contextual signals.
 * Higher score = more likely a real emergency.
 */
export async function computeConfidenceScore(input: ConfidenceInput): Promise<number> {
  let score = 0;

  // Run all checks in parallel for speed
  const [riverPoints, alertPoints, clusterPoints] = await Promise.all([
    checkRiverProximity(input.lat, input.lng),
    checkActiveAlerts(input.lat, input.lng),
    checkNearbySOS(input.lat, input.lng),
  ]);

  // +30: Location near river station with elevated levels (>100% of mean)
  score += riverPoints;

  // +25: Active critical/warning alerts covering this area
  score += alertPoints;

  // +20: Other SOS within 3km in last 60 minutes
  score += clusterPoints;

  // +10: Authenticated (phone-verified) user
  if (input.isAuthenticated) score += 10;

  // +10: User selected a specific situation
  if (input.hasSituation) score += 10;

  // +5: Battery below 30%
  if (input.batteryLevel != null && input.batteryLevel < 30) score += 5;

  return Math.min(score, 100);
}

/**
 * Check if SOS location is within 5km of a river station showing elevated discharge.
 * Returns 30 points if discharge > mean (elevated), 0 otherwise.
 */
async function checkRiverProximity(lat: number, lng: number): Promise<number> {
  try {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Find recent river readings within 5km that are elevated (discharge > mean)
    const rows = await prisma.$queryRaw<{ cnt: bigint }[]>`
      SELECT COUNT(*) as cnt FROM river_levels
      WHERE deleted_at IS NULL
        AND is_forecast = false
        AND measured_at >= ${oneDayAgo}
        AND discharge_cubic_m IS NOT NULL
        AND discharge_mean IS NOT NULL
        AND discharge_cubic_m > discharge_mean
        AND location IS NOT NULL
        AND ST_DWithin(
          location,
          ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
          5000
        )
    `;

    return Number(rows[0]?.cnt ?? 0) > 0 ? 30 : 0;
  } catch {
    return 0; // Fail open — don't penalize real emergencies
  }
}

/**
 * Check if there are active critical/warning alerts for this area.
 * Returns 25 points if found, 0 otherwise.
 */
async function checkActiveAlerts(lat: number, lng: number): Promise<number> {
  try {
    const now = new Date();

    // Check for active alerts (not expired, critical or warning urgency)
    // If alert has geoBounds, check if SOS location falls within; otherwise treat as global
    const rows = await prisma.$queryRaw<{ cnt: bigint }[]>`
      SELECT COUNT(*) as cnt FROM alerts
      WHERE deleted_at IS NULL
        AND urgency IN ('critical', 'warning')
        AND sent_at <= ${now}
        AND (expires_at IS NULL OR expires_at > ${now})
        AND (
          geo_bounds IS NULL
          OR ST_Contains(
            geo_bounds,
            ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)
          )
        )
    `;

    return Number(rows[0]?.cnt ?? 0) > 0 ? 25 : 0;
  } catch {
    return 0;
  }
}

/**
 * Check if other SOS signals exist within 3km in the last 60 minutes.
 * Returns 20 points if found, 0 otherwise.
 */
async function checkNearbySOS(lat: number, lng: number): Promise<number> {
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const rows = await prisma.$queryRaw<{ cnt: bigint }[]>`
      SELECT COUNT(*) as cnt FROM help_requests
      WHERE is_sos = true
        AND deleted_at IS NULL
        AND status IN ('open', 'claimed', 'in_progress')
        AND created_at >= ${oneHourAgo}
        AND location IS NOT NULL
        AND ST_DWithin(
          location,
          ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
          3000
        )
    `;

    return Number(rows[0]?.cnt ?? 0) > 0 ? 20 : 0;
  } catch {
    return 0;
  }
}

// ---------- 1.4 Adaptive Crisis Mode ----------

/**
 * Determine if the system is currently in "crisis mode":
 * - Active critical alerts exist, OR
 * - Any river station shows discharge > danger threshold (approximated as 2x mean)
 *
 * During crisis mode: all SOS are high priority regardless of score.
 * During normal mode: SOS with score < 20 flagged as "needs verification".
 */
export async function isCrisisMode(): Promise<boolean> {
  try {
    const now = new Date();
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [alertRows, riverRows] = await Promise.all([
      // Check for active critical alerts
      prisma.$queryRaw<{ cnt: bigint }[]>`
        SELECT COUNT(*) as cnt FROM alerts
        WHERE deleted_at IS NULL
          AND urgency = 'critical'
          AND sent_at <= ${now}
          AND (expires_at IS NULL OR expires_at > ${now})
      `,
      // Check for dangerously elevated rivers (discharge > 2x mean)
      prisma.$queryRaw<{ cnt: bigint }[]>`
        SELECT COUNT(*) as cnt FROM river_levels
        WHERE deleted_at IS NULL
          AND is_forecast = false
          AND measured_at >= ${oneDayAgo}
          AND discharge_cubic_m IS NOT NULL
          AND discharge_mean IS NOT NULL
          AND discharge_cubic_m > discharge_mean * 2
      `,
    ]);

    const hasActiveAlert = Number(alertRows[0]?.cnt ?? 0) > 0;
    const hasDangerousRiver = Number(riverRows[0]?.cnt ?? 0) > 0;

    return hasActiveAlert || hasDangerousRiver;
  } catch {
    // Fail safe — if we can't determine, assume crisis (don't block real emergencies)
    return true;
  }
}

/**
 * Determine the verification status label for a given confidence score.
 * Used by coordinators to prioritize SOS requests.
 */
export function getVerificationLabel(
  score: number,
  crisisActive: boolean,
): "high" | "normal" | "needs_verification" {
  if (crisisActive) return "high"; // During crisis, all SOS are high priority
  if (score >= 70) return "high";
  if (score >= 40) return "normal";
  if (score < 20) return "needs_verification";
  return "normal";
}
