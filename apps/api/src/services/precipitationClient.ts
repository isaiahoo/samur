// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Open-Meteo Weather API client for precipitation forecast data.
 *
 * Fetches hourly precipitation for a grid of ~25 points across Dagestan,
 * aggregated into 24h totals for heatmap display.
 */

import { logger } from "../lib/logger.js";
import { fetchJSON } from "../lib/fetch.js";

const log = logger.child({ service: "precipitation" });

const WEATHER_API_BASE = "https://api.open-meteo.com/v1/forecast";

// ── Dagestan precipitation grid (~48 points) ────────────────────────────
// Dense grid covering mountains, foothills, and coastal plain 41.2°N–44.4°N.
// ~0.4° spacing for smooth IDW interpolation on frontend.

export interface GridPoint {
  lat: number;
  lng: number;
}

export const DAGESTAN_PRECIP_GRID: GridPoint[] = [
  // Southern mountains (Samur basin) — row 41.2–41.8
  { lat: 41.2, lng: 47.8 },
  { lat: 41.5, lng: 47.4 },
  { lat: 41.5, lng: 47.9 },
  { lat: 41.5, lng: 48.4 },
  { lat: 41.8, lng: 47.2 },
  { lat: 41.8, lng: 47.7 },
  { lat: 41.8, lng: 48.2 },
  // Central-south mountains — row 42.0–42.4
  { lat: 42.0, lng: 46.4 },
  { lat: 42.0, lng: 46.9 },
  { lat: 42.0, lng: 47.4 },
  { lat: 42.0, lng: 47.9 },
  { lat: 42.3, lng: 46.0 },
  { lat: 42.3, lng: 46.5 },
  { lat: 42.3, lng: 47.0 },
  { lat: 42.3, lng: 47.5 },
  { lat: 42.3, lng: 48.0 },
  // Central Dagestan (Sulak gorge) — row 42.6–42.9
  { lat: 42.6, lng: 46.2 },
  { lat: 42.6, lng: 46.7 },
  { lat: 42.6, lng: 47.2 },
  { lat: 42.6, lng: 47.7 },
  { lat: 42.9, lng: 46.5 },
  { lat: 42.9, lng: 47.0 },
  { lat: 42.9, lng: 47.5 },
  { lat: 42.9, lng: 48.0 },
  // Makhachkala area — row 43.0–43.3
  { lat: 43.1, lng: 46.8 },
  { lat: 43.1, lng: 47.3 },
  { lat: 43.1, lng: 47.8 },
  { lat: 43.3, lng: 46.5 },
  { lat: 43.3, lng: 47.0 },
  { lat: 43.3, lng: 47.5 },
  // Northern foothills — row 43.5–43.8
  { lat: 43.5, lng: 46.2 },
  { lat: 43.5, lng: 46.7 },
  { lat: 43.5, lng: 47.2 },
  { lat: 43.5, lng: 47.7 },
  { lat: 43.8, lng: 46.0 },
  { lat: 43.8, lng: 46.5 },
  { lat: 43.8, lng: 47.0 },
  { lat: 43.8, lng: 47.5 },
  // Northern plain — row 44.0–44.4
  { lat: 44.0, lng: 46.2 },
  { lat: 44.0, lng: 46.7 },
  { lat: 44.0, lng: 47.2 },
  { lat: 44.2, lng: 45.9 },
  { lat: 44.2, lng: 46.4 },
  { lat: 44.2, lng: 46.9 },
  // Far north (Terek delta)
  { lat: 44.4, lng: 46.2 },
  { lat: 44.4, lng: 46.7 },
  { lat: 44.4, lng: 47.2 },
];

// ── Types ────────────────────────────────────────────────────────────────

export interface PrecipitationReading {
  lat: number;
  lng: number;
  /** Total precipitation in mm for the next 24 hours */
  precipitation24h: number;
  /** Maximum single-hour precipitation in mm */
  peakHourlyMm: number;
  /** All 24 hourly values for future temporal display */
  hourlyBreakdown: number[];
}

interface OpenMeteoHourly {
  time: string[];
  precipitation?: (number | null)[];
}

interface OpenMeteoWeatherResponse {
  latitude: number;
  longitude: number;
  hourly: OpenMeteoHourly;
}

// ── In-memory cache ─────────────────────────────────────────────────────

let cachedData: PrecipitationReading[] = [];
let cachedAt = 0;
const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const CACHE_MAX_STALE_MS = CACHE_TTL_MS * 3; // 6 hours — discard after this

export function getCachedPrecipitation(): PrecipitationReading[] {
  if (cachedAt > 0 && Date.now() - cachedAt > CACHE_MAX_STALE_MS) {
    return []; // too stale to be useful
  }
  return cachedData;
}

export function isCacheStale(): boolean {
  return Date.now() - cachedAt > CACHE_TTL_MS;
}

// ── Main fetch ──────────────────────────────────────────────────────────

/**
 * Fetch precipitation forecast for the Dagestan grid.
 * Uses batch API (comma-separated lat/lng) for efficiency.
 * Returns 24h precipitation totals per grid point.
 */
export async function fetchPrecipitationGrid(): Promise<PrecipitationReading[]> {
  const grid = DAGESTAN_PRECIP_GRID;
  const lats = grid.map((p) => p.lat).join(",");
  const lngs = grid.map((p) => p.lng).join(",");

  const url =
    `${WEATHER_API_BASE}?latitude=${lats}&longitude=${lngs}` +
    `&hourly=precipitation&forecast_days=1&timezone=auto`;

  log.info({ points: grid.length }, "Fetching precipitation grid from Open-Meteo");

  const raw = await fetchJSON<OpenMeteoWeatherResponse | OpenMeteoWeatherResponse[]>(url, { service: "precipitation" });

  if (!raw) {
    log.error("Open-Meteo Weather API returned no data");
    return getCachedPrecipitation(); // return stale cache only if within max stale age
  }

  const responses: OpenMeteoWeatherResponse[] = Array.isArray(raw) ? raw : [raw];

  if (responses.length !== grid.length) {
    log.error(
      { expected: grid.length, got: responses.length },
      "Open-Meteo Weather response count mismatch",
    );
    return getCachedPrecipitation();
  }

  const readings: PrecipitationReading[] = [];

  for (let i = 0; i < grid.length; i++) {
    const resp = responses[i];
    const gp = grid[i];

    if (!resp?.hourly?.precipitation) {
      continue;
    }

    // Sum all hourly precipitation values for 24h total + track peak
    let total = 0;
    let peak = 0;
    const hourly: number[] = [];
    for (const val of resp.hourly.precipitation) {
      const v = val ?? 0;
      total += v;
      if (v > peak) peak = v;
      hourly.push(v);
    }

    readings.push({
      lat: gp.lat,
      lng: gp.lng,
      precipitation24h: Math.round(total * 10) / 10,
      peakHourlyMm: Math.round(peak * 10) / 10,
      hourlyBreakdown: hourly,
    });
  }

  // Update cache
  cachedData = readings;
  cachedAt = Date.now();

  const nonZero = readings.filter((r) => r.precipitation24h > 0).length;
  log.info(
    { total: readings.length, withPrecip: nonZero },
    "Precipitation grid updated",
  );

  return readings;
}
