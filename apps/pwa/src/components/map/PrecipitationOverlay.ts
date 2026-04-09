// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Precipitation IDW overlay — 24h rainfall forecast visualization.
 *
 * Design: cyan = light rain, blue = moderate, indigo = heavy.
 * Thresholds:
 *   < 2 mm/24h  = trace (invisible)
 *   2–10        = light (soft cyan)
 *   10–25       = moderate (bright blue)
 *   25–50       = heavy (deep blue)
 *   > 50        = extreme (indigo)
 *
 * Uses same IDW interpolation + Caspian clipping as SoilMoistureOverlay.
 */

import type { PrecipitationPoint } from "./geoJsonHelpers.js";
import { SOIL_BOUNDS, coastlineLng } from "./SoilMoistureOverlay.js";

// ── Thresholds (mm / 24h) ──────────────────────────────────────────────

const TRACE = 2;     // below = invisible
const LIGHT = 10;    // light rain
const MODERATE = 25; // moderate rain
const HEAVY = 50;    // heavy rain (max saturation)

// ── IDW interpolation ───────────────────────────────────────────────────

function idw(lat: number, lng: number, points: PrecipitationPoint[], power = 3): number {
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

const CANVAS_W = 280;
const CANVAS_H = 220;

/**
 * Generate precipitation overlay: cyan → blue → indigo where rain forecast.
 * Uses full-field IDW interpolation from 25 grid points.
 */
export function generatePrecipitationImage(
  points: PrecipitationPoint[],
): string | null {
  const validPoints = points.filter((p) => p.precipitation > 0.5);
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

      const precip = idw(lat, lng, validPoints);

      // Below trace threshold = invisible
      if (precip < TRACE) {
        imageData.data[idx + 3] = 0;
        continue;
      }

      // 4-tier color ramp: cyan → blue → deep blue → indigo
      let r: number, g: number, b: number, a: number;

      if (precip < LIGHT) {
        // Tier 1: Light — soft cyan
        const t = (precip - TRACE) / (LIGHT - TRACE);
        r = 180 - Math.round(t * 40);   // 180 → 140
        g = 225 - Math.round(t * 25);   // 225 → 200
        b = 245 + Math.round(t * 5);    // 245 → 250
        a = 80 + Math.round(t * 50);    // 80 → 130
      } else if (precip < MODERATE) {
        // Tier 2: Moderate — bright blue
        const t = (precip - LIGHT) / (MODERATE - LIGHT);
        r = 140 - Math.round(t * 80);   // 140 → 60
        g = 200 - Math.round(t * 60);   // 200 → 140
        b = 250 - Math.round(t * 10);   // 250 → 240
        a = 130 + Math.round(t * 45);   // 130 → 175
      } else if (precip < HEAVY) {
        // Tier 3: Heavy — deep blue
        const t = (precip - MODERATE) / (HEAVY - MODERATE);
        r = 60 - Math.round(t * 25);    // 60 → 35
        g = 140 - Math.round(t * 80);   // 140 → 60
        b = 240 - Math.round(t * 30);   // 240 → 210
        a = 175 + Math.round(t * 40);   // 175 → 215
      } else {
        // Tier 4: Extreme — indigo
        const t = Math.min((precip - HEAVY) / 30, 1.0);
        r = 35 - Math.round(t * 10);    // 35 → 25
        g = 60 - Math.round(t * 30);    // 60 → 30
        b = 210 - Math.round(t * 30);   // 210 → 180
        a = 215 + Math.round(t * 25);   // 215 → 240
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
  return "linear-gradient(to right, rgba(180,225,245,0.5) 0%, rgba(100,170,245,0.7) 33%, rgba(45,100,230,0.85) 66%, rgba(25,30,180,0.95) 100%)";
}
