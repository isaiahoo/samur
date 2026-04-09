// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Flood risk overlay — shows where water pools and flows into rivers.
 *
 * Renamed from "surface runoff" to "flood risk" for clarity.
 * Color ramp: yellow → orange → red → dark red.
 * Designed so any person immediately understands: colored area = danger.
 *
 * Risk index (0–100) from SCS Curve Number method:
 *   0–8    = safe (transparent)
 *   8–35   = watch (yellow-amber)
 *   35–65  = danger (orange)
 *   65–100 = evacuate (deep red)
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

/** Max distance (degrees) from any data point */
const MAX_INFLUENCE_DIST = 0.8;

/** Minimum risk to color a pixel — high enough to avoid painting noise */
const VISIBLE_THRESHOLD = 15;

/**
 * Generate a flood risk overlay using IDW interpolation.
 * Clear, bold colors: yellow → orange → red.
 */
export function generateRunoffOverlayImage(
  points: RunoffPoint[],
): string | null {
  // Check if there's any risk at all
  const hasRisk = points.some((p) => p.riskIndex > 0);
  if (!hasRisk || points.length === 0) return null;

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

      // Use ALL points (including zeros) so zeros dilute risk correctly
      const { value: risk, minDist } = idw(lat, lng, points);

      if (minDist > MAX_INFLUENCE_DIST) {
        imageData.data[idx + 3] = 0;
        continue;
      }

      if (risk < VISIBLE_THRESHOLD) {
        imageData.data[idx + 3] = 0;
        continue;
      }

      // Fade at edges of influence radius
      const distFade = minDist > MAX_INFLUENCE_DIST * 0.6
        ? 1 - (minDist - MAX_INFLUENCE_DIST * 0.6) / (MAX_INFLUENCE_DIST * 0.4)
        : 1;

      let r: number, g: number, b: number, a: number;

      if (risk < 35) {
        // Watch: amber-yellow — "be alert"
        const t = (risk - VISIBLE_THRESHOLD) / (35 - VISIBLE_THRESHOLD);
        r = 240;
        g = 200 - Math.round(t * 40);   // 200 → 160
        b = 20;
        a = 120 + Math.round(t * 50);   // 120 → 170
      } else if (risk < 65) {
        // Danger: orange — "stay away from rivers"
        const t = (risk - 35) / 30;
        r = 240 - Math.round(t * 10);   // 240 → 230
        g = 160 - Math.round(t * 80);   // 160 → 80
        b = 20 + Math.round(t * 10);    // 20 → 30
        a = 170 + Math.round(t * 30);   // 170 → 200
      } else {
        // Evacuate: deep red — "leave the area"
        const t = Math.min((risk - 65) / 35, 1.0);
        r = 230 - Math.round(t * 30);   // 230 → 200
        g = 80 - Math.round(t * 50);    // 80 → 30
        b = 30 - Math.round(t * 10);    // 30 → 20
        a = 200 + Math.round(t * 30);   // 200 → 230
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
  return "linear-gradient(to right, rgba(240,200,20,0.7) 0%, rgba(235,120,25,0.85) 50%, rgba(200,30,20,0.95) 100%)";
}

export const RUNOFF_LEGEND_TICKS = [
  { pos: "0%", label: "Внимание" },
  { pos: "50%", label: "Опасно" },
  { pos: "100%", label: "Эвакуация" },
];

// ── Settlement flood risk assessment ──────────────────────────────────

export interface SettlementRunoffRisk {
  name: string;
  lat: number;
  lng: number;
  pop: number;
  riskIndex: number;
  runoffDepth: number;
  level: "moderate" | "high" | "extreme";
}

/** Only flag settlements with genuinely nearby, significant runoff */
const SETTLEMENT_RISK_THRESHOLD = 35;
/** Max distance (degrees, ~0.4° ≈ 40km) — beyond this, no marker */
const MAX_SETTLEMENT_DIST = 0.4;

/**
 * Find settlements at risk from surface runoff.
 * Only flags a settlement if there's a high-risk grid point within ~40km.
 * Prevents false positives from distant IDW interpolation.
 */
export function getSettlementsAtRunoffRisk(points: RunoffPoint[]): SettlementRunoffRisk[] {
  const activePoints = points.filter((p) => p.riskIndex >= 25);
  if (activePoints.length === 0) return [];

  const results: SettlementRunoffRisk[] = [];

  for (const s of DAGESTAN_SETTLEMENTS) {
    // Find the nearest active runoff point
    let nearestDist = Infinity;
    let nearestRunoff = 0;
    let nearestRisk = 0;
    for (const p of activePoints) {
      const dlat = p.lat - s.lat;
      const dlng = p.lng - s.lng;
      const dist = Math.sqrt(dlat * dlat + dlng * dlng);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestRunoff = p.runoffDepth;
        nearestRisk = p.riskIndex;
      }
    }

    // Skip if no significant runoff point is close enough
    if (nearestDist > MAX_SETTLEMENT_DIST) continue;
    if (nearestRisk < SETTLEMENT_RISK_THRESHOLD) continue;

    // Use distance-weighted average from nearby points only
    let sumW = 0, sumR = 0, sumD = 0;
    for (const p of activePoints) {
      const dlat = p.lat - s.lat;
      const dlng = p.lng - s.lng;
      const dist = Math.sqrt(dlat * dlat + dlng * dlng);
      if (dist > MAX_SETTLEMENT_DIST) continue;
      if (dist < 0.001) { sumR = p.riskIndex; sumD = p.runoffDepth; sumW = 1; break; }
      const w = 1 / (dist ** 3);
      sumW += w;
      sumR += w * p.riskIndex;
      sumD += w * p.runoffDepth;
    }

    const riskIndex = sumW > 0 ? Math.round(sumR / sumW) : 0;
    const runoffDepth = sumW > 0 ? Math.round((sumD / sumW) * 10) / 10 : 0;
    if (riskIndex < SETTLEMENT_RISK_THRESHOLD) continue;

    let level: SettlementRunoffRisk["level"] = "moderate";
    if (riskIndex >= 65) level = "extreme";
    else if (riskIndex >= 35) level = "high";

    results.push({
      name: s.name,
      lat: s.lat,
      lng: s.lng,
      pop: s.pop,
      riskIndex,
      runoffDepth,
      level,
    });
  }

  return results.sort((a, b) => b.riskIndex - a.riskIndex);
}
