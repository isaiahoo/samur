// SPDX-License-Identifier: AGPL-3.0-only

import { Router } from "express";
import { getCachedEarthquakes } from "../services/earthquakeClient.js";
import { prisma } from "@samur/db";
import { AppError } from "../middleware/error.js";

const router = Router();

/**
 * GET /api/v1/seismic/recent
 *
 * Returns recent earthquakes in the Caucasus region.
 * Default: last 7 days, M3.5+. Configurable via query params.
 * Data is cached in-memory, refreshed every 5 minutes by the scheduler.
 */
router.get("/recent", (req, res) => {
  const parsedDays = parseInt(req.query.days as string, 10);
  const days = Math.min(Math.max(Number.isNaN(parsedDays) ? 7 : parsedDays, 1), 30);

  const parsedMinMag = parseFloat(req.query.minmag as string);
  const minMag = Math.min(Math.max(Number.isNaN(parsedMinMag) ? 2.5 : parsedMinMag, 0), 10);

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const data = getCachedEarthquakes().filter((e) => {
    return e.magnitude >= minMag && new Date(e.time) >= cutoff;
  });

  res.set("Cache-Control", "public, max-age=300");
  res.json({
    success: true,
    data,
    meta: {
      count: data.length,
      days,
      minMagnitude: minMag,
      bbox: { minlat: 41.0, maxlat: 44.5, minlon: 44.0, maxlon: 49.0 },
    },
  });
});

/**
 * GET /api/v1/seismic/:id
 *
 * Returns a single earthquake event by internal ID.
 */
router.get("/:id", async (req, res) => {
  const record = await prisma.earthquake.findUnique({
    where: { id: req.params.id },
  });

  if (!record) {
    throw new AppError(404, "NOT_FOUND", "Землетрясение не найдено");
  }

  res.json({
    success: true,
    data: {
      id: record.id,
      usgsId: record.usgsId,
      magnitude: record.magnitude,
      depth: record.depth,
      lat: record.lat,
      lng: record.lng,
      place: record.place,
      time: record.time.toISOString(),
      felt: record.felt,
      mmi: record.mmi,
      source: record.source,
    },
  });
});

export default router;
