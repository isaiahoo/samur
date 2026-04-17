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
import { fetchAndStorePredictions, checkMlHealth, getAllAiStationMeta } from "../services/mlClient.js";

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
    // Cap at 60 days — the ML service needs up to 45 days of level history
    // to populate level_lag_14 features; a 30-day cap truncated it.
    const days = Math.min(Math.max(Number.isNaN(parsedDays) ? 7 : parsedDays, 1), 60);
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

// ── Historical data (AllRivers.info) ────────────────────────────────────

router.get("/historical/:riverName/:stationName/stats", async (req, res, next) => {
  try {
    const { riverName, stationName } = req.params;
    const stats = await prisma.historicalRiverStats.findMany({
      where: { riverName, stationName },
      orderBy: { dayOfYear: "asc" },
      select: {
        dayOfYear: true,
        avgCm: true,
        minCm: true,
        maxCm: true,
        p10Cm: true,
        p90Cm: true,
        sampleCount: true,
      },
    });
    res.json({ success: true, data: stats });
  } catch (err) {
    next(err);
  }
});

router.get("/historical/:riverName/:stationName/peaks", async (req, res, next) => {
  try {
    const { riverName, stationName } = req.params;
    const top = Math.min(Math.max(parseInt(String(req.query.top)) || 5, 1), 20);
    const peaks = await prisma.historicalRiverLevel.findMany({
      where: { riverName, stationName },
      orderBy: { valueCm: "desc" },
      take: top,
      select: { date: true, valueCm: true },
    });
    res.json({ success: true, data: peaks });
  } catch (err) {
    next(err);
  }
});

