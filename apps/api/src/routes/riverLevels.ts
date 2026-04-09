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
import { DAGESTAN_GAUGES } from "../services/gaugeStations.js";
import { scrapeAllStations } from "../services/riverScraper.js";

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
            discharge_cubic_m as "dischargeCubicM",
            discharge_mean as "dischargeMean",
            discharge_max as "dischargeMax",
            discharge_median as "dischargeMedian",
            discharge_min as "dischargeMin",
            discharge_p25 as "dischargeP25",
            discharge_p75 as "dischargeP75",
            discharge_annual_mean as "dischargeAnnualMean",
            data_source as "dataSource",
            is_forecast as "isForecast",
            trend, measured_at as "measuredAt", created_at as "createdAt"
          FROM river_levels
          WHERE ${whereClause} AND is_forecast = false
          ORDER BY river_name, station_name, measured_at DESC
        `;

        res.json({
          success: true,
          data: latestLevels,
          meta: { total: latestLevels.length, page: 1, limit: latestLevels.length },
        });
        return;
      }

      const where: Prisma.RiverLevelWhereInput = { deletedAt: null, isForecast: false };
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

// ── Gauge stations metadata ──────────────────────────────────────────────

router.get("/stations", (_req, res) => {
  res.json({
    success: true,
    data: DAGESTAN_GAUGES.map((g) => ({
      riverName: g.riverName,
      stationName: g.stationName,
      lat: g.lat,
      lng: g.lng,
      dangerLevelCm: g.dangerLevelCm,
      hasAllrivers: !!g.allriversSlug,
      hasUrovenvody: !!g.urovenSlug,
      hasOpenMeteo: !!g.openMeteoLat,
      meanDischarge: g.meanDischarge,
      dangerDischarge: g.dangerDischarge,
    })),
  });
});

// ── History: last N days for a station (for sparkline charts) ─────────────

router.get("/history/:riverName/:stationName", async (req, res, next) => {
  try {
    const { riverName, stationName } = req.params;
    const parsedDays = parseInt(req.query.days as string, 10);
    const days = Math.min(Math.max(Number.isNaN(parsedDays) ? 7 : parsedDays, 1), 30);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const includeForecast = req.query.includeForecast === "true";

    const readings = await prisma.riverLevel.findMany({
      where: {
        riverName,
        stationName,
        deletedAt: null,
        measuredAt: { gte: since },
        ...(!includeForecast && { isForecast: false }),
      },
      orderBy: { measuredAt: "asc" },
      select: {
        levelCm: true,
        dangerLevelCm: true,
        dischargeCubicM: true,
        dischargeMean: true,
        dischargeMax: true,
        dischargeMedian: true,
        dischargeMin: true,
        dischargeP25: true,
        dischargeP75: true,
        dischargeAnnualMean: true,
        dataSource: true,
        isForecast: true,
        trend: true,
        measuredAt: true,
      },
    });

    res.json({ success: true, data: readings });
  } catch (err) {
    next(err);
  }
});

// ── Bulk forecast: all stations, observed + forecast for timeline ────────

router.get("/forecast", async (_req, res, next) => {
  try {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const readings = await prisma.riverLevel.findMany({
      where: {
        deletedAt: null,
        measuredAt: { gte: since },
      },
      orderBy: { measuredAt: "asc" },
      select: {
        riverName: true,
        stationName: true,
        lat: true,
        lng: true,
        levelCm: true,
        dangerLevelCm: true,
        dischargeCubicM: true,
        dischargeMean: true,
        dischargeMax: true,
        dischargeMedian: true,
        dischargeMin: true,
        dischargeP25: true,
        dischargeP75: true,
        dischargeAnnualMean: true,
        dataSource: true,
        isForecast: true,
        trend: true,
        measuredAt: true,
      },
    });

    res.json({ success: true, data: readings });
  } catch (err) {
    next(err);
  }
});

// ── Manual scrape trigger (admin only) ───────────────────────────────────

router.post(
  "/scrape",
  requireAuth,
  requireRole("admin"),
  async (_req, res, next) => {
    try {
      const stats = await scrapeAllStations();
      res.json({ success: true, data: stats });
    } catch (err) {
      next(err);
    }
  },
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
      const {
        riverName, stationName, lat, lng, levelCm, dangerLevelCm,
        dischargeCubicM, dischargeMean, dischargeMax, dataSource, isForecast,
        trend, measuredAt,
      } = req.body;

      const level = await prisma.riverLevel.create({
        data: {
          riverName,
          stationName,
          lat,
          lng,
          levelCm: levelCm ?? null,
          dangerLevelCm: dangerLevelCm ?? null,
          dischargeCubicM: dischargeCubicM ?? null,
          dischargeMean: dischargeMean ?? null,
          dischargeMax: dischargeMax ?? null,
          dataSource: dataSource ?? null,
          isForecast: isForecast ?? false,
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
