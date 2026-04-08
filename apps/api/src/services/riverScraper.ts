// SPDX-License-Identifier: AGPL-3.0-only

import { prisma } from "@samur/db";
import type { RiverTrend } from "@samur/shared";
import { logger } from "../lib/logger.js";
import { emitRiverLevelUpdated, emitAlertBroadcast } from "../lib/emitter.js";
import type { RiverLevel, Alert } from "@samur/shared";
import { DAGESTAN_GAUGES, stationKey } from "./gaugeStations.js";
import type { GaugeStation } from "./gaugeStations.js";

const log = logger.child({ service: "river-scraper" });

const ALLRIVERS_BASE = "https://allrivers.info";
const UROVEN_BASE = "https://urovenvody.ru";
const FETCH_TIMEOUT = 15_000; // 15s per request
const MAX_RETRIES = 2;

// ── Scraping result ──────────────────────────────────────────────────────

interface ScrapeResult {
  levelCm: number;
  measuredAt: Date;
  source: "allrivers" | "urovenvody";
}

// ── HTTP fetch with timeout and retries ──────────────────────────────────

async function fetchWithRetry(url: string, retries = MAX_RETRIES): Promise<string | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Samur-FloodMonitor/1.0 (flood relief platform; contact: admin@samur.dag)",
          "Accept": "text/html,application/xhtml+xml",
          "Accept-Language": "ru-RU,ru;q=0.9",
        },
      });
      clearTimeout(timeout);

      if (!res.ok) {
        log.warn({ url, status: res.status, attempt }, "HTTP error fetching gauge page");
        continue;
      }

      return await res.text();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ url, attempt, error: msg }, "Fetch failed");
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
  }
  return null;
}

// ── AllRivers.info parser ────────────────────────────────────────────────

/**
 * Parses water level from allrivers.info gauge page.
 *
 * IMPORTANT: allrivers.info pages contain two types of data:
 * 1. CURRENT operational level — phrased as "составляет <b>XXX</b> см над нулем поста"
 *    with a measurement date like "13 мая 2024"
 * 2. ARCHIVE "on this day" stats — min/avg/max from historical records
 *    phrased as "минимальный уровень: <b>XXX</b> см"
 *
 * Most Dagestan gauges currently show "к сожалению, неизвестны" (no operational data).
 * We MUST NOT scrape archive stats as if they were current readings.
 */
