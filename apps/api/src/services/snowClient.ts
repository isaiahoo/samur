// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Open-Meteo Weather API client for snow depth and snowmelt data.
 *
 * Fetches hourly snow_depth, snowfall, temperature_2m, and rain for a grid
 * of 15 mountain points across Dagestan's Greater Caucasus (1000–3000m+).
 *
 * Computes a snowmelt risk index using the degree-day method:
 *   melt_index = snow_depth × DDF × max(0, T_avg) × rain_amplifier
 *
 * Dagestan spring floods are snowmelt-driven — this layer explains WHY
 * rivers rise before the water actually arrives at downstream gauges.
 */

import { logger } from "../lib/logger.js";
import { fetchJSON } from "../lib/fetch.js";
import type { GridPoint } from "./precipitationClient.js";

const log = logger.child({ service: "snow" });

const WEATHER_API_BASE = "https://api.open-meteo.com/v1/forecast";

// ── Mountain grid (15 points, 1000–3000m+ elevations) ──────────────────

export const MOUNTAIN_SNOW_GRID: GridPoint[] = [
  // Samur basin headwaters (south, high)
  { lat: 41.5, lng: 47.3 },
  { lat: 41.7, lng: 47.0 },
  // Sulak headwaters (central mountains)
  { lat: 42.0, lng: 47.1 },  // Уркарах / Акуша mountain area
  { lat: 42.2, lng: 46.5 },
  { lat: 42.2, lng: 47.0 },
  { lat: 42.5, lng: 46.0 },
  { lat: 42.5, lng: 46.5 },
  // Andi Koysu / Avar Koysu
  { lat: 42.8, lng: 46.0 },
  { lat: 42.8, lng: 46.5 },
  // Terek headwaters (northwest)
  { lat: 43.0, lng: 45.5 },
  { lat: 43.0, lng: 46.0 },
  // High-altitude additions (2500m+ zones)
  { lat: 42.0, lng: 46.0 },  // Bogos range
  { lat: 42.4, lng: 45.8 },  // Western peaks
  { lat: 41.8, lng: 47.5 },  // Bazardyuzu area
  { lat: 42.6, lng: 46.3 },  // Central ridge
  { lat: 43.2, lng: 45.8 },  // NW mountains
];

// ── Degree-day snowmelt parameters ─────────────────────────────────────

/** Degree-day factor: mm of melt per °C per day (calibrated for April aged snowpack) */
const DDF = 3.5;
/** Snow density ratio for April aged snowpack (SWE = depth × density).
 *  Fresh snow ~0.1, aged spring snow 0.3–0.5. Caucasus April average ~0.35. */
const SNOW_DENSITY = 0.35;
/** Rain threshold (mm/day) above which rain-on-snow amplification kicks in */
const RAIN_ON_SNOW_THRESHOLD = 2.0;
/** Rain-on-snow amplification factor (50% more melt) */
const RAIN_AMPLIFIER = 1.5;

// ── Types ────────────────────────────────────────────────────────────────

export interface SnowForecastDay {
  date: string;           // YYYY-MM-DD
  snowDepthM: number;     // meters
  tempMaxC: number;       // °C
  tempMinC: number;       // °C
  snowfallCm: number;     // cm
  rainMm: number;         // mm
  meltIndex: number;      // mm water equiv/day
}

export interface SnowReading {
  lat: number;
  lng: number;
  snowDepthM: number;       // meters (current)
  temperatureC: number;     // °C (current)
  snowfall24hCm: number;    // cm, next 24h
  rain24hMm: number;        // mm, next 24h
  meltIndex: number;        // mm water equiv/day (current)
  forecast: SnowForecastDay[];
}

interface OpenMeteoHourly {
  time: string[];
  snow_depth?: (number | null)[];
  snowfall?: (number | null)[];
  temperature_2m?: (number | null)[];
  rain?: (number | null)[];
}

interface OpenMeteoResponse {
  latitude: number;
  longitude: number;
  hourly: OpenMeteoHourly;
}

// ── Melt index computation ──────────────────────────────────────────────

function computeMeltIndex(snowDepthM: number, tempC: number, rainMm: number): number {
  if (snowDepthM < 0.005 || tempC <= 0) return 0;

  // Convert snow depth to snow water equivalent (SWE) using density ratio
  // SWE_mm = depth_m × 1000 × density (e.g. 0.5m × 1000 × 0.35 = 175mm SWE)
  const sweMm = snowDepthM * 1000 * SNOW_DENSITY;

  // Degree-day melt: DDF × T_positive, capped at available SWE
  const baseMelt = Math.min(sweMm, DDF * tempC);

  // Rain-on-snow amplification
  const amplifier = rainMm > RAIN_ON_SNOW_THRESHOLD ? RAIN_AMPLIFIER : 1.0;

  return Math.round(baseMelt * amplifier * 10) / 10;
}

// ── In-memory cache ─────────────────────────────────────────────────────

let cachedData: SnowReading[] = [];
let cachedAt = 0;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const CACHE_MAX_STALE_MS = CACHE_TTL_MS * 3; // 18 hours — discard after this

export function getCachedSnowData(): SnowReading[] {
  if (cachedAt > 0 && Date.now() - cachedAt > CACHE_MAX_STALE_MS) {
    return [];
  }
  return cachedData;
}

