// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Soil moisture IDW overlay — "wet ground" warning zones.
 *
 * Design: blue = wet ground, transparent = dry/normal.
 * Thresholds based on NASA SMAP / NOAA standards:
 *   < 0.35 m³/m³ = normal spring moisture (invisible)
 *   0.35–0.45     = elevated (light blue)
 *   0.45–0.55     = saturated (medium blue)
 *   > 0.55        = critical (deep blue)
 *
 * Caspian Sea clipped via multi-segment coastline approximation.
 */

import type { SoilMoisturePoint } from "./geoJsonHelpers.js";

// ── Geographic bounds for Dagestan coverage ─────────────────────────────

export const SOIL_BOUNDS = {
  north: 44.5,
  south: 41.0,
  east: 48.8,
  west: 45.5,
} as const;

// ── Thresholds (volumetric water content m³/m³) ─────────────────────────
// April spring baseline in Dagestan: 0.28–0.35 (normal snowmelt).
// Aligned with NOAA/NASA SMAP classifications for flood risk.

const WET_THRESHOLD = 0.35; // below = transparent (normal for season)
const HIGH = 0.45;          // soil losing absorption capacity
const SATURATED = 0.55;     // near field capacity — runoff imminent

// ── Caspian coastline polygon (multi-segment approximation) ─────────────
// Interpolated from OpenStreetMap coastline. Returns max lng for land at lat.

const COAST_SEGMENTS: [number, number][] = [
  // [lat, maxLng] — from north to south, based on OSM coastline
  [44.50, 46.40], // Far north — Terek delta marshes end early
  [44.35, 46.55], // Kochubey area
  [44.20, 46.70], // Terek mouth
  [44.00, 46.90], // South of Terek delta
  [43.80, 47.10], // Sulak canyon mouth
  [43.60, 47.35],
  [43.40, 47.48], // Sulak town
  [43.20, 47.50], // North of Makhachkala
  [43.05, 47.52], // Makhachkala
  [42.88, 47.63], // Kaspiysk
  [42.60, 47.78],
  [42.30, 47.95],
  [42.07, 48.10], // Derbent
  [41.80, 48.30],
  [41.50, 48.45],
  [41.00, 48.60], // South border
];

function coastlineLng(lat: number): number {
  // Interpolate between coast segments
  if (lat >= COAST_SEGMENTS[0][0]) return COAST_SEGMENTS[0][1];
  if (lat <= COAST_SEGMENTS[COAST_SEGMENTS.length - 1][0]) return COAST_SEGMENTS[COAST_SEGMENTS.length - 1][1];

  for (let i = 0; i < COAST_SEGMENTS.length - 1; i++) {
    const [lat1, lng1] = COAST_SEGMENTS[i];
    const [lat2, lng2] = COAST_SEGMENTS[i + 1];
    if (lat <= lat1 && lat >= lat2) {
      const t = (lat1 - lat) / (lat1 - lat2);
      return lng1 + t * (lng2 - lng1);
    }
  }
  return 48.0;
}

// ── IDW interpolation ───────────────────────────────────────────────────

function idw(lat: number, lng: number, points: SoilMoisturePoint[], power = 3): number {
  let sumWeights = 0;
  let sumValues = 0;

  for (const p of points) {
    const dlat = p.lat - lat;
    const dlng = p.lng - lng;
    const dist = Math.sqrt(dlat * dlat + dlng * dlng);

    if (dist < 0.001) return p.moisture;

    const w = 1 / (dist ** power);
    sumWeights += w;
    sumValues += w * p.moisture;
  }

  return sumWeights > 0 ? sumValues / sumWeights : 0;
}

// ── Canvas generation ───────────────────────────────────────────────────

const CANVAS_W = 280;
const CANVAS_H = 220;

/**
 * Generate a "wet ground" overlay: blue where moisture > threshold.
 * Uses 3-tier color ramp: elevated → saturated → critical.
 */
