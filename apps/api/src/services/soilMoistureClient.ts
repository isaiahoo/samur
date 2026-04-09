// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Open-Meteo Weather API client for soil moisture data.
 *
 * Fetches hourly soil moisture at 4 depth layers for a grid of ~25 points
 * across Dagestan. Returns the average moisture across depths for each point.
 *
 * Saturated soil = rain goes straight to rivers = faster flooding.
 * Values are in m³/m³ (volumetric water content):
 *   0.1 = dry, 0.3 = normal, 0.4 = wet, 0.45+ = saturated
 */

import { logger } from "../lib/logger.js";
import { DAGESTAN_PRECIP_GRID, type GridPoint } from "./precipitationClient.js";

const log = logger.child({ service: "soil-moisture" });

const WEATHER_API_BASE = "https://api.open-meteo.com/v1/forecast";
const FETCH_TIMEOUT = 15_000;
const MAX_RETRIES = 2;

// ── Types ────────────────────────────────────────────────────────────────

export interface SoilMoistureReading {
  lat: number;
  lng: number;
  /** Average volumetric water content across 4 depth layers (m³/m³, 0–0.6) */
  moisture: number;
}

interface OpenMeteoHourly {
  time: string[];
  soil_moisture_0_to_1cm?: (number | null)[];
  soil_moisture_1_to_3cm?: (number | null)[];
  soil_moisture_3_to_9cm?: (number | null)[];
  soil_moisture_9_to_27cm?: (number | null)[];
}

interface OpenMeteoWeatherResponse {
  latitude: number;
  longitude: number;
  hourly: OpenMeteoHourly;
}

// ── Fetch helper ────────────────────────────────────────────────────────

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
        log.warn({ url: url.slice(0, 120), status: res.status, attempt }, "Open-Meteo soil moisture HTTP error");
        continue;
      }

      return (await res.json()) as T;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ attempt, error: msg }, "Soil moisture fetch failed");
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
  }
  return null;
}

// ── In-memory cache ─────────────────────────────────────────────────────

let cachedData: SoilMoistureReading[] = [];
let cachedAt = 0;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

export function getCachedSoilMoisture(): SoilMoistureReading[] {
  return cachedData;
}

export function isSoilMoistureCacheStale(): boolean {
  return Date.now() - cachedAt > CACHE_TTL_MS;
}

// ── Main fetch ──────────────────────────────────────────────────────────

/**
 * Fetch soil moisture for the Dagestan grid (same 25-point grid as precipitation).
 * Uses batch API (comma-separated lat/lng) for efficiency.
 * Returns average moisture across 4 depth layers for the current hour.
 */
export async function fetchSoilMoistureGrid(): Promise<SoilMoistureReading[]> {
  const grid: GridPoint[] = DAGESTAN_PRECIP_GRID;
  const lats = grid.map((p) => p.lat).join(",");
  const lngs = grid.map((p) => p.lng).join(",");

  const url =
    `${WEATHER_API_BASE}?latitude=${lats}&longitude=${lngs}` +
    `&hourly=soil_moisture_0_to_1cm,soil_moisture_1_to_3cm,soil_moisture_3_to_9cm,soil_moisture_9_to_27cm` +
    `&forecast_days=1&timezone=auto`;

  log.info({ points: grid.length }, "Fetching soil moisture grid from Open-Meteo");

  const raw = await fetchJSON<OpenMeteoWeatherResponse | OpenMeteoWeatherResponse[]>(url);

  if (!raw) {
    log.error("Open-Meteo soil moisture API returned no data");
    return cachedData;
  }

  const responses: OpenMeteoWeatherResponse[] = Array.isArray(raw) ? raw : [raw];

  if (responses.length !== grid.length) {
    log.error(
      { expected: grid.length, got: responses.length },
      "Soil moisture response count mismatch",
    );
    return cachedData;
  }

  const nowMs = Date.now();
  const readings: SoilMoistureReading[] = [];

  for (let i = 0; i < grid.length; i++) {
    const resp = responses[i];
    const gp = grid[i];
    const h = resp?.hourly;

    if (!h) continue;

    // Find closest hour by parsing the API's own timestamps
    // (avoids timezone mismatch between server clock and API response)
    let currentHour = 0;
    const times = h.time ?? [];
    let closestDiff = Infinity;
    for (let j = 0; j < times.length; j++) {
      const diff = Math.abs(new Date(times[j]).getTime() - nowMs);
      if (diff < closestDiff) {
        closestDiff = diff;
        currentHour = j;
      }
    }

    // Get the value at the current hour for each depth layer
    const layers = [
      h.soil_moisture_0_to_1cm,
      h.soil_moisture_1_to_3cm,
      h.soil_moisture_3_to_9cm,
      h.soil_moisture_9_to_27cm,
    ];

    let sum = 0;
    let count = 0;
    for (const layer of layers) {
      const val = layer?.[currentHour];
      if (val !== null && val !== undefined && val >= 0) {
        sum += val;
        count++;
      }
    }

    if (count === 0) continue;

    readings.push({
      lat: gp.lat,
      lng: gp.lng,
      moisture: Math.round((sum / count) * 1000) / 1000, // 3 decimal places
    });
  }

  // Update cache
  cachedData = readings;
  cachedAt = Date.now();

  const saturated = readings.filter((r) => r.moisture >= 0.4).length;
  log.info(
    { total: readings.length, saturated },
    "Soil moisture grid updated",
  );

  return readings;
}
