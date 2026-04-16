// SPDX-License-Identifier: AGPL-3.0-only

import { prisma } from "@samur/db";
import type { RiverTrend } from "@samur/shared";
import { logger } from "../lib/logger.js";
import { emitRiverLevelUpdated, emitAlertBroadcast } from "../lib/emitter.js";
import type { RiverLevel, Alert } from "@samur/shared";
import { DAGESTAN_GAUGES, stationKey } from "./gaugeStations.js";
import type { GaugeStation } from "./gaugeStations.js";
import { fetchDischargeForStations } from "./openMeteoClient.js";
import type { DischargeReading } from "./openMeteoClient.js";
import { estimateLevelCm } from "./ratingCurve.js";

const log = logger.child({ service: "river-scraper" });

const ALLRIVERS_BASE = "https://allrivers.info";
const UROVEN_BASE = "https://urovenvody.ru";
const FETCH_TIMEOUT = 15_000; // 15s per request
const MAX_RETRIES = 2;

// ── Scraping result ──────────────────────────────────────────────────────

interface ScrapeResult {
  levelCm: number | null;
  dischargeCubicM: number | null;
  dischargeMean: number | null;
  dischargeMax: number | null;
  dischargeMedian: number | null;
  dischargeMin: number | null;
  dischargeP25: number | null;
  dischargeP75: number | null;
  measuredAt: Date;
  source: "allrivers" | "urovenvody" | "open-meteo";
  isForecast: boolean;
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
    /данные.*отсутствуют/.test(html) ||
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
        return { levelCm, dischargeCubicM: null, dischargeMean: null, dischargeMax: null, dischargeMedian: null, dischargeMin: null, dischargeP25: null, dischargeP75: null, measuredAt, source: "allrivers", isForecast: false };
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

        return { levelCm, dischargeCubicM: null, dischargeMean: null, dischargeMax: null, dischargeMedian: null, dischargeMin: null, dischargeP25: null, dischargeP75: null, measuredAt, source: "allrivers", isForecast: false };
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
      return { levelCm, dischargeCubicM: null, dischargeMean: null, dischargeMax: null, dischargeMedian: null, dischargeMin: null, dischargeP25: null, dischargeP75: null, measuredAt: new Date(), source: "urovenvody", isForecast: false };
    }
  }

  return null;
}

// ── Trend calculation ────────────────────────────────────────────────────

