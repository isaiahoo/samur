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
 * GET /admin/users?limit=50&offset=0&search=<string>
 *
 * Coordinator/admin-only. Lists users for the operator UI. Paginated;
 * `search` does a case-insensitive substring match on name or phone.
 * Password hashes, token versions, and timestamps are omitted — the
 * caller only needs the fields to render a roster + drive force-
 * logout. Soft-deletion on users doesn't exist in this codebase, so
 * no deletedAt filter.
 */
router.get(
  "/users",
  requireAuth,
  requireRole("coordinator", "admin"),
  async (req, res, next) => {
    try {
      const limit = Math.min(Math.max(parseInt(String(req.query.limit)) || 50, 1), 100);
      const offset = Math.max(parseInt(String(req.query.offset)) || 0, 0);
      const search = typeof req.query.search === "string" ? req.query.search.trim() : "";

      const where = search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" as const } },
              { phone: { contains: search } },
            ],
          }
        : {};

      const [items, total] = await Promise.all([
        prisma.user.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: offset,
          take: limit,
          select: {
            id: true,
            name: true,
            phone: true,
            role: true,
            vkId: true,
            tgId: true,
            createdAt: true,
          },
        }),
        prisma.user.count({ where }),
      ]);

      res.json({
        success: true,
        data: items.map((u) => ({ ...u, createdAt: u.createdAt.toISOString() })),
        meta: { total, limit, offset },
      });
    } catch (err) {
      next(err);
    }
  },
);

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
