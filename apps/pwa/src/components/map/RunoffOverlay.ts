// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Surface runoff IDW overlay — flash flood risk visualization.
 *
 * Design: warm color ramp (green → yellow → orange → red) by risk index.
 * Risk index computed from SCS Curve Number method on the backend:
 *   0–20   = low (transparent)
 *   20–50  = moderate (yellow-green)
 *   50–80  = high (orange)
 *   80–100 = extreme (red)
 *
 * Caspian Sea clipped via shared coastline approximation.
 */

import type { RunoffPoint } from "./geoJsonHelpers.js";
import { SOIL_BOUNDS, coastlineLng, DAGESTAN_SETTLEMENTS } from "./SoilMoistureOverlay.js";

// ── IDW interpolation ───────────────────────────────────────────────────

function idw(
  lat: number, lng: number,
  points: RunoffPoint[],
  power = 3,
): { value: number; minDist: number } {
  let sumWeights = 0;
  let sumValues = 0;
  let minDist = Infinity;

  for (const p of points) {
    const dlat = p.lat - lat;
    const dlng = p.lng - lng;
    const dist = Math.sqrt(dlat * dlat + dlng * dlng);

    if (dist < minDist) minDist = dist;
    if (dist < 0.001) return { value: p.riskIndex, minDist: 0 };

    const w = 1 / (dist ** power);
    sumWeights += w;
    sumValues += w * p.riskIndex;
  }

  return { value: sumWeights > 0 ? sumValues / sumWeights : 0, minDist };
}

// ── Canvas generation ───────────────────────────────────────────────────

const CANVAS_W = 280;
const CANVAS_H = 220;

/** Max distance (degrees) from any data point — beyond this, pixel is transparent */
const MAX_INFLUENCE_DIST = 0.8;

/** Minimum risk index to render (below = transparent) */
const VISIBLE_THRESHOLD = 20;

/**
 * Generate a surface runoff risk overlay using IDW interpolation.
 * Color ramp: yellow-green → yellow → orange → red.
 */
export function generateRunoffOverlayImage(
  points: RunoffPoint[],
): string | null {
  const activePoints = points.filter((p) => p.riskIndex > 0);
  if (activePoints.length === 0) return null;

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

      // Skip pixels over Caspian Sea
      if (lng > coastlineLng(lat)) {
        imageData.data[idx + 3] = 0;
        continue;
      }

      const { value: risk, minDist } = idw(lat, lng, activePoints);

      // Skip pixels too far from any data point
      if (minDist > MAX_INFLUENCE_DIST) {
        imageData.data[idx + 3] = 0;
        continue;
      }

      // Below threshold = transparent
      if (risk < VISIBLE_THRESHOLD) {
        imageData.data[idx + 3] = 0;
        continue;
      }

      // Fade out near the edge of influence radius
      const distFade = minDist > MAX_INFLUENCE_DIST * 0.6
        ? 1 - (minDist - MAX_INFLUENCE_DIST * 0.6) / (MAX_INFLUENCE_DIST * 0.4)
        : 1;

      let r: number, g: number, b: number, a: number;

      if (risk < 50) {
        // Moderate: yellow-green → yellow
        const t = (risk - VISIBLE_THRESHOLD) / (50 - VISIBLE_THRESHOLD);
        r = 160 + Math.round(t * 60);   // 160 → 220
        g = 200 - Math.round(t * 10);   // 200 → 190
        b = 60 - Math.round(t * 20);    // 60 → 40
        a = 90 + Math.round(t * 50);    // 90 → 140
      } else if (risk < 80) {
        // High: yellow → orange
        const t = (risk - 50) / 30;
        r = 220 + Math.round(t * 25);   // 220 → 245
        g = 190 - Math.round(t * 90);   // 190 → 100
        b = 40 + Math.round(t * 10);    // 40 → 50
        a = 140 + Math.round(t * 40);   // 140 → 180
      } else {
        // Extreme: orange → deep red
        const t = Math.min((risk - 80) / 20, 1.0);
        r = 245 - Math.round(t * 45);   // 245 → 200
        g = 100 - Math.round(t * 60);   // 100 → 40
        b = 50 - Math.round(t * 20);    // 50 → 30
        a = 180 + Math.round(t * 40);   // 180 → 220
      }

      imageData.data[idx] = r;
      imageData.data[idx + 1] = g;
      imageData.data[idx + 2] = b;
      imageData.data[idx + 3] = Math.round(a * distFade);
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

// ── Legend ───────────────────────────────────────────────────────────────

export function runoffLegendGradientCSS(): string {
  return "linear-gradient(to right, rgba(160,200,60,0.5) 0%, rgba(220,190,40,0.65) 33%, rgba(245,130,50,0.8) 66%, rgba(200,40,30,0.9) 100%)";
}

export const RUNOFF_LEGEND_TICKS = [
  { pos: "0%", label: "10", desc: "Умеренный" },
  { pos: "50%", label: "25", desc: "Высокий" },
  { pos: "100%", label: "40+", desc: "Критический" },
];

// ── Settlement runoff risk assessment ──────────────────────────────────

export interface SettlementRunoffRisk {
  name: string;
  lat: number;
  lng: number;
  pop: number;
  riskIndex: number;
  runoffDepth: number;
  level: "moderate" | "high" | "extreme";
}

/** Minimum risk index to flag a settlement */
const SETTLEMENT_RISK_THRESHOLD = 40;

/**
 * Find settlements at risk from surface runoff.
 * Uses IDW interpolation of risk index at each settlement location.
 */
export function getSettlementsAtRunoffRisk(points: RunoffPoint[]): SettlementRunoffRisk[] {
  const activePoints = points.filter((p) => p.riskIndex > 10);
  if (activePoints.length === 0) return [];

  const results: SettlementRunoffRisk[] = [];

  for (const s of DAGESTAN_SETTLEMENTS) {
    const { value: riskIndex } = idw(s.lat, s.lng, activePoints);
    if (riskIndex < SETTLEMENT_RISK_THRESHOLD) continue;

    // Also interpolate runoff depth for the label
    let sumW = 0, sumD = 0;
    for (const p of activePoints) {
      const dlat = p.lat - s.lat;
      const dlng = p.lng - s.lng;
      const dist = Math.sqrt(dlat * dlat + dlng * dlng);
      if (dist < 0.001) { sumD = p.runoffDepth; sumW = 1; break; }
      const w = 1 / (dist ** 3);
      sumW += w;
      sumD += w * p.runoffDepth;
    }
    const runoffDepth = sumW > 0 ? Math.round((sumD / sumW) * 10) / 10 : 0;

    let level: SettlementRunoffRisk["level"] = "moderate";
    if (riskIndex >= 80) level = "extreme";
    else if (riskIndex >= 50) level = "high";

    results.push({
      name: s.name,
      lat: s.lat,
      lng: s.lng,
      pop: s.pop,
      riskIndex: Math.round(riskIndex),
      runoffDepth,
      level,
    });
  }

  return results.sort((a, b) => b.riskIndex - a.riskIndex);
}