function parseAllRivers(html: string): ScrapeResult | null {
  // If the page explicitly says operational data is unavailable, return null.
  // This prevents falling through to patterns that would match archive stats.
  if (
    html.includes("к сожалению, неизвестны") ||
    html.includes("к сожалению, не известны") ||
    html.includes("данные.*отсутствуют") ||
    html.includes("нет данных")
  ) {
    // BUT check if there's still a stale operational reading on the page
    // (some pages show the last known reading even when "today" is unknown)
    const staleMatch = html.match(
      /составляет\s*<b>\s*(\d+(?:[.,]\d+)?)\s*<\/b>\s*см\s*над\s*нулем/i,
    );
    const dateMatch = html.match(
      /(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s+(\d{4})/i,
    );

    if (staleMatch && dateMatch) {
      const levelCm = parseFloat(staleMatch[1].replace(",", "."));
      const measuredAt = parseRussianDate(dateMatch[1], dateMatch[2], dateMatch[3]);
      if (levelCm > 0 && levelCm < 5000 && measuredAt) {
        return { levelCm, measuredAt, source: "allrivers" };
      }
    }

    return null;
  }

  // Look for CURRENT operational reading only.
  // The pattern is: "составляет <b>XXX</b> см над нулем поста"
  // This is the ONLY reliable indicator of an actual current measurement.
  const currentPatterns = [
    /составляет\s*<b>\s*(\d+(?:[.,]\d+)?)\s*<\/b>\s*см\s*над\s*нулем/i,
    /(?:текущий|нынешний|сегодняшний)\s+уровень\s+воды\s+составляет\s*<b>\s*(\d+(?:[.,]\d+)?)\s*<\/b>\s*см/i,
  ];

  for (const pattern of currentPatterns) {
    const match = html.match(pattern);
    if (match) {
      const levelCm = parseFloat(match[1].replace(",", "."));
      if (levelCm > 0 && levelCm < 5000) {
        // Try to parse measurement date from page
        const dateMatch = html.match(
          /(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s+(\d{4})/i,
        );
        const measuredAt = dateMatch
          ? parseRussianDate(dateMatch[1], dateMatch[2], dateMatch[3]) ?? new Date()
          : new Date();

        return { levelCm, measuredAt, source: "allrivers" };
      }
    }
  }

  return null;
}

const RUSSIAN_MONTHS: Record<string, number> = {
  января: 0, февраля: 1, марта: 2, апреля: 3,
  мая: 4, июня: 5, июля: 6, августа: 7,
  сентября: 8, октября: 9, ноября: 10, декабря: 11,
};

function parseRussianDate(day: string, month: string, year: string): Date | null {
  const m = RUSSIAN_MONTHS[month.toLowerCase()];
  if (m === undefined) return null;
  const d = new Date(parseInt(year), m, parseInt(day));
  if (isNaN(d.getTime())) return null;
  return d;
}

// ── urovenvody.ru parser ─────────────────────────────────────────────────

/**
 * Parses water level from urovenvody.ru gauge page.
 *
 * NOTE: As of April 2026, urovenvody.ru has SUSPENDED publication of
 * water level data for all Dagestan gauges. The parser handles this
 * gracefully but is kept ready for when the service resumes.
 */
function parseUrovenvody(html: string): ScrapeResult | null {
  // Check if data publication is suspended (this is currently the case)
  if (
    html.includes("временно прекращена") ||
    html.includes("публикация данных") ||
    html.includes("приостановлена")
  ) {
    return null;
  }

  // Only look for clearly labeled current readings, not historical stats
  const currentMatch = html.match(
    /(?:текущий|последний|актуальный)\s+уровень[^<]*?<[^>]*>\s*(\d+(?:[.,]\d+)?)\s*<\/[^>]*>\s*см/i,
  );
  if (currentMatch) {
    const levelCm = parseFloat(currentMatch[1].replace(",", "."));
    if (levelCm > 0 && levelCm < 5000) {
      return { levelCm, measuredAt: new Date(), source: "urovenvody" };
    }
  }

  return null;
}

// ── Trend calculation ────────────────────────────────────────────────────

function calculateTrend(
  currentLevel: number,
  previousLevel: number | null,
): RiverTrend {
  if (previousLevel === null) return "stable";
  const diff = currentLevel - previousLevel;
  const threshold = Math.max(previousLevel * 0.02, 2); // 2% or 2cm
  if (diff > threshold) return "rising";
  if (diff < -threshold) return "falling";
  return "stable";
}

// ── Single station scrape ────────────────────────────────────────────────

async function scrapeStation(station: GaugeStation): Promise<ScrapeResult | null> {
  // Try allrivers.info first
  if (station.allriversSlug) {
    const url = `${ALLRIVERS_BASE}/gauge/${station.allriversSlug}/waterlevel`;
    const html = await fetchWithRetry(url);
    if (html) {
      const result = parseAllRivers(html);
      if (result) {
        const ageHours = (Date.now() - result.measuredAt.getTime()) / (1000 * 60 * 60);
        log.info(
          {
            river: station.riverName,
            station: station.stationName,
            level: result.levelCm,
            source: "allrivers",
            measuredAt: result.measuredAt.toISOString(),
            stale: ageHours > 24,
          },
          ageHours > 24
            ? `Scraped water level (stale: ${Math.round(ageHours / 24)}d old)`
            : "Scraped water level (current)",
        );
        return result;
      }
    }
    log.debug({ slug: station.allriversSlug }, "No current data from allrivers.info");
  }

  // Fallback to urovenvody.ru
  if (station.urovenSlug) {
    const url = `${UROVEN_BASE}/gov/${station.urovenSlug}.php`;
    const html = await fetchWithRetry(url);
    if (html) {
      const result = parseUrovenvody(html);
      if (result) {
        log.info(
          { river: station.riverName, station: station.stationName, level: result.levelCm, source: "urovenvody" },
          "Scraped water level (fallback)",
        );
        return result;
      }
    }
    log.debug({ slug: station.urovenSlug }, "No current data from urovenvody.ru");
  }

  log.info(
    { river: station.riverName, station: station.stationName },
    "No operational data available from any source",
  );
  return null;
}

// ── Alert trigger ────────────────────────────────────────────────────────

async function checkAndTriggerAlert(
  station: GaugeStation,
  levelCm: number,
  previousLevel: number | null,
  trend: RiverTrend,
): Promise<void> {
  // Only trigger if crossing danger threshold upward
  if (levelCm < station.dangerLevelCm) return;
  if (previousLevel !== null && previousLevel >= station.dangerLevelCm) return; // already above

  const pct = Math.round((levelCm / station.dangerLevelCm) * 100);

  log.warn(
    { river: station.riverName, station: station.stationName, levelCm, dangerLevelCm: station.dangerLevelCm },
    "DANGER THRESHOLD CROSSED — creating alert",
  );

  try {
    // Find or use a system admin user for automated alerts
    let systemUser = await prisma.user.findFirst({
      where: { phone: "system_river_monitor" },
    });

    if (!systemUser) {
      systemUser = await prisma.user.create({
        data: {
          name: "Мониторинг рек",
          phone: "system_river_monitor",
          role: "admin",
          password: "", // no login possible
        },
      });
    }

    const trendLabel = trend === "rising" ? "↑ растёт" : trend === "falling" ? "↓ падает" : "→ стабильный";

    const alert = await prisma.alert.create({
      data: {
        authorId: systemUser.id,
        urgency: "critical",
        title: `⚠️ ${station.riverName}: уровень воды превысил опасную отметку`,
        body: [
          `Станция: ${station.stationName}`,
          `Уровень: ${levelCm} см (${pct}% от опасного)`,
          `Опасный уровень: ${station.dangerLevelCm} см`,
          `Тренд: ${trendLabel}`,
          "",
          "Будьте готовы к эвакуации. Следите за обновлениями.",
        ].join("\n"),
        channels: ["pwa", "telegram", "sms", "meshtastic"],
      },
      include: { author: { select: { id: true, name: true, role: true } } },
    });

    emitAlertBroadcast(alert as unknown as Alert);
  } catch (err) {
    log.error({ err, station: station.stationName }, "Failed to create danger alert");
  }
}

// ── Main scrape cycle ────────────────────────────────────────────────────

export interface ScrapeStats {
  total: number;
  scraped: number;
  failed: number;
  alerts: number;
  duration: number;
}

export async function scrapeAllStations(): Promise<ScrapeStats> {
  const start = Date.now();
  const stats: ScrapeStats = { total: 0, scraped: 0, failed: 0, alerts: 0, duration: 0 };

  log.info({ stationCount: DAGESTAN_GAUGES.length }, "Starting river level scrape cycle");

  for (const station of DAGESTAN_GAUGES) {
    stats.total++;

    try {
      const result = await scrapeStation(station);

      if (!result) {
        stats.failed++;
        log.debug(
          { river: station.riverName, station: station.stationName },
          "No data available from any source",
        );
        continue;
      }

      // Get previous reading for trend calculation
      const previous = await prisma.riverLevel.findFirst({
        where: {
          riverName: station.riverName,
          stationName: station.stationName,
          deletedAt: null,
        },
        orderBy: { measuredAt: "desc" },
        select: { levelCm: true, measuredAt: true },
      });

      // Skip if we already have a reading within the last 30 minutes
      // (avoid duplicate entries on rapid re-scrapes)
      if (previous && previous.measuredAt.getTime() > Date.now() - 30 * 60 * 1000) {
        const diff = Math.abs(result.levelCm - previous.levelCm);
        if (diff < 1) {
          log.debug(
            { river: station.riverName, station: station.stationName },
            "Skipping — recent reading unchanged",
          );
          stats.scraped++;
          continue;
        }
      }

      const trend = calculateTrend(result.levelCm, previous?.levelCm ?? null);

      const level = await prisma.riverLevel.create({
        data: {
          riverName: station.riverName,
          stationName: station.stationName,
          lat: station.lat,
          lng: station.lng,
          levelCm: result.levelCm,
          dangerLevelCm: station.dangerLevelCm,
          trend,
          measuredAt: result.measuredAt,
        },
      });

      emitRiverLevelUpdated(level as unknown as RiverLevel);

      // Check danger threshold
      await checkAndTriggerAlert(
        station,
        result.levelCm,
        previous?.levelCm ?? null,
        trend,
      );

      if (result.levelCm >= station.dangerLevelCm && (previous?.levelCm ?? 0) < station.dangerLevelCm) {
        stats.alerts++;
      }

      stats.scraped++;
    } catch (err) {
      stats.failed++;
      log.error(
        { err, river: station.riverName, station: station.stationName },
        "Error processing station",
      );
    }

    // Polite delay between requests to avoid hammering the source
    await new Promise((r) => setTimeout(r, 1500));
  }

  stats.duration = Date.now() - start;

  log.info(
    { ...stats },
    `Scrape cycle complete: ${stats.scraped}/${stats.total} stations, ${stats.failed} failed, ${stats.alerts} alerts`,
  );

  return stats;
}

/**
 * Seed the database with initial gauge station entries (level 0)
 * so they appear on the map even before scraping returns data.
 */
export async function seedGaugeStations(): Promise<number> {
  let seeded = 0;

  for (const station of DAGESTAN_GAUGES) {
    const existing = await prisma.riverLevel.findFirst({
      where: {
        riverName: station.riverName,
        stationName: station.stationName,
        deletedAt: null,
      },
    });

    if (!existing) {
      await prisma.riverLevel.create({
        data: {
          riverName: station.riverName,
          stationName: station.stationName,
          lat: station.lat,
          lng: station.lng,
          levelCm: 0,
          dangerLevelCm: station.dangerLevelCm,
          trend: "stable",
          measuredAt: new Date(),
        },
      });
      seeded++;
    }
  }

  if (seeded > 0) {
    log.info({ seeded }, "Seeded gauge stations into database");
  }

  return seeded;
}
