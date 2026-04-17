// SPDX-License-Identifier: AGPL-3.0-only
import { Router } from "express";
import { prisma } from "@samur/db";
import { requireAuth } from "../middleware/auth.js";
import { AppError } from "../middleware/error.js";
import { computeUserActivity } from "../lib/userStats.js";

const router = Router();

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
router.get("/:id/stats", requireAuth, async (req, res, next) => {
  try {
    const id = String(req.params.id);

    // Cheap existence check + pull the public identity for the profile page.
    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, role: true },
    });
    if (!user) throw new AppError(404, "NOT_FOUND", "Пользователь не найден");

    const activity = await computeUserActivity(id);
    res.json({
      success: true,
      data: {
        ...activity,
        // Profile-page convenience: identity alongside stats so the client
        // doesn't need a second round-trip for name/role.
        user: { id: user.id, name: user.name, role: user.role },
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
