// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Rating-curve lookup: convert Open-Meteo GloFAS discharge (m³/s) into a
 * gauge water level (cm) for stations where a well-fit seasonal+rolling
 * model was derived offline in build_rating_curves.py.
 *
 * The curve file lives at apps/ml/models/rating_curves.json. Only stations
 * with held-out-year R² ≥ 0.4 are present — for other stations this module
 * returns null and the scraper leaves level_cm NULL, so the ML service's
 * climatology fallback continues to cover them as today.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { logger } from "../lib/logger.js";

const log = logger.child({ service: "rating-curve" });

interface Curve {
  model: string;
  coefs: number[];
  feature_names: string[];
  r2: number;
  n_pairs: number;
  rmse_cm: number;
  discharge_range: [number, number];
}

interface RatingCurvesFile {
  generated_at: string;
  min_r2: number;
  curves: Record<string, Curve>;
}

// ── Station-id resolution ────────────────────────────────────────────────
// The JSON keys are ML station_ids (samur_ahty, samur_luchek, …). We need
// to match by river+station name when the scraper is merging rows. This
// mirrors BASIN_TO_STATION in mlClient.ts.
const STATION_KEYS: Record<string, string> = {
  "Самур::Усухчай": "samur_usuhchaj",
  "Самур::Ахты":    "samur_ahty",
  "Самур::Лучек":   "samur_luchek",
  "Сулак::Миатлы":  "sulak_miatly",
  "Сулак::Языковка":"sulak_yazykovka",
  "Сулак::Сулак":   "sulak_sulak",
};

// ── Load + cache curves at import time ───────────────────────────────────
let curves: Record<string, Curve> = {};

(() => {
  // Known paths. Container layout: /app/ml/models/rating_curves.json (placed
  // there by the api Dockerfile). Local dev: project-root/apps/ml/models/…
  const candidates = [
    "/app/ml/models/rating_curves.json",
    join(process.cwd(), "apps", "ml", "models", "rating_curves.json"),
    join(process.cwd(), "..", "ml", "models", "rating_curves.json"),
    join(process.cwd(), "ml", "models", "rating_curves.json"),
  ];
  for (const path of candidates) {
    try {
      const raw = readFileSync(path, "utf-8");
      const parsed = JSON.parse(raw) as RatingCurvesFile;
      curves = parsed.curves ?? {};
      log.info({ path, stations: Object.keys(curves), generated_at: parsed.generated_at }, "Loaded rating curves");
      return;
    } catch {
      /* try next */
    }
  }
  log.warn("rating_curves.json not found — level_cm will stay null for all stations");
})();

// ── Feature construction mirrors _seasonal_features() in the Python script ──
function buildFeatures(discharge: number, dischargeRolling3: number, dischargeRolling7: number, date: Date): number[] {
  const doy = dayOfYearUTC(date);
  const theta = (2 * Math.PI * doy) / 365.25;
  const s = Math.sin(theta), c = Math.cos(theta);
  const s2 = Math.sin(2 * theta), c2 = Math.cos(2 * theta);
  const logQ = Math.log(discharge);
  const logQ3 = Math.log(dischargeRolling3);
  // Order must match feature_names in the JSON
  return [
    1,
    discharge,
    logQ,
    dischargeRolling3,
    dischargeRolling7,
    logQ3,
    s, c,
    discharge * s,
    discharge * c,
    s2, c2,
  ];
}

function dayOfYearUTC(d: Date): number {
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  return Math.floor((d.getTime() - start) / 86_400_000);
}

export interface LevelEstimate {
  levelCm: number;
  rmse: number;
  r2: number;
  model: string;
}

/**
 * Estimate water level (cm) from discharge + recent-discharge context.
 *
 * @param riverName   Russian river name (e.g. "Самур")
 * @param stationName Russian station name (e.g. "Ахты")
 * @param discharge   today's m³/s
 * @param rolling3    3-day rolling mean m³/s (pass `discharge` if unavailable)
 * @param rolling7    7-day rolling mean m³/s (pass `discharge` if unavailable)
 * @param date        measurement date (UTC)
 * @returns level estimate + diagnostics, or null if no curve for this station
 */
export function estimateLevelCm(
  riverName: string,
  stationName: string,
  discharge: number | null,
  rolling3: number | null,
  rolling7: number | null,
  date: Date,
): LevelEstimate | null {
  if (discharge == null || discharge <= 0) return null;
  const key = `${riverName}::${stationName}`;
  const stationId = STATION_KEYS[key];
  if (!stationId) return null;
  const curve = curves[stationId];
  if (!curve) return null;

  const q3 = (rolling3 ?? discharge) > 0 ? (rolling3 ?? discharge) : discharge;
  const q7 = (rolling7 ?? discharge) > 0 ? (rolling7 ?? discharge) : discharge;
  const feats = buildFeatures(discharge, q3, q7, date);
  if (feats.length !== curve.coefs.length) return null;

  let level = 0;
  for (let i = 0; i < feats.length; i++) level += feats[i] * curve.coefs[i];

  // Sanity: clamp to physically plausible range and reject obvious failures
  if (!Number.isFinite(level)) return null;
  const clamped = Math.max(0, Math.min(level, 3000));
  // If the model extrapolates to zero or the clamp hit, don't serve a value
  if (clamped === 0 || clamped === 3000) return null;

  return {
    levelCm: Math.round(clamped * 10) / 10,
    rmse: curve.rmse_cm,
    r2: curve.r2,
    model: curve.model,
  };
}

export function hasCurveFor(riverName: string, stationName: string): boolean {
  const key = `${riverName}::${stationName}`;
  const stationId = STATION_KEYS[key];
  return !!stationId && !!curves[stationId];
}
