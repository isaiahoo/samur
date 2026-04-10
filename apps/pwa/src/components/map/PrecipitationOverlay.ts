// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Precipitation IDW overlay — 24h rainfall forecast visualization.
 *
 * Design: weather-radar color ramp for maximum readability.
 * Thresholds:
 *   < 1 mm/24h  = trace (invisible)
 *   1–5         = light (green)
 *   5–15        = moderate (yellow → orange)
 *   15–30       = heavy (orange → red)
 *   > 30        = extreme (red → magenta)
 *
 * Uses same IDW interpolation + Caspian clipping as SoilMoistureOverlay.
 */

import type { PrecipitationPoint } from "./geoJsonHelpers.js";
import { SOIL_BOUNDS, coastlineLng } from "./SoilMoistureOverlay.js";

// ── Thresholds (mm / 24h) ──────────────────────────────────────────────

const TRACE = 1;     // below = invisible
const LIGHT = 5;     // light rain
const MODERATE = 15;  // moderate rain
const HEAVY = 30;    // heavy rain
const EXTREME = 60;  // extreme rain (max saturation)

// ── IDW interpolation ───────────────────────────────────────────────────

function idw(lat: number, lng: number, points: PrecipitationPoint[], power = 2.5): number {
  let sumWeights = 0;
  let sumValues = 0;

  for (const p of points) {
    const dlat = p.lat - lat;
    const dlng = p.lng - lng;
    const dist = Math.sqrt(dlat * dlat + dlng * dlng);

    if (dist < 0.001) return p.precipitation;

    const w = 1 / (dist ** power);
    sumWeights += w;
    sumValues += w * p.precipitation;
  }

  return sumWeights > 0 ? sumValues / sumWeights : 0;
}

// ── Canvas generation ───────────────────────────────────────────────────

const CANVAS_W = 400;
const CANVAS_H = 320;

/**
 * Generate precipitation overlay using weather-radar color ramp.
 * green → yellow → orange → red → magenta for clear intensity differentiation.
 */
export function generatePrecipitationImage(
  points: PrecipitationPoint[],
): string | null {
  // Use ALL grid points (including zeros) — zero-rain stations act as anchors
  // that naturally fade the interpolation to transparent in dry areas.
  if (points.length === 0 || points.every((p) => p.precipitation < TRACE)) return null;

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

      const precip = idw(lat, lng, points);

      // Below trace threshold = invisible (naturally faded by zero-rain neighbors)
      if (precip < TRACE) {
        imageData.data[idx + 3] = 0;
        continue;
      }

      // Weather-radar color ramp: green → yellow → orange → red → magenta
      let r: number, g: number, b: number, a: number;

      if (precip < LIGHT) {
        // Tier 1: Light — green
        const t = (precip - TRACE) / (LIGHT - TRACE);
        r = 50 + Math.round(t * 80);    // 50 → 130
        g = 160 + Math.round(t * 60);   // 160 → 220
        b = 50 - Math.round(t * 20);    // 50 → 30
        a = 130 + Math.round(t * 40);   // 130 → 170
      } else if (precip < MODERATE) {
        // Tier 2: Moderate — yellow → orange
        const t = (precip - LIGHT) / (MODERATE - LIGHT);
        r = 200 + Math.round(t * 40);   // 200 → 240
        g = 200 - Math.round(t * 60);   // 200 → 140
        b = 20;                          // 20
        a = 175 + Math.round(t * 30);   // 175 → 205
      } else if (precip < HEAVY) {
        // Tier 3: Heavy — orange → red
        const t = (precip - MODERATE) / (HEAVY - MODERATE);
        r = 230 + Math.round(t * 15);   // 230 → 245
        g = 120 - Math.round(t * 90);   // 120 → 30
        b = 15 + Math.round(t * 15);    // 15 → 30
        a = 205 + Math.round(t * 25);   // 205 → 230
      } else if (precip < EXTREME) {
        // Tier 4: Very heavy — red → magenta
        const t = Math.min((precip - HEAVY) / (EXTREME - HEAVY), 1.0);
        r = 220 - Math.round(t * 30);   // 220 → 190
        g = 20 - Math.round(t * 10);    // 20 → 10
        b = 60 + Math.round(t * 120);   // 60 → 180
        a = 230 + Math.round(t * 15);   // 230 → 245
      } else {
        // Tier 5: Extreme — deep magenta
        r = 170;
        g = 0;
        b = 200;
        a = 245;
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

export function precipLegendGradientCSS(): string {
  return "linear-gradient(to right, rgba(80,180,60,0.8) 0%, rgba(200,200,20,0.85) 25%, rgba(240,150,20,0.9) 50%, rgba(240,40,30,0.9) 75%, rgba(180,10,180,0.95) 100%)";
}
