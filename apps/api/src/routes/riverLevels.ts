// SPDX-License-Identifier: AGPL-3.0-only
import { Router } from "express";
import { prisma, Prisma } from "@samur/db";
import { optionalAuth, requireAuth, requireRole } from "../middleware/auth.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import { CreateRiverLevelSchema, RiverLevelQuerySchema } from "@samur/shared";
import type { RiverLevel } from "@samur/shared";
import { AppError } from "../middleware/error.js";
import { emitRiverLevelUpdated } from "../lib/emitter.js";
import { paramId } from "../lib/params.js";

const router = Router();

router.get(
  "/",
  validateQuery(RiverLevelQuerySchema),
  async (req, res, next) => {
    try {
      const q = (req as unknown as { parsedQuery: Record<string, unknown> }).parsedQuery as {
        page: number; limit: number;
        riverName?: string; stationName?: string;
        latest?: boolean; sort: string; order: string;
      };

      // "Latest per station" mode
      if (q.latest) {
        const conditions: Prisma.Sql[] = [Prisma.sql`deleted_at IS NULL`];
        if (q.riverName) conditions.push(Prisma.sql`river_name = ${q.riverName}`);
        if (q.stationName) conditions.push(Prisma.sql`station_name = ${q.stationName}`);

        const whereClause = Prisma.join(conditions, " AND ");

        const latestLevels = await prisma.$queryRaw<Array<Record<string, unknown>>>`
          SELECT DISTINCT ON (river_name, station_name)
            id, river_name as "riverName", station_name as "stationName",
            lat, lng, level_cm as "levelCm", danger_level_cm as "dangerLevelCm",
            trend, measured_at as "measuredAt", created_at as "createdAt"
          FROM river_levels
          WHERE ${whereClause}
          ORDER BY river_name, station_name, measured_at DESC
        `;

        res.json({
          success: true,
          data: latestLevels,
          meta: { total: latestLevels.length, page: 1, limit: latestLevels.length },
        });
        return;
      }

      const where: Prisma.RiverLevelWhereInput = { deletedAt: null };
      if (q.riverName) where.riverName = q.riverName;
      if (q.stationName) where.stationName = q.stationName;

      const orderBy: Prisma.RiverLevelOrderByWithRelationInput =
        q.sort === "level_cm"
          ? { levelCm: q.order as Prisma.SortOrder }
          : { measuredAt: q.order as Prisma.SortOrder };

      const [items, total] = await Promise.all([
        prisma.riverLevel.findMany({
          where,
          orderBy,
          skip: (q.page - 1) * q.limit,
          take: q.limit,
        }),
        prisma.riverLevel.count({ where }),
      ]);

      res.json({
        success: true,
        data: items,
        meta: { total, page: q.page, limit: q.limit },
      });
    } catch (err) {
      next(err);
    }
  }
);

router.get("/:id", async (req, res, next) => {
  try {
    const id = paramId(req);
    const level = await prisma.riverLevel.findFirst({
      where: { id, deletedAt: null },
    });

    if (!level) {
      throw new AppError(404, "NOT_FOUND", "Данные об уровне реки не найдены");
    }

    res.json({ success: true, data: level });
  } catch (err) {
    next(err);
  }
});

router.post(
  "/",
  requireAuth,
  requireRole("coordinator", "admin"),
  validateBody(CreateRiverLevelSchema),
  async (req, res, next) => {
    try {
      const { riverName, stationName, lat, lng, levelCm, dangerLevelCm, trend, measuredAt } = req.body;

      const level = await prisma.riverLevel.create({
        data: {
          riverName,
          stationName,
          lat,
          lng,
          levelCm,
          dangerLevelCm,
          trend,
          measuredAt: new Date(measuredAt),
        },
      });

      emitRiverLevelUpdated(level as unknown as RiverLevel);

      res.status(201).json({ success: true, data: level });
    } catch (err) {
      next(err);
    }
  }
);

router.delete(
  "/:id",
  requireAuth,
  requireRole("coordinator", "admin"),
  async (req, res, next) => {
    try {
      const id = paramId(req);
      const existing = await prisma.riverLevel.findFirst({
        where: { id, deletedAt: null },
      });

      if (!existing) {
        throw new AppError(404, "NOT_FOUND", "Данные об уровне реки не найдены");
      }

      await prisma.riverLevel.update({
        where: { id },
        data: { deletedAt: new Date() },
      });

      res.json({ success: true, data: { id, deleted: true } });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
