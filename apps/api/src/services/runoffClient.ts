// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Surface runoff estimation using the USDA SCS Curve Number method.
 *
 * This is a DERIVED data service — no external API calls. Reads from
 * cached precipitation and soil moisture data, computes SCS-CN runoff
 * for each of the 25 Dagestan grid points.
 *
 * The SCS-CN method is the industry standard for estimating surface
 * runoff from rainfall (NOAA FFG, USACE HEC-HMS, European EFAS).
 *
 * Key innovation: we use real-time soil moisture to determine Antecedent
 * Moisture Condition (AMC), which is more accurate than the traditional
 * 5-day rainfall proxy.
 *
 * Risk thresholds (from NOAA Flash Flood Guidance):
 *   0–10 mm  = low (transparent)
 *   10–25 mm = moderate (watch for ponding)
 *   25–40 mm = high (flash flood risk)
 *   40+ mm   = extreme (major flooding expected)
 */

import { logger } from "../lib/logger.js";
import { getCachedPrecipitation } from "./precipitationClient.js";
import { getCachedSoilMoisture } from "./soilMoistureClient.js";

const log = logger.child({ service: "runoff" });

// ── Types ────────────────────────────────────────────────────────────────

export interface RunoffReading {
  lat: number;
  lng: number;
  precipitation24h: number;  // input: mm
  soilMoisture: number;      // input: m³/m³
  runoffDepth: number;       // computed: mm
  riskIndex: number;         // computed: 0–100
  riskLevel: "low" | "moderate" | "high" | "extreme";
  curveNumber: number;       // adjusted CN used
}

// ── Terrain classification ──────────────────────────────────────────────
// Hydrologic Soil Group C (clay loam, predominant in Dagestan).
// CN values from USDA TR-55 / NRCS NEH Chapter 9.

interface TerrainRule {
  match: (lat: number, lng: number) => boolean;
  cn: number;
  label: string;
}

// Order matters — first match wins. More specific rules first.
const TERRAIN_RULES: TerrainRule[] = [
  // Urban areas (Makhachkala, Kaspiysk, Derbent)
  {
    match: (lat, lng) =>
      (Math.abs(lat - 42.98) < 0.15 && Math.abs(lng - 47.50) < 0.15) || // Makhachkala
      (Math.abs(lat - 42.88) < 0.10 && Math.abs(lng - 47.64) < 0.10) || // Kaspiysk
      (Math.abs(lat - 42.07) < 0.10 && Math.abs(lng - 48.29) < 0.10),   // Derbent
    cn: 92,
    label: "urban",
  },
  // Mountain bare/rocky — high elevation, western mountains
  {
    match: (lat, lng) => lat <= 42.5 && lng <= 46.5,
    cn: 85,
    label: "mountain_bare",
  },
  // Mountain forest — mid-elevation, central mountains
  {
    match: (lat, lng) => lat <= 42.8 && lng <= 47.0,
    cn: 73,
    label: "mountain_forest",
  },
  // Northern plain — flat steppe/grassland
  {
    match: (lat) => lat > 43.5,
    cn: 80,
    label: "northern_plain",
  },
  // Valley agricultural — lower elevations, east of mountains
  {
    match: (lat, lng) => lat > 43.0 && lng > 46.5,
    cn: 82,
    label: "valley_agricultural",
  },
  // Foothill — default for central Dagestan
  {
    match: () => true,
    cn: 79,
    label: "foothill",
  },
];

function getBaseCN(lat: number, lng: number): number {
  for (const rule of TERRAIN_RULES) {
    if (rule.match(lat, lng)) return rule.cn;
  }
  return 79; // fallback
}

// ── AMC adjustment ─────────────────────────────────────────────────────
// Ponce & Hawkins (1996) formulas for AMC class conversion.
// We use real-time soil moisture instead of the traditional 5-day rainfall.

function getAMC(soilMoisture: number): 1 | 2 | 3 {
  if (soilMoisture < 0.20) return 1;  // dry
  if (soilMoisture <= 0.35) return 2; // normal
  return 3;                            // wet/saturated
}

function adjustCN(cn2: number, amc: 1 | 2 | 3): number {
  if (amc === 1) {
    // Dry condition — less runoff
    return cn2 / (2.281 - 0.01281 * cn2);
  }
  if (amc === 3) {
    // Wet/saturated — more runoff
    return cn2 / (0.427 + 0.00573 * cn2);
  }
  return cn2; // AMC II — no adjustment
}

// ── SCS-CN runoff computation ──────────────────────────────────────────

function computeRunoffDepth(rainfall_mm: number, cn: number): number {
  if (cn <= 0 || cn > 100 || rainfall_mm <= 0) return 0;

  const S = 25400 / cn - 254;       // potential max retention (mm)
  const Ia = 0.2 * S;               // initial abstraction (mm)

  if (rainfall_mm <= Ia) return 0;

  return Math.pow(rainfall_mm - Ia, 2) / (rainfall_mm - Ia + S);
}

function computeRiskLevel(riskIndex: number): RunoffReading["riskLevel"] {
  if (riskIndex >= 80) return "extreme";
  if (riskIndex >= 50) return "high";
  if (riskIndex >= 20) return "moderate";
  return "low";
}

// ── In-memory cache ────────────────────────────────────────────────────

let cachedData: RunoffReading[] = [];

export function getCachedRunoff(): RunoffReading[] {
  return cachedData;
}

// ── Main computation ───────────────────────────────────────────────────

/**
 * Compute SCS-CN surface runoff for each grid point using cached
 * precipitation and soil moisture data. No external API calls.
 */
export function computeRunoffGrid(): RunoffReading[] {
  const precip = getCachedPrecipitation();
  const moisture = getCachedSoilMoisture();

  if (precip.length === 0) {
    log.warn("No precipitation data available for runoff computation");
    return cachedData;
  }

  if (moisture.length === 0) {
    log.warn("No soil moisture data available for runoff computation");
    return cachedData;
  }

  // Build moisture lookup by approximate lat/lng (grid points match)
  const moistureMap = new Map<string, number>();
  for (const m of moisture) {
    const key = `${m.lat.toFixed(1)},${m.lng.toFixed(1)}`;
    moistureMap.set(key, m.moisture);
  }

  const readings: RunoffReading[] = [];

  for (const p of precip) {
    const key = `${p.lat.toFixed(1)},${p.lng.toFixed(1)}`;
    const soilMoisture = moistureMap.get(key) ?? 0.25; // default to normal

    const baseCN = getBaseCN(p.lat, p.lng);
    const amc = getAMC(soilMoisture);
    const adjustedCN = Math.min(98, Math.round(adjustCN(baseCN, amc) * 10) / 10);

    const runoffDepth = Math.round(computeRunoffDepth(p.precipitation24h, adjustedCN) * 10) / 10;

    // Normalize to 0–100 risk index (40mm = 100)
    const riskIndex = Math.min(100, Math.round((runoffDepth / 40) * 100));

    readings.push({
      lat: p.lat,
      lng: p.lng,
      precipitation24h: p.precipitation24h,
      soilMoisture,
      runoffDepth,
      riskIndex,
      riskLevel: computeRiskLevel(riskIndex),
      curveNumber: adjustedCN,
    });
  }

  cachedData = readings;

  const withRunoff = readings.filter((r) => r.runoffDepth > 0).length;
  const highRisk = readings.filter((r) => r.riskIndex >= 50).length;
  log.info(
    { total: readings.length, withRunoff, highRisk },
    "Runoff grid computed",
  );

  return readings;
}
