// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Open-Meteo Weather API client for precipitation forecast data.
 *
 * Fetches hourly precipitation for a grid of ~25 points across Dagestan,
 * aggregated into 24h totals for heatmap display.
 */

import { logger } from "../lib/logger.js";

const log = logger.child({ service: "precipitation" });

const WEATHER_API_BASE = "https://api.open-meteo.com/v1/forecast";
const FETCH_TIMEOUT = 15_000;
const MAX_RETRIES = 2;

// ── Dagestan precipitation grid (~25 points) ─────────────────────────────
// Covers mountains, foothills, and coastal plain from ~41.3°N to 44.3°N

export interface GridPoint {
  lat: number;
  lng: number;
}

export const DAGESTAN_PRECIP_GRID: GridPoint[] = [
  // Southern mountains (Samur basin)
  { lat: 41.4, lng: 47.9 },
  { lat: 41.7, lng: 47.5 },
  { lat: 41.7, lng: 48.2 },
  // Central-south mountains (Sulak headwaters)
  { lat: 42.2, lng: 46.5 },
  { lat: 42.2, lng: 47.2 },
  { lat: 42.5, lng: 46.0 },
  { lat: 42.5, lng: 46.8 },
  { lat: 42.5, lng: 47.5 },
  // Central Dagestan (Sulak gorge area)
  { lat: 42.8, lng: 46.5 },
  { lat: 42.8, lng: 47.0 },
  { lat: 42.8, lng: 47.6 },
  // Makhachkala area / coastal
  { lat: 43.0, lng: 47.2 },
  { lat: 43.0, lng: 47.8 },
  { lat: 43.2, lng: 47.0 },
  { lat: 43.2, lng: 47.5 },
  // Northern foothills (Terek basin)
  { lat: 43.5, lng: 46.3 },
  { lat: 43.5, lng: 47.0 },
  { lat: 43.5, lng: 47.5 },
  // Northern plain
  { lat: 43.8, lng: 46.5 },
  { lat: 43.8, lng: 47.0 },
  { lat: 43.8, lng: 47.6 },
  // Far north (Terek delta)
  { lat: 44.0, lng: 46.3 },
  { lat: 44.0, lng: 47.0 },
  { lat: 44.3, lng: 46.5 },
  { lat: 44.3, lng: 47.2 },
];

// ── Types ────────────────────────────────────────────────────────────────

export interface PrecipitationReading {
  lat: number;
  lng: number;
  /** Total precipitation in mm for the next 24 hours */
  precipitation24h: number;
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

// ── Fetch helper (reuse pattern from openMeteoClient) ────────────────────

async function fetchJSON<T>(url: string, retries = MAX_RETRIES): Promise<T | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          "Accept": "application/json",
          "User-Agent": "Samur-FloodMonitor/1.0 (flood relief platform)",
        },
      });
      clearTimeout(timeout);

      if (!res.ok) {
        log.warn({ url: url.slice(0, 120), status: res.status, attempt }, "Open-Meteo Weather HTTP error");
        continue;
      }

      return (await res.json()) as T;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ attempt, error: msg }, "Open-Meteo Weather fetch failed");
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
  }
  return null;
}

// ── In-memory cache ─────────────────────────────────────────────────────

let cachedData: PrecipitationReading[] = [];
let cachedAt = 0;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

export function getCachedPrecipitation(): PrecipitationReading[] {
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

  const raw = await fetchJSON<OpenMeteoWeatherResponse | OpenMeteoWeatherResponse[]>(url);

  if (!raw) {
    log.error("Open-Meteo Weather API returned no data");
    return cachedData; // return stale cache rather than empty
  }

  const responses: OpenMeteoWeatherResponse[] = Array.isArray(raw) ? raw : [raw];

  if (responses.length !== grid.length) {
    log.error(
      { expected: grid.length, got: responses.length },
      "Open-Meteo Weather response count mismatch",
    );
    return cachedData;
  }

  const readings: PrecipitationReading[] = [];

  for (let i = 0; i < grid.length; i++) {
    const resp = responses[i];
    const gp = grid[i];

    if (!resp?.hourly?.precipitation) {
      continue;
    }

    // Sum all hourly precipitation values for 24h total
    let total = 0;
    for (const val of resp.hourly.precipitation) {
      total += val ?? 0;
    }

    readings.push({
      lat: gp.lat,
      lng: gp.lng,
      precipitation24h: Math.round(total * 10) / 10,
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
