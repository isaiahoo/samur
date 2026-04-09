// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Snow / snowmelt IDW overlay — mountain melt risk visualization.
 *
 * Design: warm colors = active melt (flood risk), transparent = no snow/frozen.
 * Based on LISFLOOD/HEC-HMS degree-day method.
 *
 * Melt index tiers (mm water equivalent per day):
 *   0       = no snow or frozen (invisible)
 *   0–5     = low melt (light cyan)
 *   5–15    = moderate (orange)
 *   15–30   = high (red-orange)
 *   30+     = critical / rain-on-snow (deep red)
 */

import type { SnowPoint } from "./geoJsonHelpers.js";

// ── Geographic bounds for mountain coverage ────────────────────────────

export const SNOW_BOUNDS = {
  north: 43.5,
  south: 41.0,
  east: 47.5,
  west: 45.0,
} as const;

// ── Melt index thresholds ──────────────────────────────────────────────

const MELT_LOW = 5;       // mm/day — slow background melt
const MELT_MODERATE = 15; // mm/day — active melt, rivers rising
const MELT_HIGH = 30;     // mm/day — rapid melt or rain-on-snow

// ── Snow depth thresholds (for depth mode) ─────────────────────────────

const DEPTH_TRACE = 0.01;  // 1cm — below = invisible
const DEPTH_LIGHT = 0.10;  // 10cm
const DEPTH_MODERATE = 0.25; // 25cm
const DEPTH_HEAVY = 0.50;  // 50cm

// ── IDW interpolation ───────────────────────────────────────────────────

/** Max distance (degrees) from any data point — beyond this, pixel is transparent */
const MAX_INFLUENCE_DIST = 0.6;

function idw(
  lat: number, lng: number,
  points: SnowPoint[],
  getValue: (p: SnowPoint) => number,
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
    if (dist < 0.001) return { value: getValue(p), minDist: 0 };

    const w = 1 / (dist ** power);
    sumWeights += w;
    sumValues += w * getValue(p);
  }

  return { value: sumWeights > 0 ? sumValues / sumWeights : 0, minDist };
}

// ── Canvas generation ───────────────────────────────────────────────────

const CANVAS_W = 280;
const CANVAS_H = 220;

/**
 * Generate a snowmelt risk overlay (default) or snow depth overlay.
 * Uses IDW interpolation across the mountain grid.
 */
