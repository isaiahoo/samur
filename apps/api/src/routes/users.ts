// SPDX-License-Identifier: AGPL-3.0-only
import { Router } from "express";
import { prisma } from "@samur/db";
import { requireAuth } from "../middleware/auth.js";
import { AppError } from "../middleware/error.js";
import { computeUserStatsFor } from "../lib/userStats.js";

const router = Router();

/**
 * GET /api/v1/users/:id/stats
 *
 * Returns a user's action record — the numbers that back the future
 * achievements layer and the trust signal on responder cards. Accessible
 * to any authenticated user: the data is aggregate counts, never reveals
 * phone numbers or personal content.
 */
router.get("/:id/stats", requireAuth, async (req, res, next) => {
  try {
    const id = String(req.params.id);

    // Cheap existence check so 404 is distinguishable from "zero activity".
    const exists = await prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) throw new AppError(404, "NOT_FOUND", "Пользователь не найден");

    const stats = await computeUserStatsFor(id);
    res.json({ success: true, data: stats });
  } catch (err) {
    next(err);
  }
});

export default router;
