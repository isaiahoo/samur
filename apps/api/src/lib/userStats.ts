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
