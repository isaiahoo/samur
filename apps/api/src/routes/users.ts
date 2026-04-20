// SPDX-License-Identifier: AGPL-3.0-only
import { Router } from "express";
import { prisma } from "@samur/db";
import { requireAuth } from "../middleware/auth.js";
import { AppError } from "../middleware/error.js";
import { computeUserActivity } from "../lib/userStats.js";
import { getAchievementRarity } from "../lib/achievementRarity.js";

const router = Router();

/**
 * GET /api/v1/users/achievement-rarity
 *
 * Public snapshot of how many users have earned each achievement.
 * No auth: the numbers are fully aggregate and the install prompt
 * needs them before login to show social proof ("уже получили X").
 * Cached upstream in Redis for 1 hour.
 */
router.get("/achievement-rarity", async (_req, res, next) => {
  try {
    const rarity = await getAchievementRarity();
    res.json({ success: true, data: { rarity } });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/users/:id/stats
 *
 * Returns a user's full activity snapshot — lightweight counts, per-category
 * breakdowns, response-time average, and the derived achievement keys.
 * Accessible to any authenticated user: data is aggregate counts, never
 * reveals phones or personal content. Backwards-compatible: callers that
 * only read the lightweight UserStats fields (helpsCompleted, etc.) keep
 * working without change.
 */
/**
 * GET /api/v1/users/me/activity
 *
 * Live-count snapshot of the caller's in-flight work — used by the profile
 * menu (and the header dot) so the user can see commitment + unread load
 * without drilling into /help. All counts are scoped to the caller: never
 * returns anyone else's data. Cheap aggregate queries, safe to hit on
 * every menu open and on socket-triggered invalidation.
 */
router.get("/me/activity", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user!.sub;

    const [activeResponses, ownOpenRequests, unreadResult] = await Promise.all([
      // Commitments I'm currently on the hook for. "helped" is a terminal
      // good-state we don't surface as outstanding work.
      prisma.helpResponse.count({
        where: {
          userId,
          status: { notIn: ["cancelled", "helped"] },
          helpRequest: {
            deletedAt: null,
            status: { notIn: ["completed", "cancelled"] },
          },
        },
      }),
      // Requests I authored that still need attention.
      prisma.helpRequest.count({
        where: {
          userId,
          deletedAt: null,
          status: { notIn: ["completed", "cancelled"] },
        },
      }),
      // Total unread messages across every thread I'm a participant in
      // (author OR non-cancelled responder). Single raw query: the per-thread
      // watermark (last_read_at) makes this awkward in Prisma's query DSL.
      prisma.$queryRaw<Array<{ unread: bigint }>>`
        SELECT COUNT(*)::bigint AS unread
        FROM help_messages m
        LEFT JOIN help_message_reads r
          ON r.help_request_id = m.help_request_id AND r.user_id = ${userId}
        WHERE m.author_id <> ${userId}
          AND m.deleted_at IS NULL
          AND m.created_at > COALESCE(r.last_read_at, '1970-01-01'::timestamp)
          AND m.help_request_id IN (
            SELECT hr.id
            FROM help_requests hr
            LEFT JOIN help_responses resp
              ON resp.help_request_id = hr.id AND resp.user_id = ${userId}
            WHERE hr.deleted_at IS NULL
              AND (hr.user_id = ${userId} OR (resp.user_id = ${userId} AND resp.status <> 'cancelled'))
          )
      `,
    ]);

    const unreadMessages = Number(unreadResult[0]?.unread ?? 0);

    res.set("Cache-Control", "no-store");
    res.json({
      success: true,
      data: { activeResponses, ownOpenRequests, unreadMessages },
    });
  } catch (err) {
    next(err);
  }
});

router.get("/:id/stats", requireAuth, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const isSelf = req.user!.sub === id;

    // Cheap existence check + pull the public identity for the profile page.
    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, role: true, hideAchievements: true },
    });
    if (!user) throw new AppError(404, "NOT_FOUND", "Пользователь не найден");

    const [activity, rarity] = await Promise.all([
      computeUserActivity(id),
      getAchievementRarity(),
    ]);
    const hidden = !isSelf && user.hideAchievements;
    const data = activity && hidden
      ? { ...activity, achievements: [], thankYouQuotes: [] }
      : activity;
    res.json({
      success: true,
      data: {
        ...data,
        achievementRarity: rarity,
        user: {
          id: user.id,
          name: user.name,
          role: user.role,
          ...(isSelf ? { hideAchievements: user.hideAchievements } : {}),
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/users/me/preferences — small bag of caller-owned flags.
// Currently just hideAchievements, but shaped as a preferences object so
// future toggles land here without new endpoints.
router.patch("/me/preferences", requireAuth, async (req, res, next) => {
  try {
    const { hideAchievements } = req.body as { hideAchievements?: unknown };
    const update: { hideAchievements?: boolean } = {};
    if (typeof hideAchievements === "boolean") update.hideAchievements = hideAchievements;
    if (Object.keys(update).length === 0) {
      throw new AppError(400, "NO_FIELDS", "Нечего обновлять");
    }
    const user = await prisma.user.update({
      where: { id: req.user!.sub },
      data: update,
      select: { id: true, hideAchievements: true },
    });
    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/users/me/pwa-installed
 *
 * Flip the caller's installed_pwa_at flag if it isn't already set.
 * Fired by the client's useInstallPrompt hook when either the
 * `appinstalled` event lands OR `display-mode: standalone` is first
 * observed on this account. Idempotent — subsequent calls are no-ops
 * so we don't reset the original install timestamp on reinstalls.
 *
 * Unlocks the "В сообществе" achievement (see packages/shared/src/
 * achievements.ts). No response body beyond success — the client
 * doesn't need to know when it was flipped, only that the achievement
 * list on the next profile load will include it.
 */
router.post("/me/pwa-installed", requireAuth, async (req, res, next) => {
  try {
    const existing = await prisma.user.findUnique({
      where: { id: req.user!.sub },
      select: { installedPwaAt: true },
    });
    if (existing?.installedPwaAt) {
      res.json({ success: true, data: { alreadyInstalled: true } });
      return;
    }
    await prisma.user.update({
      where: { id: req.user!.sub },
      data: { installedPwaAt: new Date() },
    });
    res.json({ success: true, data: { alreadyInstalled: false } });
  } catch (err) {
    next(err);
  }
});

export default router;
