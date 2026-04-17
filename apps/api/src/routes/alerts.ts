// SPDX-License-Identifier: AGPL-3.0-only
import { Router } from "express";
import { prisma, Prisma } from "@samur/db";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import {
  CreateAlertSchema,
  UpdateAlertSchema,
  AlertQuerySchema,
} from "@samur/shared";
import type { Alert } from "@samur/shared";
import { AppError } from "../middleware/error.js";
import { emitAlertBroadcast } from "../lib/emitter.js";
import { paramId } from "../lib/params.js";

const router = Router();

// Situation summary — served to the Alerts tab so the page has a reason
// to exist even when no critical broadcast is active. Returns aggregate
// counts for incidents/help/quakes plus the latest RiverLevel rows so
// the frontend can bucketize by tier using the shared computeTier.
router.get("/situation", async (_req, res, next) => {
  try {
    const DAY = 24 * 60 * 60 * 1000;
    const since = new Date(Date.now() - DAY);

    const latestLevelsPromise = prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT DISTINCT ON (river_name, station_name)
        river_name as "riverName", station_name as "stationName",
        lat, lng, level_cm as "levelCm", danger_level_cm as "dangerLevelCm",
        discharge_cubic_m as "dischargeCubicM",
        discharge_mean as "dischargeMean",
        discharge_max as "dischargeMax",
        discharge_annual_mean as "dischargeAnnualMean",
        data_source as "dataSource",
        is_forecast as "isForecast",
        trend, measured_at as "measuredAt"
      FROM river_levels
      WHERE deleted_at IS NULL AND is_forecast = false
      ORDER BY river_name, station_name, measured_at DESC
    `;

    const [latestLevels, incidentsActive, helpUrgent, helpCritical, quakes24h, quakesStrong24h] = await Promise.all([
      latestLevelsPromise,
      prisma.incident.count({
        where: {
          deletedAt: null,
          status: { notIn: ["resolved", "false_report"] },
        },
      }),
      prisma.helpRequest.count({
        where: { deletedAt: null, urgency: "urgent", status: { notIn: ["completed", "cancelled"] } },
      }),
      prisma.helpRequest.count({
        where: { deletedAt: null, urgency: "critical", status: { notIn: ["completed", "cancelled"] } },
      }),
      prisma.earthquake.count({ where: { time: { gte: since } } }),
      prisma.earthquake.count({ where: { time: { gte: since }, magnitude: { gte: 4.5 } } }),
    ]);

    res.json({
      success: true,
      data: {
        riverLevels: latestLevels,
        incidents: { active: incidentsActive },
        helpRequests: { urgent: helpUrgent, critical: helpCritical },
        earthquakes: { last24h: quakes24h, last24hStrong: quakesStrong24h },
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get(
  "/",
  validateQuery(AlertQuerySchema),
  async (req, res, next) => {
    try {
      const q = (req as unknown as { parsedQuery: Record<string, unknown> }).parsedQuery as {
        page: number; limit: number; urgency?: string; active?: boolean;
        sort: string; order: string;
      };

      const where: Prisma.AlertWhereInput = { deletedAt: null };

      if (q.urgency) where.urgency = q.urgency as never;
      if (q.active) {
        where.OR = [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ];
      }

      const orderBy: Prisma.AlertOrderByWithRelationInput =
        q.sort === "urgency"
          ? { urgency: q.order as Prisma.SortOrder }
          : { sentAt: q.order as Prisma.SortOrder };

      const [items, total] = await Promise.all([
        prisma.alert.findMany({
          where,
          orderBy,
          skip: (q.page - 1) * q.limit,
          take: q.limit,
          include: { author: { select: { id: true, name: true, role: true } } },
        }),
        prisma.alert.count({ where }),
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
    const alert = await prisma.alert.findFirst({
      where: { id, deletedAt: null },
      include: { author: { select: { id: true, name: true, role: true } } },
    });

    if (!alert) {
      throw new AppError(404, "NOT_FOUND", "Оповещение не найдено");
    }

    res.json({ success: true, data: alert });
  } catch (err) {
    next(err);
  }
});

router.post(
  "/",
  requireAuth,
  requireRole("coordinator", "admin"),
  validateBody(CreateAlertSchema),
  async (req, res, next) => {
    try {
      const { urgency, title, body, channels, expiresAt } = req.body;

      const alert = await prisma.alert.create({
        data: {
          authorId: req.user!.sub,
          urgency,
          source: "manual",
          title,
          body,
          channels,
          expiresAt: expiresAt ? new Date(expiresAt) : null,
        },
        include: { author: { select: { id: true, name: true, role: true } } },
      });

      emitAlertBroadcast(alert as unknown as Alert);

      res.status(201).json({ success: true, data: alert });
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  "/:id",
  requireAuth,
  requireRole("coordinator", "admin"),
  validateBody(UpdateAlertSchema),
  async (req, res, next) => {
    try {
      const id = paramId(req);
      const existing = await prisma.alert.findFirst({
        where: { id, deletedAt: null },
      });

      if (!existing) {
        throw new AppError(404, "NOT_FOUND", "Оповещение не найдено");
      }

      const data: Prisma.AlertUpdateInput = {};
      if (req.body.title !== undefined) data.title = req.body.title;
      if (req.body.body !== undefined) data.body = req.body.body;
      if (req.body.expiresAt !== undefined) {
        data.expiresAt = req.body.expiresAt ? new Date(req.body.expiresAt) : null;
      }

      const updated = await prisma.alert.update({
        where: { id },
        data,
        include: { author: { select: { id: true, name: true, role: true } } },
      });

      res.json({ success: true, data: updated });
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
      const existing = await prisma.alert.findFirst({
        where: { id, deletedAt: null },
      });

      if (!existing) {
        throw new AppError(404, "NOT_FOUND", "Оповещение не найдено");
      }

      await prisma.alert.update({
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