export function isSnowCacheStale(): boolean {
  return Date.now() - cachedAt > CACHE_TTL_MS;
}

// ── Main fetch ──────────────────────────────────────────────────────────

/**
 * Fetch snow data for the Dagestan mountain grid (15 points).
 * Uses batch API (comma-separated lat/lng) for efficiency.
 * Returns current conditions + 7-day daily forecast with melt index.
 */
export async function fetchSnowGrid(): Promise<SnowReading[]> {
  const grid = MOUNTAIN_SNOW_GRID;
  const lats = grid.map((p) => p.lat).join(",");
  const lngs = grid.map((p) => p.lng).join(",");

  const url =
    `${WEATHER_API_BASE}?latitude=${lats}&longitude=${lngs}` +
    `&hourly=snow_depth,snowfall,temperature_2m,rain` +
    `&forecast_days=7&timezone=auto`;

  log.info({ points: grid.length }, "Fetching snow grid from Open-Meteo");

  const raw = await fetchJSON<OpenMeteoResponse | OpenMeteoResponse[]>(url, { service: "snow" });

  if (!raw) {
    log.error("Open-Meteo snow API returned no data");
    return getCachedSnowData(); // return stale cache only if within max stale age
  }

  const responses: OpenMeteoResponse[] = Array.isArray(raw) ? raw : [raw];

  if (responses.length !== grid.length) {
    log.error(
      { expected: grid.length, got: responses.length },
      "Snow response count mismatch",
    );
    return getCachedSnowData();
  }

  const nowMs = Date.now();
  const readings: SnowReading[] = [];

  for (let i = 0; i < grid.length; i++) {
    const resp = responses[i];
    const gp = grid[i];
    const h = resp?.hourly;

    if (!h || !h.time || h.time.length === 0) continue;

    // Find the closest hour index by parsing the API's own timestamps
    // (avoids timezone mismatch between server clock and API response)
    let currentHour = 0;
    let closestDiff = Infinity;
    for (let j = 0; j < h.time.length; j++) {
      const diff = Math.abs(new Date(h.time[j]).getTime() - nowMs);
      if (diff < closestDiff) {
        closestDiff = diff;
        currentHour = j;
      }
    }

    // Current values
    const snowDepthM = h.snow_depth?.[currentHour] ?? 0;
    const temperatureC = h.temperature_2m?.[currentHour] ?? 0;

    // Sum next 24h of snowfall and rain
    let snowfall24h = 0;
    let rain24h = 0;
    for (let j = currentHour; j < Math.min(currentHour + 24, h.time.length); j++) {
      snowfall24h += h.snowfall?.[j] ?? 0;
      rain24h += h.rain?.[j] ?? 0;
    }

    // Current melt index
    const meltIndex = computeMeltIndex(snowDepthM, temperatureC, rain24h);

    // Build 7-day daily forecast
    const forecast: SnowForecastDay[] = [];
    const hoursPerDay = 24;
    const totalHours = h.time.length;

    for (let day = 0; day < 7 && day * hoursPerDay < totalHours; day++) {
      const dayStart = day * hoursPerDay;
      const dayEnd = Math.min(dayStart + hoursPerDay, totalHours);

      let daySnowfall = 0;
      let dayRain = 0;
      let dayTempMax = -999;
      let dayTempMin = 999;
      let daySnowDepth = 0;

      for (let j = dayStart; j < dayEnd; j++) {
        daySnowfall += h.snowfall?.[j] ?? 0;
        dayRain += h.rain?.[j] ?? 0;
        const t = h.temperature_2m?.[j] ?? 0;
        if (t > dayTempMax) dayTempMax = t;
        if (t < dayTempMin) dayTempMin = t;
      }

      // Use midday snow depth as representative (hour 12 of the day)
      const middayIdx = Math.min(dayStart + 12, dayEnd - 1);
      daySnowDepth = h.snow_depth?.[middayIdx] ?? 0;

      const dayAvgTemp = (dayTempMax + dayTempMin) / 2;
      const dayMelt = computeMeltIndex(daySnowDepth, dayAvgTemp, dayRain);

      // Extract date from ISO string
      const dateStr = h.time[dayStart]?.slice(0, 10) ?? "";

      forecast.push({
        date: dateStr,
        snowDepthM: Math.round(daySnowDepth * 1000) / 1000,
        tempMaxC: Math.round(dayTempMax * 10) / 10,
        tempMinC: Math.round(dayTempMin * 10) / 10,
        snowfallCm: Math.round(daySnowfall * 10) / 10,
        rainMm: Math.round(dayRain * 10) / 10,
        meltIndex: dayMelt,
      });
    }

    readings.push({
      lat: gp.lat,
      lng: gp.lng,
      snowDepthM: Math.round(snowDepthM * 1000) / 1000,
      temperatureC: Math.round(temperatureC * 10) / 10,
      snowfall24hCm: Math.round(snowfall24h * 10) / 10,
      rain24hMm: Math.round(rain24h * 10) / 10,
      meltIndex,
      forecast,
    });
  }

  // Update cache
  cachedData = readings;
  cachedAt = Date.now();

  const withSnow = readings.filter((r) => r.snowDepthM > 0.01).length;
  const melting = readings.filter((r) => r.meltIndex > 0).length;
  log.info(
    { total: readings.length, withSnow, melting },
    "Snow grid updated",
  );

  return readings;
}
