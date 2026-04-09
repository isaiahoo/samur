// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Soil moisture IDW (Inverse Distance Weighting) overlay.
 *
 * Takes 25 sparse grid points and generates a smooth, continuous
 * color surface via spatial interpolation — the same technique
 * used by NASA SMAP, Windy, and Copernicus for environmental data.
 *
 * Color scheme: Amber (dry) → Green (normal) → Blue (wet) → Indigo (saturated)
 * Vivid, high-contrast palette designed for map overlays (no washed-out midpoints).
 */

import type { SoilMoisturePoint } from "./geoJsonHelpers.js";

// ── Geographic bounds for Dagestan coverage ─────────────────────────────

export const SOIL_BOUNDS = {
  north: 44.5,
  south: 41.0,
  east: 48.8,
  west: 45.5,
} as const;

// ── Vivid color ramp for map overlay ────────────────────────────────────
// No white/gray midpoints — every stop is a saturated, visible color.
// Amber → Yellow-Green → Green → Teal → Blue → Indigo

interface RGB { r: number; g: number; b: number }

const COLOR_STOPS: Array<{ val: number; color: RGB }> = [
  { val: 0.08, color: { r: 180, g: 83, b: 9 } },    // #B45309 — very dry (burnt amber)
  { val: 0.14, color: { r: 217, g: 119, b: 6 } },    // #D97706 — dry (amber)
  { val: 0.20, color: { r: 234, g: 179, b: 8 } },    // #EAB308 — warm (yellow)
  { val: 0.26, color: { r: 132, g: 204, b: 22 } },   // #84CC16 — normal-dry (lime)
  { val: 0.32, color: { r: 34, g: 197, b: 94 } },    // #22C55E — normal (green)
  { val: 0.38, color: { r: 20, g: 184, b: 166 } },   // #14B8A6 — moist (teal)
  { val: 0.44, color: { r: 59, g: 130, b: 246 } },   // #3B82F6 — wet (blue)
  { val: 0.50, color: { r: 79, g: 70, b: 229 } },    // #4F46E5 — saturated (indigo)
];

function moistureToRGB(moisture: number): RGB {
  // Clamp
  const m = Math.max(COLOR_STOPS[0].val, Math.min(moisture, COLOR_STOPS[COLOR_STOPS.length - 1].val));

  // Find surrounding stops
  for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
    const lo = COLOR_STOPS[i];
    const hi = COLOR_STOPS[i + 1];
    if (m >= lo.val && m <= hi.val) {
      const t = (m - lo.val) / (hi.val - lo.val);
      return {
        r: Math.round(lo.color.r + t * (hi.color.r - lo.color.r)),
        g: Math.round(lo.color.g + t * (hi.color.g - lo.color.g)),
        b: Math.round(lo.color.b + t * (hi.color.b - lo.color.b)),
      };
    }
  }

  return COLOR_STOPS[COLOR_STOPS.length - 1].color;
}

// ── IDW interpolation ───────────────────────────────────────────────────

function idw(lat: number, lng: number, points: SoilMoisturePoint[], power = 2.5): number {
  let sumWeights = 0;
  let sumValues = 0;

  for (const p of points) {
    const dlat = p.lat - lat;
    const dlng = p.lng - lng;
    const dist = Math.sqrt(dlat * dlat + dlng * dlng);

    if (dist < 0.001) return p.moisture; // exact match

    const w = 1 / (dist ** power);
    sumWeights += w;
    sumValues += w * p.moisture;
  }

  return sumWeights > 0 ? sumValues / sumWeights : 0;
}

// ── Canvas generation ───────────────────────────────────────────────────

const CANVAS_W = 120; // grid resolution — 120x100 ≈ 12k pixels, fast enough
const CANVAS_H = 100;

/**
 * Generate a data URL for an IDW-interpolated soil moisture overlay.
 * Returns a PNG data URL that can be used as a MapLibre image source.
 */
export function generateSoilMoistureImage(
  points: SoilMoisturePoint[],
  alpha = 255, // full opacity — transparency controlled by MapLibre raster-opacity
): string | null {
  if (points.length === 0) return null;

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
      const moisture = idw(lat, lng, points);
      const { r, g, b } = moistureToRGB(moisture);

      const idx = (y * CANVAS_W + x) * 4;
      imageData.data[idx] = r;
      imageData.data[idx + 1] = g;
      imageData.data[idx + 2] = b;
      imageData.data[idx + 3] = alpha;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

// ── Legend gradient (CSS-compatible) ─────────────────────────────────────

export function legendGradientCSS(): string {
  const stops = COLOR_STOPS.map(
    (s) => `rgb(${s.color.r},${s.color.g},${s.color.b})`,
  );
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

export const LEGEND_TICKS = [
  { val: 0.10, label: "Сухая" },
  { val: 0.20, label: "" },
  { val: 0.30, label: "Норма" },
  { val: 0.40, label: "" },
  { val: 0.50, label: "Насыщ." },
];