export function generateSnowOverlayImage(
  points: SnowPoint[],
  mode: "melt" | "depth" = "melt",
): string | null {
  const validPoints = mode === "melt"
    ? points.filter((p) => p.snowDepthM > 0.005 || p.meltIndex > 0)
    : points.filter((p) => p.snowDepthM > 0.005);

  if (validPoints.length === 0) return null;

  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const imageData = ctx.createImageData(CANVAS_W, CANVAS_H);
  const { north, south, east, west } = SNOW_BOUNDS;

  const getValue = mode === "melt"
    ? (p: SnowPoint) => p.meltIndex
    : (p: SnowPoint) => p.snowDepthM;

  for (let y = 0; y < CANVAS_H; y++) {
    const lat = north - (y / CANVAS_H) * (north - south);
    for (let x = 0; x < CANVAS_W; x++) {
      const lng = west + (x / CANVAS_W) * (east - west);
      const idx = (y * CANVAS_W + x) * 4;

      const { value: val, minDist } = idw(lat, lng, validPoints, getValue);

      // Skip pixels too far from any data point — avoids painting empty areas
      if (minDist > MAX_INFLUENCE_DIST) {
        imageData.data[idx + 3] = 0;
        continue;
      }

      // Fade out near the edge of influence radius
      const distFade = minDist > MAX_INFLUENCE_DIST * 0.6
        ? 1 - (minDist - MAX_INFLUENCE_DIST * 0.6) / (MAX_INFLUENCE_DIST * 0.4)
        : 1;

      let r: number, g: number, b: number, a: number;

      if (mode === "melt") {
        // Snowmelt risk: warm color ramp
        if (val < 1.0) {
          // No significant melt — transparent
          imageData.data[idx + 3] = 0;
          continue;
        }

        if (val < MELT_LOW) {
          // Low: light cyan
          const t = val / MELT_LOW;
          r = 180 - Math.round(t * 30);
          g = 220 - Math.round(t * 20);
          b = 240;
          a = Math.round(40 + t * 50);  // 40 → 90
        } else if (val < MELT_MODERATE) {
          // Moderate: cyan → orange
          const t = (val - MELT_LOW) / (MELT_MODERATE - MELT_LOW);
          r = 150 + Math.round(t * 103);  // 150 → 253
          g = 200 - Math.round(t * 26);   // 200 → 174
          b = 240 - Math.round(t * 143);  // 240 → 97
          a = 90 + Math.round(t * 50);    // 90 → 140
        } else if (val < MELT_HIGH) {
          // High: orange → red-orange
          const t = (val - MELT_MODERATE) / (MELT_HIGH - MELT_MODERATE);
          r = 253 - Math.round(t * 9);    // 253 → 244
          g = 174 - Math.round(t * 65);   // 174 → 109
          b = 97 - Math.round(t * 30);    // 97 → 67
          a = 140 + Math.round(t * 40);   // 140 → 180
        } else {
          // Critical: deep red
          const t = Math.min((val - MELT_HIGH) / 20, 1.0);
          r = 244 - Math.round(t * 29);   // 244 → 215
          g = 109 - Math.round(t * 61);   // 109 → 48
          b = 67 - Math.round(t * 28);    // 67 → 39
          a = 180 + Math.round(t * 37);   // 180 → 217
        }
      } else {
        // Snow depth: white-to-gray gradient
        if (val < DEPTH_TRACE) {
          imageData.data[idx + 3] = 0;
          continue;
        }

        if (val < DEPTH_LIGHT) {
          // Very light snow
          const t = (val - DEPTH_TRACE) / (DEPTH_LIGHT - DEPTH_TRACE);
          r = 230; g = 240; b = 250;
          a = Math.round(30 + t * 45);  // 30 → 75
        } else if (val < DEPTH_MODERATE) {
          // Light snow
          const t = (val - DEPTH_LIGHT) / (DEPTH_MODERATE - DEPTH_LIGHT);
          r = 230 - Math.round(t * 30);
          g = 240 - Math.round(t * 25);
          b = 250 - Math.round(t * 20);
          a = 75 + Math.round(t * 50);   // 75 → 125
        } else if (val < DEPTH_HEAVY) {
          // Moderate snow
          const t = (val - DEPTH_MODERATE) / (DEPTH_HEAVY - DEPTH_MODERATE);
          r = 200 - Math.round(t * 40);
          g = 215 - Math.round(t * 35);
          b = 230 - Math.round(t * 30);
          a = 125 + Math.round(t * 40);  // 125 → 165
        } else {
          // Heavy snow
          const t = Math.min((val - DEPTH_HEAVY) / 0.5, 1.0);
          r = 160 - Math.round(t * 40);
          g = 180 - Math.round(t * 40);
          b = 200 - Math.round(t * 35);
          a = 165 + Math.round(t * 40);  // 165 → 205
        }
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

export function snowLegendGradientCSS(): string {
  return "linear-gradient(to right, rgba(180,220,240,0.5) 0%, rgba(253,174,97,0.7) 33%, rgba(244,109,67,0.8) 66%, rgba(215,48,39,0.9) 100%)";
}

export const SNOW_LEGEND_TICKS = [
  { pos: "0%", label: "5", desc: "Слабое" },
  { pos: "50%", label: "15", desc: "Умеренное" },
  { pos: "100%", label: "30+", desc: "Критическое" },
];

// ── Mountain station risk assessment ────────────────────────────────────

export interface MountainMeltRisk {
  lat: number;
  lng: number;
  snowDepthM: number;
  temperatureC: number;
  meltIndex: number;
  rain24hMm: number;
  level: "low" | "moderate" | "high" | "critical";
}

/** Identify grid points with active snowmelt for upstream badges */
export function getActiveMeltPoints(points: SnowPoint[]): MountainMeltRisk[] {
  const results: MountainMeltRisk[] = [];

  for (const p of points) {
    if (p.meltIndex < 0.5) continue;

    let level: MountainMeltRisk["level"] = "low";
    if (p.meltIndex >= MELT_HIGH) level = "critical";
    else if (p.meltIndex >= MELT_MODERATE) level = "high";
    else if (p.meltIndex >= MELT_LOW) level = "moderate";

    results.push({
      lat: p.lat,
      lng: p.lng,
      snowDepthM: p.snowDepthM,
      temperatureC: p.temperatureC,
      meltIndex: p.meltIndex,
      rain24hMm: p.rain24hMm,
      level,
    });
  }

  return results.sort((a, b) => b.meltIndex - a.meltIndex);
}