function calculateTrend(
  currentLevel: number | null,
  previousLevel: number | null,
  currentDischarge: number | null = null,
  previousDischarge: number | null = null,
): RiverTrend {
  // Prefer cm-based trend if available
  if (currentLevel !== null && previousLevel !== null) {
    const diff = currentLevel - previousLevel;
    const threshold = Math.max(previousLevel * 0.02, 2); // 2% or 2cm
    if (diff > threshold) return "rising";
    if (diff < -threshold) return "falling";
    return "stable";
  }
  // Fall back to discharge-based trend
  if (currentDischarge !== null && previousDischarge !== null) {
    const diff = currentDischarge - previousDischarge;
    const threshold = Math.max(previousDischarge * 0.05, 1); // 5% or 1 m³/s
    if (diff > threshold) return "rising";
    if (diff < -threshold) return "falling";
    return "stable";
  }
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
  result: ScrapeResult,
  previousLevel: number | null,
  previousDischarge: number | null,
  trend: RiverTrend,
): Promise<boolean> {
  // Check cm-based danger
  const levelCm = result.levelCm;
  const discharge = result.dischargeCubicM;
  // Use station's configured danger threshold, NOT Open-Meteo's per-day historical max
  const dangerDischarge = station.dangerDischarge;

  let isDanger = false;
  let alertBody: string[];

  if (levelCm !== null && levelCm >= station.dangerLevelCm) {
    // Only trigger if crossing threshold upward
    if (previousLevel !== null && previousLevel >= station.dangerLevelCm) return false;
    isDanger = true;
    const pct = Math.round((levelCm / station.dangerLevelCm) * 100);
    alertBody = [
      `Станция: ${station.stationName}`,
      `Уровень: ${levelCm} см (${pct}% от опасного)`,
      `Опасный уровень: ${station.dangerLevelCm} см`,
    ];
  } else if (discharge !== null && dangerDischarge !== null && discharge >= dangerDischarge) {
    // Only trigger if crossing threshold upward
    if (previousDischarge !== null && previousDischarge >= dangerDischarge) return false;
    isDanger = true;
    const pct = Math.round((discharge / dangerDischarge) * 100);
    alertBody = [
      `Станция: ${station.stationName}`,
      `Расход воды: ${discharge} м³/с (${pct}% от опасного)`,
      `Опасный расход: ${dangerDischarge} м³/с`,
    ];
  }

  if (!isDanger) return false;

  const trendLabel = trend === "rising" ? "↑ растёт" : trend === "falling" ? "↓ падает" : "→ стабильный";
  alertBody!.push(`Тренд: ${trendLabel}`, "", "Будьте готовы к эвакуации. Следите за обновлениями.");

  log.warn(
    { river: station.riverName, station: station.stationName, levelCm, discharge, dangerDischarge },
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

    const alert = await prisma.alert.create({
      data: {
        authorId: systemUser.id,
        urgency: "critical",
        title: `⚠️ ${station.riverName}: уровень воды превысил опасную отметку`,
        body: alertBody!.join("\n"),
        channels: ["pwa", "telegram", "sms", "meshtastic"],
      },
      include: { author: { select: { id: true, name: true, role: true } } },
    });

    emitAlertBroadcast(alert as unknown as Alert);
    return true;
  } catch (err) {
    log.error({ err, station: station.stationName }, "Failed to create danger alert");
    return false;
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

  // Step 1: HTML scrape all stations (allrivers → urovenvody)
  const htmlResults = new Map<string, ScrapeResult>();

  for (const station of DAGESTAN_GAUGES) {
    const result = await scrapeStation(station);
    if (result) {
      htmlResults.set(stationKey(station.riverName, station.stationName), result);
    }
    // Polite delay between HTML requests
    await new Promise((r) => setTimeout(r, 1500));
  }

  // Step 2: Batch fetch Open-Meteo discharge for all calibrated stations
  let dischargeData = new Map<string, DischargeReading[]>();
  try {
    dischargeData = await fetchDischargeForStations(DAGESTAN_GAUGES);
  } catch (err) {
    log.error({ err }, "Open-Meteo batch fetch failed");
  }

  // Step 3: Merge and store results
  for (const station of DAGESTAN_GAUGES) {
    stats.total++;
    const key = stationKey(station.riverName, station.stationName);

    try {
      const htmlResult = htmlResults.get(key) ?? null;
      const readings = dischargeData.get(key) ?? [];
      const today = new Date().toISOString().slice(0, 10);
      const pastReadings = readings
        .filter((r) => !r.isForecast && r.date <= today)
        .sort((a, b) => b.date.localeCompare(a.date));
      const todayReading = pastReadings[0] ?? null;

      // Rolling 3-day / 7-day discharge means for the rating-curve features
      const meanOf = (n: number): number | null => {
        const slice = pastReadings.slice(0, n).map((r) => r.discharge).filter((v) => v > 0);
        if (slice.length === 0) return null;
        return slice.reduce((a, b) => a + b, 0) / slice.length;
      };
      const rolling3 = meanOf(3);
      const rolling7 = meanOf(7);

      // If HTML scraping didn't give us a level, try the offline-fitted
      // rating curve (level = seasonal-rolling function of GloFAS discharge).
      // Present only for stations with R² ≥ 0.4 on the held-out year;
      // returns null otherwise and the old NULL fallback applies.
      const curveLevel = !htmlResult && todayReading
        ? estimateLevelCm(
            station.riverName,
            station.stationName,
            todayReading.discharge,
            rolling3,
            rolling7,
            new Date(todayReading.date + "T12:00:00Z"),
          )
        : null;

      // Merge: prefer HTML cm + Open-Meteo discharge together
      const merged: ScrapeResult | null = htmlResult
        ? {
            ...htmlResult,
            dischargeCubicM: todayReading?.discharge ?? null,
            dischargeMean: todayReading?.dischargeMean ?? null,
            dischargeMax: todayReading?.dischargeMax ?? null,
            dischargeMedian: todayReading?.dischargeMedian ?? null,
            dischargeMin: todayReading?.dischargeMin ?? null,
            dischargeP25: todayReading?.dischargeP25 ?? null,
            dischargeP75: todayReading?.dischargeP75 ?? null,
          }
        : todayReading
          ? {
              levelCm: curveLevel?.levelCm ?? null,
              dischargeCubicM: todayReading.discharge,
              dischargeMean: todayReading.dischargeMean,
              dischargeMax: todayReading.dischargeMax,
              dischargeMedian: todayReading.dischargeMedian,
              dischargeMin: todayReading.dischargeMin,
              dischargeP25: todayReading.dischargeP25,
              dischargeP75: todayReading.dischargeP75,
              measuredAt: new Date(todayReading.date + "T12:00:00Z"),
              source: curveLevel ? ("open-meteo" as const) : ("open-meteo" as const),
              isForecast: false,
            }
          : null;

      if (curveLevel) {
        log.debug(
          { river: station.riverName, station: station.stationName,
            discharge: todayReading?.discharge, level: curveLevel.levelCm, r2: curveLevel.r2 },
          "level_cm derived from rating curve",
        );
      }

      if (!merged) {
        stats.failed++;
        log.debug({ river: station.riverName, station: station.stationName }, "No data from any source");
        continue;
      }

      // ── Past-day history: upsert older pastReadings *before* the
      //    today-specific dedup path (which may `continue` and skip
      //    everything below). We want historical rows to keep
      //    populating even when today's reading is deduped.
      //    Every row gets a rating-curve level if applicable.
      for (let i = 1; i < pastReadings.length; i++) {
        const past = pastReadings[i];
        const win3 = pastReadings.slice(i, Math.min(i + 3, pastReadings.length))
          .map((r) => r.discharge).filter((v) => v > 0);
        const win7 = pastReadings.slice(i, Math.min(i + 7, pastReadings.length))
          .map((r) => r.discharge).filter((v) => v > 0);
        const m3 = win3.length > 0 ? win3.reduce((a, b) => a + b, 0) / win3.length : null;
        const m7 = win7.length > 0 ? win7.reduce((a, b) => a + b, 0) / win7.length : null;

        const pastMeasuredAt = new Date(past.date + "T12:00:00Z");
        const pastCurve = estimateLevelCm(
          station.riverName, station.stationName,
          past.discharge, m3, m7, pastMeasuredAt,
        );

        try {
          await prisma.riverLevel.upsert({
            where: {
              riverName_stationName_measuredAt: {
                riverName: station.riverName,
                stationName: station.stationName,
                measuredAt: pastMeasuredAt,
              },
            },
            update: {
              levelCm: pastCurve?.levelCm ?? null,
              dangerLevelCm: pastCurve ? station.dangerLevelCm : null,
              dischargeCubicM: past.discharge,
              dischargeMean: past.dischargeMean,
              dischargeMax: past.dischargeMax,
              dischargeMedian: past.dischargeMedian,
              dischargeMin: past.dischargeMin,
              dischargeP25: past.dischargeP25,
              dischargeP75: past.dischargeP75,
              dischargeAnnualMean: station.meanDischarge,
              dataSource: "open-meteo",
              isForecast: false,
            },
            create: {
              riverName: station.riverName,
              stationName: station.stationName,
              measuredAt: pastMeasuredAt,
              lat: station.lat,
              lng: station.lng,
              levelCm: pastCurve?.levelCm ?? null,
              dangerLevelCm: pastCurve ? station.dangerLevelCm : null,
              dischargeCubicM: past.discharge,
              dischargeMean: past.dischargeMean,
              dischargeMax: past.dischargeMax,
              dischargeMedian: past.dischargeMedian,
              dischargeMin: past.dischargeMin,
              dischargeP25: past.dischargeP25,
              dischargeP75: past.dischargeP75,
              dischargeAnnualMean: station.meanDischarge,
              dataSource: "open-meteo",
              isForecast: false,
              trend: "stable",
            },
          });
        } catch (err) {
          log.debug({ river: station.riverName, station: station.stationName, date: past.date, err: String(err) },
                    "Failed to upsert past-day row");
        }
      }

      // Get previous reading for trend + dedup
      const previous = await prisma.riverLevel.findFirst({
        where: {
          riverName: station.riverName,
          stationName: station.stationName,
          isForecast: false,
          deletedAt: null,
        },
        orderBy: { measuredAt: "desc" },
        select: { levelCm: true, dischargeCubicM: true, dataSource: true, measuredAt: true },
      });

      // Dedup: skip if we already have a reading with the same measuredAt date/time
      if (previous) {
        const prevDate = previous.measuredAt.toISOString().slice(0, 10);
        const mergedDate = merged.measuredAt.toISOString().slice(0, 10);
        const isDaily = merged.source === "open-meteo";
        const isRecent = previous.measuredAt.getTime() > Date.now() - 30 * 60 * 1000;
        // Seed records (no dataSource, no real measurements) should never block real data
        const prevIsSeed = previous.dataSource === null && previous.levelCm === null && previous.dischargeCubicM === null;

        // For daily data: skip if same calendar day already stored with real data
        // For hourly data: skip if stored within last 30 min and value unchanged
        const shouldSkip = !prevIsSeed && (isDaily
          ? prevDate === mergedDate
          : isRecent && (
              (merged.levelCm !== null && previous.levelCm !== null && Math.abs(merged.levelCm - previous.levelCm) < 1) ||
              (merged.dischargeCubicM !== null && previous.dischargeCubicM !== null && Math.abs(merged.dischargeCubicM - previous.dischargeCubicM) < 0.5)
            ));

        if (shouldSkip) {
          log.debug({ station: key, source: merged.source }, "Skipping — recent reading unchanged");
          stats.scraped++;
          continue;
        }
      }

      const trend = calculateTrend(
        merged.levelCm, previous?.levelCm ?? null,
        merged.dischargeCubicM, previous?.dischargeCubicM ?? null,
      );

      const levelData = {
        lat: station.lat,
        lng: station.lng,
        levelCm: merged.levelCm,
        dangerLevelCm: merged.levelCm !== null ? station.dangerLevelCm : null,
        dischargeCubicM: merged.dischargeCubicM,
        dischargeMean: merged.dischargeMean,
        dischargeMax: merged.dischargeMax,
        dischargeMedian: merged.dischargeMedian,
        dischargeMin: merged.dischargeMin,
        dischargeP25: merged.dischargeP25,
        dischargeP75: merged.dischargeP75,
        dischargeAnnualMean: station.meanDischarge,
        dataSource: merged.source,
        isForecast: false,
        trend,
      };

      const level = await prisma.riverLevel.upsert({
        where: {
          riverName_stationName_measuredAt: {
            riverName: station.riverName,
            stationName: station.stationName,
            measuredAt: merged.measuredAt,
          },
        },
        update: levelData,
        create: {
          riverName: station.riverName,
          stationName: station.stationName,
          measuredAt: merged.measuredAt,
          ...levelData,
        },
      });

      emitRiverLevelUpdated(level as unknown as RiverLevel);

      // Check danger threshold
      const alertTriggered = await checkAndTriggerAlert(station, merged, previous?.levelCm ?? null, previous?.dischargeCubicM ?? null, trend);
      if (alertTriggered) stats.alerts++;

      stats.scraped++;

      // Step 4: Store forecast rows from Open-Meteo (batched)
      const forecasts = readings.filter((r) => r.isForecast);
      if (forecasts.length > 0) {
        // Delete old forecasts for this station, then batch-insert new ones
        await prisma.riverLevel.deleteMany({
          where: {
            riverName: station.riverName,
            stationName: station.stationName,
            isForecast: true,
          },
        });

        await prisma.riverLevel.createMany({
          data: forecasts.map((fc) => ({
            riverName: station.riverName,
            stationName: station.stationName,
            lat: station.lat,
            lng: station.lng,
            levelCm: null,
            dangerLevelCm: null,
            dischargeCubicM: fc.discharge,
            dischargeMean: fc.dischargeMean,
            dischargeMax: fc.dischargeMax,
            dischargeMedian: fc.dischargeMedian,
            dischargeMin: fc.dischargeMin,
            dischargeP25: fc.dischargeP25,
            dischargeP75: fc.dischargeP75,
            dischargeAnnualMean: station.meanDischarge,
            dataSource: "open-meteo",
            isForecast: true,
            trend: "stable" as const,
            measuredAt: new Date(fc.date + "T12:00:00Z"),
          })),
        });
        log.debug({ station: key, count: forecasts.length }, "Stored forecast rows (batched)");
      }
    } catch (err) {
      stats.failed++;
      log.error({ err, river: station.riverName, station: station.stationName }, "Error processing station");
    }
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
          levelCm: null,
          dangerLevelCm: station.dangerLevelCm,
          dataSource: null,
          isForecast: false,
          trend: "stable",
          measuredAt: new Date("2000-01-01T00:00:00Z"), // old date so real data always wins DISTINCT ON
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
