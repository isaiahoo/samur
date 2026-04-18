// SPDX-License-Identifier: AGPL-3.0-only
import { prisma } from "@samur/db";
import { getRedis } from "./redis.js";
import { logger } from "./logger.js";

/** Short cache TTL for the user.tokenVersion lookup. Trades a bounded
 * window of stale acceptance after a revocation (≤30 s) for taking the
 * DB hit off the per-request hot path. Redis fan-out means all API
 * nodes converge inside that window. */
const CACHE_TTL_SECONDS = 30;

const cacheKey = (userId: string) => `tv:${userId}`;

/** Read the user's current tokenVersion. Cached in Redis with a 30 s
 * TTL; falls through to the DB on miss. Returns NULL only if the user
 * doesn't exist — callers should treat that as a revoked session.
 *
 * Cache-write uses SET NX so a stale read-path write can't clobber a
 * fresher value written by a concurrent increment on another node.
 * That pairs with incrementTokenVersion writing the new canonical
 * value (not deleting), which closes a race window where:
 *   T1 — node A reads DB=0 (cache miss)
 *   T2 — node B increments DB→1, clears/sets cache
 *   T3 — node A would write cache=0, serving the stale value for 30 s
 * Under the SET-NX read-path + SET-on-increment, T3 fails (cache
 * already has 1) and the fresh value survives. */
export async function getTokenVersion(userId: string): Promise<number | null> {
  const redis = getRedis();
  if (redis) {
    try {
      const cached = await redis.get(cacheKey(userId));
      if (cached !== null) {
        const n = Number(cached);
        if (Number.isFinite(n)) return n;
      }
    } catch (err) {
      // Redis blip — fall through to DB, don't block auth.
      logger.warn({ err }, "tokenVersion cache read failed, falling back to DB");
    }
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { tokenVersion: true },
  });
  if (!user) return null;

  if (redis) {
    // Fire-and-forget — cache-priming must not block the auth path.
    // NX: do not overwrite a value another writer has already put there.
    redis
      .set(cacheKey(userId), String(user.tokenVersion), "EX", CACHE_TTL_SECONDS, "NX")
      .catch(() => { /* ignore */ });
  }
  return user.tokenVersion;
}

/** Bump user.tokenVersion by 1, invalidating every JWT currently in
 * the wild for this user. Writes the new value to the cache (not just
 * a delete) so stale in-flight read-path writes lose the race. Returns
 * the new version. */
export async function incrementTokenVersion(userId: string): Promise<number> {
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { tokenVersion: { increment: 1 } },
    select: { tokenVersion: true },
  });
  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(
        cacheKey(userId),
        String(updated.tokenVersion),
        "EX",
        CACHE_TTL_SECONDS,
      );
    } catch { /* ignore */ }
  }
  return updated.tokenVersion;
}
