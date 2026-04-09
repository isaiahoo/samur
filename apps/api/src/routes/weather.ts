// SPDX-License-Identifier: AGPL-3.0-only

import { Router } from "express";
import { getCachedPrecipitation } from "../services/precipitationClient.js";
import { getCachedSoilMoisture } from "../services/soilMoistureClient.js";

const router = Router();

/**
 * GET /api/v1/weather/precipitation
 *
 * Returns precipitation forecast grid for heatmap display.
 * Data is cached in-memory, refreshed every 6 hours by the scheduler.
 */
router.get("/precipitation", (_req, res) => {
  const data = getCachedPrecipitation();

  res.json({
    success: true,
    data: data.map((p) => ({
      lat: p.lat,
      lng: p.lng,
      precipitation: p.precipitation24h,
    })),
    meta: {
      points: data.length,
      unit: "mm/24h",
    },
  });
});

/**
 * GET /api/v1/weather/soil-moisture
 *
 * Returns soil moisture grid for heatmap display.
 * Values are volumetric water content (m³/m³): 0.1=dry, 0.3=normal, 0.45+=saturated.
 * Data is cached in-memory, refreshed every 6 hours by the scheduler.
 */
router.get("/soil-moisture", (_req, res) => {
  const data = getCachedSoilMoisture();

  res.json({
    success: true,
    data: data.map((p) => ({
      lat: p.lat,
      lng: p.lng,
      moisture: p.moisture,
    })),
    meta: {
      points: data.length,
      unit: "m³/m³",
    },
  });
});

export default router;
