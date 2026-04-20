// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Rarity = how many community members have earned each achievement.
 *
 * Strategy: 13 bespoke aggregate queries (one per achievement rule),
 * run once and cached in Redis for 1 hour. The queries are cheap at
 * the scale we expect (thousands of users at most), and the set of
 * rules is bounded so we can hand-write SQL that matches
 * computeEarnedAchievements exactly.
 *
 * If Redis is unreachable, we compute fresh each call — the queries
 * are fast enough that this is a survivable degradation, not a
 * performance cliff.
 */

import { prisma } from "@samur/db";
import { getRedis } from "./redis.js";

const CACHE_KEY = "achievement_rarity:v1";
const CACHE_TTL_SECONDS = 60 * 60; // 1 hour — rarity drifts slowly

export type RarityMap = Record<string, number>;

async function computeRarityFresh(): Promise<RarityMap> {
  // One query per rule. BigInt → Number cast is safe because we're
  // counting users (a modest upper bound for this app's audience).
  const rows = await prisma.$queryRaw<Array<{ key: string; count: bigint }>>`
    WITH
      helps AS (
        SELECT resp.user_id, COUNT(*) AS total,
               COUNT(*) FILTER (WHERE resp.confirmed_at IS NOT NULL) AS confirmed,
               COUNT(DISTINCT resp.confirmed_by) FILTER (WHERE resp.confirmed_at IS NOT NULL) AS distinct_confirmers
        FROM help_responses resp
        JOIN help_requests hr ON hr.id = resp.help_request_id
        WHERE resp.status = 'helped' AND hr.deleted_at IS NULL
        GROUP BY resp.user_id
      ),
      category_helps AS (
        SELECT resp.user_id, hr.category::text AS category,
               COUNT(*) FILTER (WHERE resp.confirmed_at IS NOT NULL) AS confirmed
        FROM help_responses resp
        JOIN help_requests hr ON hr.id = resp.help_request_id
        WHERE resp.status = 'helped' AND hr.deleted_at IS NULL
        GROUP BY resp.user_id, hr.category
      ),
      timing AS (
        SELECT user_id,
               AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) / 60) AS avg_minutes
        FROM help_responses
        WHERE status IN ('on_way', 'arrived', 'helped')
        GROUP BY user_id
      )
    SELECT 'first_help' AS key, COUNT(*)::bigint AS count FROM helps WHERE total >= 1
    UNION ALL SELECT 'ten_helps', COUNT(*)::bigint FROM helps WHERE total >= 10 AND confirmed >= 2
    UNION ALL SELECT 'fifty_helps', COUNT(*)::bigint FROM helps WHERE total >= 50 AND confirmed >= 10 AND distinct_confirmers >= 10
    UNION ALL SELECT 'first_request', COUNT(DISTINCT user_id)::bigint FROM help_requests WHERE deleted_at IS NULL AND user_id IS NOT NULL
    UNION ALL SELECT 'fast_responder', COUNT(*)::bigint
                FROM helps JOIN timing USING (user_id)
                WHERE total >= 5 AND avg_minutes <= 30 AND confirmed >= 1
    UNION ALL SELECT 'rescue_specialist',   COUNT(*)::bigint FROM category_helps WHERE category = 'rescue'    AND confirmed >= 3
    UNION ALL SELECT 'medical_helper',      COUNT(*)::bigint FROM category_helps WHERE category = 'medicine'  AND confirmed >= 3
    UNION ALL SELECT 'transporter',         COUNT(*)::bigint FROM category_helps WHERE category = 'transport' AND confirmed >= 3
    UNION ALL SELECT 'shelter_provider',    COUNT(*)::bigint FROM category_helps WHERE category = 'shelter'   AND confirmed >= 3
    UNION ALL SELECT 'food_water', COUNT(*)::bigint FROM (
                SELECT user_id, SUM(confirmed) AS c FROM category_helps
                WHERE category IN ('food', 'water') GROUP BY user_id
              ) fw WHERE c >= 3
    UNION ALL SELECT 'installed_pwa', COUNT(*)::bigint FROM users WHERE installed_pwa_at IS NOT NULL
    UNION ALL SELECT 'early_adopter', COUNT(*)::bigint FROM users WHERE created_at < '2026-05-01'
    UNION ALL SELECT 'veteran', COUNT(*)::bigint FROM users WHERE created_at < NOW() - INTERVAL '180 days'
  `;

  const out: RarityMap = {};
  for (const r of rows) out[r.key] = Number(r.count);
  return out;
}

export async function getAchievementRarity(): Promise<RarityMap> {
  const redis = getRedis();
  if (redis) {
    const cached = await redis.get(CACHE_KEY);
    if (cached) {
      try { return JSON.parse(cached) as RarityMap; } catch { /* fall through */ }
    }
  }
  const fresh = await computeRarityFresh();
  if (redis) {
    await redis.setex(CACHE_KEY, CACHE_TTL_SECONDS, JSON.stringify(fresh));
  }
  return fresh;
}
