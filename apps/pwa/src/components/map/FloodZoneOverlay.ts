// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Flood zone overlay — circle-based visualization around gauge stations.
 *
 * Design: warm yellow → orange → red around stations with elevated water.
 * Uses circle-based rendering (not full-field IDW) since only 15 stations
 * exist — full IDW would create misleading blobs between distant stations.
 *
 * dangerRatio thresholds:
 *   < 0.3  = normal (invisible)
 *   0.3–0.5 = elevated (warm yellow)
 *   0.5–0.8 = high (orange)
 *   0.8–1.0 = danger (red-orange)
 *   > 1.0   = critical (deep red)
 */

import type { RiverLevel } from "@samur/shared";
import { SOIL_BOUNDS, coastlineLng } from "./SoilMoistureOverlay.js";

// ── Danger ratio computation ────────────────────────────────────────────

function computeDangerRatio(r: RiverLevel): number {
  if (r.levelCm !== null && r.dangerLevelCm && r.dangerLevelCm > 0) {
    return r.levelCm / r.dangerLevelCm;
  }
  if (r.dischargeCubicM !== null && r.dischargeMean && r.dischargeMean > 0) {
    return (r.dischargeCubicM / r.dischargeMean) / 3;
  }
  return 0;
}

interface FloodZonePoint {
  lat: number;
  lng: number;
  dangerRatio: number;
}

// ── Canvas generation ───────────────────────────────────────────────────

const CANVAS_W = 280;
const CANVAS_H = 220;

/** Radius around each station (degrees, ~0.4° ≈ 40km) */
const STATION_RADIUS = 0.4;

/** Minimum dangerRatio to render */
const MIN_DANGER = 0.3;

/**
 * Generate flood zone overlay — one circle per station with elevated water.
 * Circle-based rendering like RunoffOverlay, not full-field IDW.
 */
export function generateFloodZoneImage(
  riverLevels: RiverLevel[],
): string | null {
  // Convert to flood zone points and filter
  const floodPoints: FloodZonePoint[] = [];
  for (const r of riverLevels) {
    if (r.isForecast) continue;
    const dangerRatio = computeDangerRatio(r);
    if (dangerRatio >= MIN_DANGER) {
      floodPoints.push({ lat: r.lat, lng: r.lng, dangerRatio });
    }
  }

  if (floodPoints.length === 0) return null;

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
      if (lng > coastlineLng(lat)) continue;

      // Find nearest qualifying station and its distance
      let bestRatio = 0;
      let bestDist = Infinity;
      for (const p of floodPoints) {
        const dlat = p.lat - lat;
        const dlng = p.lng - lng;
        const dist = Math.sqrt(dlat * dlat + dlng * dlng);
        if (dist < bestDist) {
          bestDist = dist;
          bestRatio = p.dangerRatio;
        }
      }

      // Only draw within station radius
      if (bestDist > STATION_RADIUS) continue;

      // Smooth fade from center to edge
      const fade = 1 - (bestDist / STATION_RADIUS);

      let r: number, g: number, b: number, a: number;

      if (bestRatio < 0.5) {
        // Elevated: warm yellow
        const t = (bestRatio - MIN_DANGER) / (0.5 - MIN_DANGER);
        r = 250;
        g = 220 - Math.round(t * 30);   // 220 → 190
        b = 50 - Math.round(t * 20);    // 50 → 30
        a = Math.round((100 + t * 40) * fade);  // 100 → 140
      } else if (bestRatio < 0.8) {
        // High: orange
        const t = (bestRatio - 0.5) / 0.3;
        r = 245;
        g = 190 - Math.round(t * 60);   // 190 → 130
        b = 30;
        a = Math.round((140 + t * 30) * fade);  // 140 → 170
      } else if (bestRatio < 1.0) {
        // Danger: red-orange
        const t = (bestRatio - 0.8) / 0.2;
        r = 235 - Math.round(t * 10);   // 235 → 225
        g = 130 - Math.round(t * 60);   // 130 → 70
        b = 30;
        a = Math.round((170 + t * 30) * fade);  // 170 → 200
      } else {
        // Critical: deep red (above danger level)
        const t = Math.min((bestRatio - 1.0) / 0.5, 1.0);
        r = 225 - Math.round(t * 25);   // 225 → 200
        g = 70 - Math.round(t * 40);    // 70 → 30
        b = 30 - Math.round(t * 10);    // 30 → 20
        a = Math.round((200 + t * 30) * fade);  // 200 → 230
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

export function floodLegendGradientCSS(): string {
  return "linear-gradient(to right, rgba(250,220,50,0.6) 0%, rgba(245,150,30,0.8) 33%, rgba(235,70,30,0.85) 66%, rgba(200,30,20,0.95) 100%)";
}
