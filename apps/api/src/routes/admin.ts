// SPDX-License-Identifier: AGPL-3.0-only
import { Router } from "express";
import { prisma } from "@samur/db";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { AppError } from "../middleware/error.js";
import { incrementTokenVersion } from "../lib/tokenVersion.js";
import { disconnectUserSockets } from "../socket.js";
import { auditLog } from "../lib/auditLog.js";

const router = Router();

/**
 * POST /admin/users/:userId/force-logout
 *
 * Coordinator/admin-only. Bumps the target user's tokenVersion and
 * force-disconnects every open socket they hold — the primitive we
 * already ship for self-logout-everywhere, exposed for operator use
 * on compromised / misbehaving accounts.
 *
 * Not self-targeting by design: if an admin needs to log themselves
 * out they use POST /auth/logout-all (no privilege escalation risk,
 * anyone can do it to themselves). Rejecting the self-case here
 * keeps the endpoint's audit trail clean — this row always means
 * "admin X force-logged user Y", never ambiguous.
 */
router.post(
  "/users/:userId/force-logout",
  requireAuth,
  requireRole("coordinator", "admin"),
  async (req, res, next) => {
    try {
      const targetId = String(req.params.userId || "").trim();
      if (!targetId || targetId.length > 64) {
        throw new AppError(400, "INVALID_ID", "Некорректный идентификатор пользователя");
      }
      if (targetId === req.user!.sub) {
        throw new AppError(
          400,
          "SELF_TARGET",
          "Используйте /auth/logout-all для выхода из собственных сессий",
        );
      }
      const target = await prisma.user.findUnique({
        where: { id: targetId },
        select: { id: true },
      });
      if (!target) {
        throw new AppError(404, "USER_NOT_FOUND", "Пользователь не найден");
      }

      const newVersion = await incrementTokenVersion(targetId);
      disconnectUserSockets(targetId);
      auditLog({ action: "force_logout_user", actorId: req.user!.sub, targetId });

      res.json({ success: true, data: { userId: targetId, tokenVersion: newVersion } });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
