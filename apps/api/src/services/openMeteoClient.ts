// SPDX-License-Identifier: AGPL-3.0-only

import { logger } from "../lib/logger.js";
import type { GaugeStation } from "./gaugeStations.js";
import { stationKey } from "./gaugeStations.js";

const log = logger.child({ service: "open-meteo" });

const FLOOD_API_BASE = "https://flood-api.open-meteo.com/v1/flood";
const FETCH_TIMEOUT = 15_000;
const MAX_RETRIES = 2;

// ── Types ────────────────────────────────────────────────────────────────

export interface DischargeReading {
  date: string;                    // ISO date (YYYY-MM-DD)
  discharge: number;               // m³/s
  dischargeMean: number | null;    // historical mean for this calendar day
  dischargeMax: number | null;     // historical max for this calendar day
  isForecast: boolean;
}

interface OpenMeteoDaily {
  time: string[];
  river_discharge?: (number | null)[];
  river_discharge_mean?: (number | null)[];
  river_discharge_max?: (number | null)[];
}

interface OpenMeteoSingleResponse {
  latitude: number;
  longitude: number;
  daily: OpenMeteoDaily;
}

// ── Fetch helper ─────────────────────────────────────────────────────────

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
        log.warn({ url, status: res.status, attempt }, "Open-Meteo HTTP error");
        continue;
      }

      return (await res.json()) as T;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ url, attempt, error: msg }, "Open-Meteo fetch failed");
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
  }
  return null;
}

// ── Main entry point ─────────────────────────────────────────────────────

/**
 * Fetch discharge data from Open-Meteo Flood API for all calibrated stations.
 * Uses batch API (comma-separated lat/lng) to minimize HTTP calls.
 *
 * Returns a Map keyed by stationKey ("riverName::stationName") →  DischargeReading[]
 */
export async function fetchDischargeForStations(
  stations: GaugeStation[],
): Promise<Map<string, DischargeReading[]>> {
  const result = new Map<string, DischargeReading[]>();

  // Filter to stations with calibrated Open-Meteo coordinates
  const calibrated = stations.filter(
    (s) => s.openMeteoLat !== null && s.openMeteoLng !== null,
  );

  if (calibrated.length === 0) {
    log.debug("No stations with Open-Meteo coordinates, skipping");
    return result;
  }

  const lats = calibrated.map((s) => s.openMeteoLat!).join(",");
  const lngs = calibrated.map((s) => s.openMeteoLng!).join(",");

  const url =
    `${FLOOD_API_BASE}?latitude=${lats}&longitude=${lngs}` +
    `&daily=river_discharge,river_discharge_mean,river_discharge_max` +
    `&past_days=7&forecast_days=7`;

  log.info({ stationCount: calibrated.length, url }, "Fetching Open-Meteo discharge data");

  // For single station, API returns a single object; for multiple, an array
  const raw = await fetchJSON<OpenMeteoSingleResponse | OpenMeteoSingleResponse[]>(url);

  if (!raw) {
    log.error("Open-Meteo API returned no data");
    return result;
  }

  // Normalize: single-station response is an object, multi-station is an array
  const responses: OpenMeteoSingleResponse[] = Array.isArray(raw) ? raw : [raw];

  if (responses.length !== calibrated.length) {
    log.error(
      { expected: calibrated.length, got: responses.length },
      "Open-Meteo response count mismatch",
    );
    return result;
  }

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  for (let i = 0; i < calibrated.length; i++) {
    const station = calibrated[i];
    const resp = responses[i];
    const key = stationKey(station.riverName, station.stationName);

    if (!resp?.daily?.time || !resp.daily.river_discharge) {
      log.warn({ station: key }, "No daily data in Open-Meteo response");
      continue;
    }

    const { time, river_discharge, river_discharge_mean, river_discharge_max } = resp.daily;

    if (time.length !== river_discharge.length) {
      log.warn({ station: key, timeLen: time.length, dataLen: river_discharge.length },
        "Open-Meteo array length mismatch");
      continue;
    }

    const readings: DischargeReading[] = [];

    for (let j = 0; j < time.length; j++) {
      const discharge = river_discharge[j];
      if (discharge === null || discharge === undefined) continue;

      readings.push({
        date: time[j],
        discharge: Math.round(discharge * 100) / 100,
        dischargeMean: river_discharge_mean?.[j] ?? null,
        dischargeMax: river_discharge_max?.[j] ?? null,
        isForecast: time[j] > today,
      });
    }

    if (readings.length > 0) {
      result.set(key, readings);
      const latest = readings.find((r) => !r.isForecast && r.date <= today);
      log.info(
        {
          station: key,
          readings: readings.length,
          latestDischarge: latest?.discharge ?? null,
          latestDate: latest?.date ?? null,
        },
        "Open-Meteo data parsed",
      );
    } else {
      log.warn({ station: key }, "Open-Meteo returned no valid discharge values");
    }
  }

  return result;
}