router.get("/historical/:riverName/:stationName", async (req, res, next) => {
  try {
    const { riverName, stationName } = req.params;
    const limit = Math.min(Math.max(parseInt(String(req.query.limit)) || 10000, 1), 10000);

    const dateFilter: { gte?: Date; lte?: Date } = {};
    if (req.query.from) dateFilter.gte = new Date(String(req.query.from));
    if (req.query.to) dateFilter.lte = new Date(String(req.query.to));

    const data = await prisma.historicalRiverLevel.findMany({
      where: {
        riverName,
        stationName,
        ...(Object.keys(dateFilter).length > 0 ? { date: dateFilter } : {}),
      },
      orderBy: { date: "asc" },
      take: limit,
      select: { date: true, valueCm: true, source: true },
    });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

// ── Кунак AI predictions ──────────────────────────────────────────────

router.get("/ai-forecast", async (_req, res, next) => {
  try {
    const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const predictions = await prisma.riverLevel.findMany({
      where: {
        dataSource: { in: ["samur-ai", "samur-ai-climatology"] },
        isForecast: true,
        deletedAt: null,
        measuredAt: { gte: since },
      },
      orderBy: { measuredAt: "asc" },
      select: {
        riverName: true,
        stationName: true,
        levelCm: true,
        dangerLevelCm: true,
        predictionLower: true,
        predictionUpper: true,
        trend: true,
        measuredAt: true,
        createdAt: true,
        dataSource: true,
      },
    });
    res.json({
      success: true,
      data: predictions,
      meta: { skills: getAllAiStationMeta() },
    });
  } catch (err) {
    next(err);
  }
});

// Retrospective skill: for each (station, horizon) pair, compute NSE / RMSE /
// bias over the last N days of evaluated forecasts (target_date ≤ today).
// This is the "forecast vs. actual" drift signal for operators.
router.get("/ai-skill", async (req, res, next) => {
  try {
    const parsedDays = parseInt(String(req.query.days), 10);
    const days = Math.min(Math.max(Number.isNaN(parsedDays) ? 30 : parsedDays, 1), 180);

    // Evaluation window: snapshots whose target_date fell within the last N days.
    // We exclude today (target_date < today) because the observed row for today
    // may still be a forecast or may not yet have a rating-curve estimate.
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const windowStart = new Date(today.getTime() - days * 86_400_000);

    const snapshots = await prisma.forecastSnapshot.findMany({
      where: {
        targetDate: { gte: windowStart, lt: today },
      },
      select: {
        riverName: true,
        stationName: true,
        horizonDays: true,
        targetDate: true,
        predictedCm: true,
        dataSource: true,
      },
    });

    if (snapshots.length === 0) {
      res.json({
        success: true,
        data: [],
        meta: {
          days,
          windowStart: windowStart.toISOString(),
          windowEnd: today.toISOString(),
          totalSnapshots: 0,
        },
      });
      return;
    }

    // Fetch observed levels across all target_dates in the window, all stations
    // referenced. One query instead of per-group.
    const stationKeys = new Set(
      snapshots.map((s) => `${s.riverName}::${s.stationName}`),
    );
    const observedRows = await prisma.riverLevel.findMany({
      where: {
        deletedAt: null,
        isForecast: false,
        measuredAt: { gte: windowStart, lt: today },
        levelCm: { not: null },
        OR: Array.from(stationKeys).map((k) => {
          const [riverName, stationName] = k.split("::");
          return { riverName, stationName };
        }),
      },
      select: {
        riverName: true,
        stationName: true,
        measuredAt: true,
        levelCm: true,
      },
    });

    // Build observed lookup: (station::YYYY-MM-DD) → levelCm
    const observedMap = new Map<string, number>();
    for (const r of observedRows) {
      if (r.levelCm === null) continue;
      const day = r.measuredAt.toISOString().slice(0, 10);
      const key = `${r.riverName}::${r.stationName}::${day}`;
      // If there are multiple observed rows for one day (shouldn't happen with
      // daily data), keep the first — they should agree to within noise.
      if (!observedMap.has(key)) observedMap.set(key, r.levelCm);
    }

    // Group snapshots by (riverName, stationName, horizonDays).
    interface Pair { pred: number; obs: number; climatology: boolean }
    const groups = new Map<string, { pairs: Pair[]; riverName: string; stationName: string; horizonDays: number }>();

    for (const s of snapshots) {
      const day = s.targetDate.toISOString().slice(0, 10);
      const obs = observedMap.get(`${s.riverName}::${s.stationName}::${day}`);
      if (obs === undefined) continue;
      const groupKey = `${s.riverName}::${s.stationName}::${s.horizonDays}`;
      let g = groups.get(groupKey);
      if (!g) {
        g = { pairs: [], riverName: s.riverName, stationName: s.stationName, horizonDays: s.horizonDays };
        groups.set(groupKey, g);
      }
      g.pairs.push({
        pred: s.predictedCm,
        obs,
        climatology: s.dataSource === "samur-ai-climatology",
      });
    }

    const data = Array.from(groups.values()).map((g) => {
      const { pairs } = g;
      const n = pairs.length;
      const meanObs = pairs.reduce((a, p) => a + p.obs, 0) / n;
      const sseObs = pairs.reduce((a, p) => a + (p.obs - meanObs) ** 2, 0);
      const ssePred = pairs.reduce((a, p) => a + (p.obs - p.pred) ** 2, 0);
      // NSE is undefined when there's zero observed variance (all obs equal).
      // In that case RMSE is still meaningful, so we return nse=null and let
      // the UI decide how to render.
      const nse = sseObs > 0 ? 1 - ssePred / sseObs : null;
      const rmse = Math.sqrt(ssePred / n);
      const bias = pairs.reduce((a, p) => a + (p.pred - p.obs), 0) / n;
      const climatologyShare = pairs.filter((p) => p.climatology).length / n;

      return {
        riverName: g.riverName,
        stationName: g.stationName,
        horizonDays: g.horizonDays,
        n,
        nse: nse === null ? null : Math.round(nse * 1000) / 1000,
        rmseCm: Math.round(rmse * 10) / 10,
        biasCm: Math.round(bias * 10) / 10,
        climatologyShare: Math.round(climatologyShare * 100) / 100,
      };
    });

    data.sort((a, b) => {
      if (a.riverName !== b.riverName) return a.riverName.localeCompare(b.riverName);
      if (a.stationName !== b.stationName) return a.stationName.localeCompare(b.stationName);
      return a.horizonDays - b.horizonDays;
    });

    res.json({
      success: true,
      data,
      meta: {
        days,
        windowStart: windowStart.toISOString(),
        windowEnd: today.toISOString(),
        totalSnapshots: snapshots.length,
        evaluatedPairs: data.reduce((a, d) => a + d.n, 0),
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get("/ai-health", async (_req, res, next) => {
  try {
    const health = await checkMlHealth();
    res.json({ success: true, data: health });
  } catch (err) {
    next(err);
  }
});

router.post(
  "/ai-predict",
  requireAuth,
  requireRole("admin"),
  async (_req, res, next) => {
    try {
      const result = await fetchAndStorePredictions();
      res.json({ success: true, data: result });
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