export function generateSoilMoistureImage(
  points: SoilMoisturePoint[],
): string | null {
  const validPoints = points.filter((p) => p.moisture > 0.05);
  if (validPoints.length === 0) return null;

  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const imageData = ctx.createImageData(CANVAS_W, CANVAS_H);
  const { north, south, east, west } = SOIL_BOUNDS;

  for (let y = 0; y < CANVAS_H; y++) {
    const lat = north - (y / CANVAS_H) * (north - south);
    for (let x = 0; x < CANVAS_W; x++) {
      const lng = west + (x / CANVAS_W) * (east - west);
      const idx = (y * CANVAS_W + x) * 4;

      // Skip if over Caspian Sea
      if (lng > coastlineLng(lat)) {
        imageData.data[idx + 3] = 0;
        continue;
      }

      const moisture = idw(lat, lng, validPoints);

      // Below threshold = invisible
      if (moisture < WET_THRESHOLD) {
        imageData.data[idx + 3] = 0;
        continue;
      }

      // 3-tier color ramp with smooth interpolation
      let r: number, g: number, b: number, a: number;

      if (moisture < HIGH) {
        // Tier 1: Elevated — soft blue
        const t = (moisture - WET_THRESHOLD) / (HIGH - WET_THRESHOLD);
        r = 110 - Math.round(t * 30);   // 110 → 80
        g = 175 - Math.round(t * 45);   // 175 → 130
        b = 230;                          // constant blue
        a = 100 + Math.round(t * 60);    // 100 → 160
      } else if (moisture < SATURATED) {
        // Tier 2: Saturated — medium blue
        const t = (moisture - HIGH) / (SATURATED - HIGH);
        r = 80 - Math.round(t * 40);    // 80 → 40
        g = 130 - Math.round(t * 50);   // 130 → 80
        b = 230 - Math.round(t * 20);   // 230 → 210
        a = 160 + Math.round(t * 40);   // 160 → 200
      } else {
        // Tier 3: Critical — deep saturated blue
        const t = Math.min((moisture - SATURATED) / 0.15, 1.0);
        r = 40 - Math.round(t * 20);    // 40 → 20
        g = 80 - Math.round(t * 30);    // 80 → 50
        b = 210 - Math.round(t * 10);   // 210 → 200
        a = 200 + Math.round(t * 40);   // 200 → 240
      }

      imageData.data[idx] = r;
      imageData.data[idx + 1] = g;
      imageData.data[idx + 2] = b;
      imageData.data[idx + 3] = a;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

// ── Legend ───────────────────────────────────────────────────────────────

export function legendGradientCSS(): string {
  return "linear-gradient(to right, rgba(110,175,230,0.45) 0%, rgba(80,130,230,0.7) 33%, rgba(40,80,210,0.85) 66%, rgba(20,50,200,0.95) 100%)";
}

export const LEGEND_TICKS = [
  { pos: "0%", label: "35%", desc: "Повышенная" },
  { pos: "50%", label: "45%", desc: "Насыщенная" },
  { pos: "100%", label: "55%+", desc: "Критическая" },
];

// ── Settlement risk assessment ──────────────────────────────────────────

/** Key settlements in Dagestan with populations */
const DAGESTAN_SETTLEMENTS: { name: string; lat: number; lng: number; pop: number }[] = [
  { name: "Махачкала", lat: 42.98, lng: 47.50, pop: 600000 },
  { name: "Хасавюрт", lat: 43.25, lng: 46.59, pop: 142000 },
  { name: "Дербент", lat: 42.07, lng: 48.29, pop: 124000 },
  { name: "Каспийск", lat: 42.88, lng: 47.64, pop: 120000 },
  { name: "Буйнакск", lat: 42.82, lng: 47.12, pop: 65000 },
  { name: "Кизляр", lat: 43.85, lng: 46.71, pop: 50000 },
  { name: "Кизилюрт", lat: 43.02, lng: 46.87, pop: 45000 },
  { name: "Избербаш", lat: 42.57, lng: 47.87, pop: 60000 },
  { name: "Дагестанские Огни", lat: 42.11, lng: 48.19, pop: 30000 },
  { name: "Южно-Сухокумск", lat: 44.01, lng: 45.65, pop: 10000 },
  { name: "Бабаюрт", lat: 43.60, lng: 46.78, pop: 20000 },
  { name: "Сулак", lat: 43.39, lng: 47.11, pop: 5000 },
  { name: "Кочубей", lat: 44.20, lng: 46.50, pop: 8000 },
  { name: "Тарумовка", lat: 44.03, lng: 46.80, pop: 6000 },
  { name: "Новолакское", lat: 43.09, lng: 46.53, pop: 10000 },
];

export interface SettlementRisk {
  name: string;
  lat: number;
  lng: number;
  pop: number;
  moisture: number;
  level: "elevated" | "saturated" | "critical";
}

/** Find settlements where interpolated moisture exceeds the wet threshold */
export function getSettlementsAtRisk(points: SoilMoisturePoint[]): SettlementRisk[] {
  const validPoints = points.filter((p) => p.moisture > 0.05);
  if (validPoints.length === 0) return [];

  const results: SettlementRisk[] = [];

  for (const s of DAGESTAN_SETTLEMENTS) {
    const moisture = idw(s.lat, s.lng, validPoints);
    if (moisture < WET_THRESHOLD) continue;

    let level: SettlementRisk["level"] = "elevated";
    if (moisture >= SATURATED) level = "critical";
    else if (moisture >= HIGH) level = "saturated";

    results.push({ name: s.name, lat: s.lat, lng: s.lng, pop: s.pop, moisture, level });
  }

  return results.sort((a, b) => b.moisture - a.moisture);
}
