// SPDX-License-Identifier: AGPL-3.0-only
import { prisma } from "@samur/db";
import { logger } from "./logger.js";

/**
 * Two-tier visibility for help-requests + incidents + map.
 *
 * Public (anonymous) and resident-role callers only see items authored
 * by users who have granted distribution consent (152-ФЗ ст. 10.1).
 * Volunteer-and-above callers see everything in geofilter — they're
 * acting in their volunteer capacity, not browsing public-feed content.
 *
 * The set of "users with current distribution consent" is small relative
 * to total users and changes only at registration / withdrawal time, so
 * a 60s in-process cache is plenty. Coarse cache invalidation: bust
 * the cache from the consent-write endpoint.
 *
 * Anonymous rows (userId IS NULL — SOS without account, anonymous
 * incident reports) are NOT filtered here. Callers that want them
 * visible should OR `{ userId: null }` into their `where` clause.
 */

const CACHE_TTL_MS = 60_000;

let cache: { ids: Set<string>; loadedAt: number } | null = null;

async function loadDistributionConsentedIds(): Promise<Set<string>> {
  // Latest row per (user_id, "distribution") via DISTINCT ON; keep only
  // the ones whose latest row says accepted=true. Postgres-specific.
  const rows = await prisma.$queryRaw<Array<{ user_id: string; accepted: boolean }>>`
    SELECT DISTINCT ON (user_id) user_id, accepted
    FROM consent_log
    WHERE consent_type = 'distribution'
    ORDER BY user_id, accepted_at DESC
  `;
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.accepted) ids.add(row.user_id);
  }
  return ids;
}

export async function getDistributionConsentedUserIds(): Promise<Set<string>> {
  const now = Date.now();
  if (cache && now - cache.loadedAt < CACHE_TTL_MS) {
    return cache.ids;
  }
  try {
    const ids = await loadDistributionConsentedIds();
    cache = { ids, loadedAt: now };
    return ids;
  } catch (err) {
    logger.error({ err }, "Failed to load distribution-consent set; defaulting to empty");
    // Fail closed — if we can't load the consent set, we hide everything
    // from the public surface rather than risk leaking unconsented data.
    return new Set();
  }
}

/** Bust the cache after a consent write so the next public-feed query
 * sees the new state without waiting for the TTL to expire. */
export function invalidateDistributionConsentCache(): void {
  cache = null;
}

/** Returns the current state of both consents for one user, derived
 * from the latest ConsentLog row per type. Used by the ConsentGate
 * (existing-user gate on first login post-deploy) and by the profile
 * page transparency display. */
export async function getMyConsentState(userId: string): Promise<{
  processing: { accepted: boolean; at: string; version: string } | null;
  distribution: { accepted: boolean; at: string; version: string } | null;
}> {
  const rows = await prisma.consentLog.findMany({
    where: { userId },
    orderBy: { acceptedAt: "desc" },
  });
  const latestByType = new Map<string, typeof rows[number]>();
  for (const row of rows) {
    if (!latestByType.has(row.consentType)) {
      latestByType.set(row.consentType, row);
    }
  }
  const proc = latestByType.get("processing");
  const dist = latestByType.get("distribution");
  return {
    processing: proc
      ? { accepted: proc.accepted, at: proc.acceptedAt.toISOString(), version: proc.consentVersion }
      : null,
    distribution: dist
      ? { accepted: dist.accepted, at: dist.acceptedAt.toISOString(), version: dist.consentVersion }
      : null,
  };
}
