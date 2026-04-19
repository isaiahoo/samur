// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Per-user action record used as the trust signal throughout the app —
 * replaces the self-declared role (Житель/Волонтёр) at signup with a record
 * the user earns through actual behaviour. Foundation for the future
 * achievements layer (badges are just derivations over these numbers).
 */
import { prisma } from "@samur/db";

export interface UserStats {
  helpsCompleted: number;
  helpsActive: number;
  requestsResolved: number;
  requestsActive: number;
  joinedAt: string;
}

const EMPTY_STATS = (joinedAt: string): UserStats => ({
  helpsCompleted: 0,
  helpsActive: 0,
  requestsResolved: 0,
  requestsActive: 0,
  joinedAt,
});

/**
 * Compute stats for many users in a single round-trip (5 indexed queries
 * regardless of how many userIds). Used both by the standalone
 * GET /users/:id/stats endpoint and by the help-request list/detail
 * responses (where we embed stats per responder for trust signalling).
 */
export async function computeUserStats(
  userIds: string[],
): Promise<Map<string, UserStats>> {
  const result = new Map<string, UserStats>();
  if (userIds.length === 0) return result;

  // De-dup so groupBy doesn't count the same user multiple times.
  const uniqueIds = Array.from(new Set(userIds));

  const [completed, active, resolved, reqActive, users] = await Promise.all([
    prisma.helpResponse.groupBy({
      by: ["userId"],
      where: { userId: { in: uniqueIds }, status: "helped" },
      _count: { id: true },
    }),
    prisma.helpResponse.groupBy({
      by: ["userId"],
      where: {
        userId: { in: uniqueIds },
        status: { in: ["responded", "on_way", "arrived"] },
      },
      _count: { id: true },
    }),
    prisma.helpRequest.groupBy({
      by: ["userId"],
      where: {
        userId: { in: uniqueIds },
        status: "completed",
        deletedAt: null,
      },
      _count: { id: true },
    }),
    prisma.helpRequest.groupBy({
      by: ["userId"],
      where: {
        userId: { in: uniqueIds },
        status: { notIn: ["completed", "cancelled"] },
        deletedAt: null,
      },
      _count: { id: true },
    }),
    prisma.user.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true, createdAt: true },
    }),
  ]);

  for (const u of users) {
    result.set(u.id, EMPTY_STATS(u.createdAt.toISOString()));
  }
  for (const c of completed) {
    const s = result.get(c.userId);
    if (s) s.helpsCompleted = c._count.id;
  }
  for (const c of active) {
    const s = result.get(c.userId);
    if (s) s.helpsActive = c._count.id;
  }
  for (const r of resolved) {
    if (!r.userId) continue;
    const s = result.get(r.userId);
    if (s) s.requestsResolved = r._count.id;
  }
  for (const r of reqActive) {
    if (!r.userId) continue;
    const s = result.get(r.userId);
    if (s) s.requestsActive = r._count.id;
  }

  return result;
}

export async function computeUserStatsFor(userId: string): Promise<UserStats | null> {
  const map = await computeUserStats([userId]);
  return map.get(userId) ?? null;
}

// ── Full activity snapshot — used by the profile endpoint to derive the
//    achievements set. Strictly superset of UserStats so existing callers
//    that only read the lightweight fields stay forward-compatible. ──────

export interface UserActivity extends UserStats {
  requestsCreated: number;
  helpsByCategory: Record<string, number>;
  avgResponseToOnWayMinutes: number | null;
  installedPwa: boolean;
  confirmedHelps: number;
  confirmedHelpsByCategory: Record<string, number>;
  distinctConfirmers: number;
  /** Public thank-you quotes shown on the profile wall. Capped server-side. */
  thankYouQuotes: Array<{
    id: string;
    note: string;
    createdAt: string;
    category: string;
    authorName: string | null;
  }>;
  achievements: string[]; // earned achievement keys
}

/**
 * Heavier than computeUserStats — runs a few more aggregates and the
 * achievement derivation. Only called for the profile page (one user at a
 * time), so the cost is bounded.
 */
