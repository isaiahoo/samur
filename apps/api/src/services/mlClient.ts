// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Client for the Самур AI ML prediction service (FastAPI).
 * Fetches water level forecasts and stores them as RiverLevel records.
 */

import { logger } from "../lib/logger.js";
import { fetchJSON } from "../lib/fetch.js";
import { prisma } from "@samur/db";
import type { RiverTrend } from "@samur/db";
import { DAGESTAN_GAUGES, stationKey } from "./gaugeStations.js";

const log = logger.child({ service: "ml-client" });

const ML_SERVICE_URL = process.env.ML_SERVICE_URL ?? "http://ml:8000";

// Basin ID → gauge station mapping
const BASIN_TO_STATION: Record<string, { riverName: string; stationName: string }> = {
  samur_usuhchaj: { riverName: "Самур", stationName: "Усухчай" },
  samur_ahty: { riverName: "Самур", stationName: "Ахты" },
  samur_luchek: { riverName: "Самур", stationName: "Лучек" },
  sulak_miatly: { riverName: "Сулак", stationName: "Миатлы" },
  sulak_yazykovka: { riverName: "Сулак", stationName: "Языковка" },
  sulak_sulak: { riverName: "Сулак", stationName: "Сулак" },
};

interface MlForecastPoint {
  date: string;
  level_cm: number;
  lower_90: number | null;
  upper_90: number | null;
}

interface MlPredictAllResponse {
  generated_at: string;
  data: Array<{
    station_id: string;
    forecasts?: MlForecastPoint[];
    error?: string;
  }>;
}

/**
 * Fetch predictions from the ML service for all stations and store in DB.
 * Called by the daily scrape scheduler.
 */
export async function fetchAndStorePredictions(): Promise<{
  stored: number;
  errors: string[];
}> {
  let stored = 0;
  const errors: string[] = [];

  const result = await fetchJSON<MlPredictAllResponse>(
    `${ML_SERVICE_URL}/predict/all`,
    { service: "ml-client", timeout: 30_000, retries: 1 },
  );

  if (!result?.data) {
    log.warn("ML service returned no data");
    return { stored: 0, errors: ["ML service unavailable"] };
  }

  for (const stationResult of result.data) {
    if (stationResult.error || !stationResult.forecasts) {
      errors.push(`${stationResult.station_id}: ${stationResult.error ?? "no forecasts"}`);
      continue;
    }

    const stationInfo = BASIN_TO_STATION[stationResult.station_id];
    if (!stationInfo) {
      errors.push(`Unknown station: ${stationResult.station_id}`);
      continue;
    }

    // Find the gauge station for coordinates
    const gauge = DAGESTAN_GAUGES.find(
      (g) => g.riverName === stationInfo.riverName && g.stationName === stationInfo.stationName,
    );
    if (!gauge) continue;

    // Determine trend from forecast direction
    const forecasts = stationResult.forecasts;
    const firstLevel = forecasts[0]?.level_cm ?? 0;
    const lastLevel = forecasts[forecasts.length - 1]?.level_cm ?? 0;
    const trend: RiverTrend = lastLevel > firstLevel * 1.02
      ? "rising"
      : lastLevel < firstLevel * 0.98
        ? "falling"
        : "stable";

    for (const fc of forecasts) {
      try {
        const measuredAt = new Date(fc.date + "T00:00:00Z");

        await prisma.riverLevel.upsert({
          where: {
            riverName_stationName_measuredAt: {
              riverName: stationInfo.riverName,
              stationName: stationInfo.stationName,
              measuredAt,
            },
          },
          update: {
            levelCm: fc.level_cm,
            dangerLevelCm: gauge.dangerLevelCm,
            dataSource: "samur-ai",
            isForecast: true,
            trend,
            predictionLower: fc.lower_90,
            predictionUpper: fc.upper_90,
          },
          create: {
            riverName: stationInfo.riverName,
            stationName: stationInfo.stationName,
            lat: gauge.lat,
            lng: gauge.lng,
            levelCm: fc.level_cm,
            dangerLevelCm: gauge.dangerLevelCm,
            dataSource: "samur-ai",
            isForecast: true,
            trend,
            predictionLower: fc.lower_90,
            predictionUpper: fc.upper_90,
            measuredAt,
          },
        });
        stored++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn({ station: stationResult.station_id, date: fc.date, error: msg }, "Failed to store prediction");
        errors.push(`${stationResult.station_id}/${fc.date}: ${msg}`);
      }
    }
  }

  log.info({ stored, errors: errors.length }, "ML predictions stored");
  return { stored, errors };
}

/**
 * Check ML service health.
 */
export async function checkMlHealth(): Promise<{
  status: string;
  loaded_stations: string[];
} | null> {
  return fetchJSON(`${ML_SERVICE_URL}/health`, {
    service: "ml-client",
    timeout: 5_000,
    retries: 0,
  });
}
