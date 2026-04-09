// SPDX-License-Identifier: AGPL-3.0-only

import { Router } from "express";
import { getCachedPrecipitation } from "../services/precipitationClient.js";

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

export default router;