export async function computeUserActivity(userId: string): Promise<UserActivity | null> {
  // Re-use the light stats for the base numbers.
  const base = await computeUserStatsFor(userId);
  if (!base) return null;

  // Dynamic imports to avoid a circular dep between this lib file and
  // @samur/shared (which is imported by many API modules).
  const { computeEarnedAchievements } = await import("@samur/shared");

  // Category breakdown: count helps ("helped" status responses) grouped by
  // the help request's category. Returns two buckets per category — total
  // self-reported helps and confirmed-only — in a single query.
  const categoryRows = await prisma.$queryRaw<Array<{ category: string; count: bigint; confirmed: bigint }>>`
    SELECT
      hr.category::text as category,
      COUNT(*)::bigint as count,
      COUNT(*) FILTER (WHERE resp.confirmed_at IS NOT NULL)::bigint as confirmed
    FROM help_responses resp
    JOIN help_requests hr ON hr.id = resp.help_request_id
    WHERE resp.user_id = ${userId}
      AND resp.status = 'helped'
      AND hr.deleted_at IS NULL
    GROUP BY hr.category
  `;
  const helpsByCategory: Record<string, number> = {};
  const confirmedHelpsByCategory: Record<string, number> = {};
  for (const r of categoryRows) {
    helpsByCategory[r.category] = Number(r.count);
    confirmedHelpsByCategory[r.category] = Number(r.confirmed);
  }

  // Response-to-on-way time: average minutes between the response's createdAt
  // and the updatedAt when it transitioned past "responded". For helps that
  // reached on_way or later we approximate with the response row's
  // updatedAt — works because PATCH /my-response is the only path to advance
  // status, and each advance bumps updatedAt.
  //
  // This is a rough signal — a future iteration could add a response_events
  // table to capture exact transition timestamps. For achievement-gating
  // ("avg < 30 min"), the approximation is good enough.
  const timingRow = await prisma.$queryRaw<Array<{ avg_minutes: number | null }>>`
    SELECT AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) / 60)::float AS avg_minutes
    FROM help_responses
    WHERE user_id = ${userId}
      AND status IN ('on_way', 'arrived', 'helped')
  `;
  const avgResponseToOnWayMinutes = timingRow[0]?.avg_minutes ?? null;

  // requestsCreated = all non-deleted help_requests the user authored,
  // regardless of current status (counts attempts, not just successes).
  const requestsCreated = await prisma.helpRequest.count({
    where: { userId, deletedAt: null },
  });

  const installedPwaFlag = await prisma.user.findUnique({
    where: { id: userId },
    select: { installedPwaAt: true },
  });
  const installedPwa = installedPwaFlag?.installedPwaAt != null;

  // Confirmed-help aggregates for the Кунак-рукопожатие achievement gates.
  const confirmedAgg = await prisma.$queryRaw<Array<{
    confirmed: bigint;
    distinct_confirmers: bigint;
  }>>`
    SELECT
      COUNT(*)::bigint AS confirmed,
      COUNT(DISTINCT confirmed_by)::bigint AS distinct_confirmers
    FROM help_responses
    WHERE user_id = ${userId} AND confirmed_at IS NOT NULL
  `;
  const confirmedHelps = Number(confirmedAgg[0]?.confirmed ?? 0n);
  const distinctConfirmers = Number(confirmedAgg[0]?.distinct_confirmers ?? 0n);

  // Public thank-you wall — only queried for users with at least one
  // confirmation (skips a full-table scan for unconfirmed users).
  // Anonymous quotes strip the requester's name.
  const thankYouQuotes: UserActivity["thankYouQuotes"] = [];
  if (confirmedHelps > 0) {
    const noteRows = await prisma.$queryRaw<Array<{
      id: string;
      note: string;
      created_at: Date;
      category: string;
      anonymous: boolean;
      author_name: string | null;
    }>>`
      SELECT
        resp.id,
        resp.thank_you_note AS note,
        resp.confirmed_at AS created_at,
        hr.category::text AS category,
        resp.thank_you_anonymous AS anonymous,
        u.name AS author_name
      FROM help_responses resp
      JOIN help_requests hr ON hr.id = resp.help_request_id
      LEFT JOIN users u ON u.id = resp.confirmed_by
      WHERE resp.user_id = ${userId}
        AND resp.confirmed_at IS NOT NULL
        AND resp.thank_you_note IS NOT NULL
        AND length(trim(resp.thank_you_note)) > 0
      ORDER BY resp.confirmed_at DESC
      LIMIT 20
    `;
    for (const r of noteRows) {
      thankYouQuotes.push({
        id: r.id,
        note: r.note,
        createdAt: r.created_at.toISOString(),
        category: r.category,
        authorName: r.anonymous ? null : r.author_name,
      });
    }
  }

  const achievements = computeEarnedAchievements({
    helpsCompleted: base.helpsCompleted,
    requestsCreated,
    joinedAt: base.joinedAt,
    helpsByCategory,
    avgResponseToOnWayMinutes,
    installedPwa,
    confirmedHelps,
    confirmedHelpsByCategory,
    distinctConfirmers,
  });

  return {
    ...base,
    requestsCreated,
    helpsByCategory,
    avgResponseToOnWayMinutes,
    installedPwa,
    confirmedHelps,
    confirmedHelpsByCategory,
    distinctConfirmers,
    thankYouQuotes,
    achievements,
  };
}
