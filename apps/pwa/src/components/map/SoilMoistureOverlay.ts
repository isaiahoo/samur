// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Soil moisture IDW overlay — "wet ground" warning zones.
 *
 * Design principle: only show where the ground is WET.
 * Dry/normal areas = fully transparent (nothing on map).
 * Blue = wet ground, darker blue = more saturated.
 * Regular people understand: blue patches = wet = flood risk.
 *
 * Does NOT paint over the Caspian Sea.
 */

import type { SoilMoisturePoint } from "./geoJsonHelpers.js";

// ── Geographic bounds for Dagestan coverage ─────────────────────────────

export const SOIL_BOUNDS = {
  north: 44.5,
  south: 41.0,
  east: 48.8,
  west: 45.5,
} as const;

// ── Threshold: below this = dry/normal = invisible ──────────────────────

const WET_THRESHOLD = 0.26; // below = transparent (no flood concern)
const SATURATED = 0.45;      // above = max intensity

// ── Approximate Caspian coastline (to avoid painting over sea) ──────────
// Linear approximation: lng = f(lat) for the Dagestan coast

function coastlineLng(lat: number): number {
  // Approximate coastline: more east in the south, curves west in the north
  if (lat >= 43.5) return 47.2;   // Makhachkala → Sulak area
  if (lat >= 43.0) return 47.5;   // Makhachkala
  if (lat >= 42.5) return 47.8;   // Kaspiysk
  if (lat >= 42.0) return 48.1;   // Derbent area
  if (lat >= 41.5) return 48.4;   // South coast
  return 48.5;
}

// ── IDW interpolation ───────────────────────────────────────────────────

function idw(lat: number, lng: number, points: SoilMoisturePoint[], power = 2.5): number {
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

const CANVAS_W = 120;
const CANVAS_H = 100;

/**
 * Generate a "wet ground" overlay: only blue where moisture > threshold.
 * Everything else (dry, normal, sea) is fully transparent.
 */
export function generateSoilMoistureImage(
  points: SoilMoisturePoint[],
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
      const idx = (y * CANVAS_W + x) * 4;

      // Skip if over sea
      if (lng > coastlineLng(lat)) {
        imageData.data[idx + 3] = 0;
        continue;
      }

      const moisture = idw(lat, lng, points);

      // Below threshold = invisible (dry/normal ground, no concern)
      if (moisture < WET_THRESHOLD) {
        imageData.data[idx + 3] = 0;
        continue;
      }

      // Map moisture above threshold to blue intensity
      // WET_THRESHOLD → light blue, SATURATED → deep blue
      const t = Math.min((moisture - WET_THRESHOLD) / (SATURATED - WET_THRESHOLD), 1.0);

      // Blue color: light sky blue → deep blue
      imageData.data[idx] = Math.round(100 - t * 70);       // R: 100 → 30
      imageData.data[idx + 1] = Math.round(180 - t * 110);  // G: 180 → 70
      imageData.data[idx + 2] = Math.round(235 - t * 35);   // B: 235 → 200

      // Alpha: fade in gradually, stronger for wetter areas
      imageData.data[idx + 3] = Math.round(80 + t * 140);   // 80 → 220
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

// ── Legend ───────────────────────────────────────────────────────────────

export function legendGradientCSS(): string {
  return "linear-gradient(to right, rgba(100,180,235,0.4), rgba(65,125,220,0.7), rgba(30,70,200,0.9))";
}

export const LEGEND_TICKS = [
  { val: 0, label: "Влажно" },
  { val: 0.5, label: "" },
  { val: 1, label: "Очень влажно" },
];
