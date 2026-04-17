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

/**
 * Context feed — curated slices of recent regional signals that together
 * answer "what's been going on?" without duplicating the dedicated
 * News/Map/Help tabs. Every item is a teaser with a deep-link. Four
 * independent sources: one failing only removes its slice from the feed.
 *
 * The AI-watch slice is the feed's unique value: stations whose forecast
 * peak sits between 50% and 75% of danger — below the 75% alert
 * threshold (so no banner), but above "all clear". Those stations
 * don't surface anywhere else in the UI right now.
 */
router.get("/context", async (_req, res, next) => {
  try {
    const DAY = 24 * 60 * 60 * 1000;
    const now = new Date();
    const since24h = new Date(now.getTime() - DAY);
    const since48h = new Date(now.getTime() - 2 * DAY);

    // Keyword filter for flood-relevant news. Case-insensitive and
    // intentionally broad — the News tab's own scraper will surface
    // anything else; we just pick the items a flood-app user would
    // want to see as context on the Alerts screen.
    const FLOOD_KEYWORDS = [
      "наводнен", "паводок", "паводк", "затоплен", "подтоплен",
      "ливень", "ливн", "шторм",
      "сель", "селев", "оползень", "оползн", "обрушен",
      "эвакуац", "МЧС", "стихийн", "чрезвычайн",
    ];
    const keywordClauses = FLOOD_KEYWORDS.flatMap((kw) => [
      { title: { contains: kw, mode: "insensitive" } as const },
      { summary: { contains: kw, mode: "insensitive" } as const },
    ]);

    const [newsItems, quakeItems, helpItems, aiWatchForecasts] = await Promise.all([
      prisma.newsArticle.findMany({
        where: {
          deletedAt: null,
          publishedAt: { gte: since24h },
          OR: keywordClauses,
        },
        orderBy: { publishedAt: "desc" },
        take: 5,
        select: { id: true, title: true, publishedAt: true, feedId: true, url: true },
      }),
      prisma.earthquake.findMany({
        where: {
          time: { gte: since48h },
          magnitude: { gte: 3.5, lt: 5.0 },
        },
        orderBy: { time: "desc" },
        take: 3,
        select: { id: true, magnitude: true, depth: true, place: true, time: true },
      }),
      prisma.helpRequest.findMany({
        where: {
          deletedAt: null,
          createdAt: { gte: since24h },
          urgency: { in: ["critical", "urgent"] },
          status: { notIn: ["completed", "cancelled"] },
        },
        orderBy: { createdAt: "desc" },
        take: 3,
        select: { id: true, category: true, urgency: true, address: true, createdAt: true },
      }),
      // AI-watch: samur-ai (live-source) forecasts for future days. We
      // aggregate per station downstream to find peak-upper and filter
      // to the 50–75% window.
      prisma.riverLevel.findMany({
        where: {
          dataSource: "samur-ai",
          isForecast: true,
          deletedAt: null,
          measuredAt: { gte: now },
        },
        select: {
          riverName: true, stationName: true,
          levelCm: true, dangerLevelCm: true,
          predictionUpper: true, measuredAt: true,
        },
      }),
    ]);

    interface ContextItem {
      id: string;
      kind: "news" | "quake" | "help" | "ai-watch";
      timestamp: string;
      title: string;
      subtitle?: string;
      navigateTo?: string;
      icon: string;
    }

    const items: ContextItem[] = [];

    for (const n of newsItems) {
      items.push({
        id: `news:${n.id}`,
        kind: "news",
        timestamp: n.publishedAt.toISOString(),
        title: n.title,
        subtitle: n.feedId,
        navigateTo: "/news",
        icon: "📰",
      });
    }

    for (const q of quakeItems) {
      items.push({
        id: `quake:${q.id}`,
        kind: "quake",
        timestamp: q.time.toISOString(),
        title: `Землетрясение M${q.magnitude.toFixed(1)}`,
        subtitle: `${q.place} · глубина ${Math.round(q.depth)} км`,
        navigateTo: "/",
        icon: "🌋",
      });
    }

    const HELP_CAT_LABELS: Record<string, string> = {
      food: "Еда", water: "Вода", medical: "Медпомощь", shelter: "Убежище",
      transport: "Транспорт", evacuation: "Эвакуация", rescue: "Спасение",
      other: "Другое",
    };
    for (const h of helpItems) {
      items.push({
        id: `help:${h.id}`,
        kind: "help",
        timestamp: h.createdAt.toISOString(),
        title: `Срочная помощь: ${HELP_CAT_LABELS[h.category] ?? h.category}`,
        subtitle: h.address ?? undefined,
        navigateTo: "/help",
        icon: "🆘",
      });
    }

    // AI-watch: aggregate forecasts per station, keep peak, filter 50–75%.
    const peakByStation = new Map<string, { riverName: string; stationName: string; pct: number; peakAt: Date }>();
    for (const f of aiWatchForecasts) {
      const danger = f.dangerLevelCm ?? 0;
      if (danger <= 0) continue;
      const upper = f.predictionUpper ?? f.levelCm ?? 0;
      if (upper <= 0) continue;
      const pct = upper / danger;
      const key = `${f.riverName}::${f.stationName}`;
      const cur = peakByStation.get(key);
      if (!cur || pct > cur.pct) {
        peakByStation.set(key, { riverName: f.riverName, stationName: f.stationName, pct, peakAt: f.measuredAt });
      }
    }
    for (const p of peakByStation.values()) {
      if (p.pct < 0.5 || p.pct >= 0.75) continue;
      items.push({
        id: `ai-watch:${p.riverName}::${p.stationName}`,
        kind: "ai-watch",
        timestamp: p.peakAt.toISOString(),
        title: `${p.riverName} — ${p.stationName}: ${Math.round(p.pct * 100)}% до опасного`,
        subtitle: `Прогноз ИИ · пик ${p.peakAt.toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" })}`,
        navigateTo: "/",
        icon: "🤖",
      });
    }

    items.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
    const capped = items.slice(0, 20);

    res.set("Cache-Control", "public, max-age=300");
    res.json({
      success: true,
      data: capped,
      meta: {
        total: capped.length,
        sources: {
          news: newsItems.length,
          quakes: quakeItems.length,
          help: helpItems.length,
          aiWatch: capped.filter((i) => i.kind === "ai-watch").length,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

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
