// SPDX-License-Identifier: AGPL-3.0-only
import { Router } from "express";
import { optionalAuth } from "../middleware/auth.js";
import { validateQuery } from "../middleware/validate.js";
import { MapClusterQuerySchema } from "@samur/shared";
import { getMapClusters } from "../lib/spatial.js";

const router = Router();

router.get(
  "/clusters",
  optionalAuth,
  validateQuery(MapClusterQuerySchema),
  async (req, res, next) => {
    try {
      const q = (req as unknown as { parsedQuery: Record<string, unknown> }).parsedQuery as {
        zoom: number; south: number; west: number; north: number; east: number;
      };

      const { clusters, points } = await getMapClusters(
        q.zoom,
        q.south,
        q.west,
        q.north,
        q.east
      );

      const formattedClusters = clusters.map((c) => ({
        lat: Number(c.lat),
        lng: Number(c.lng),
        count: c.count,
        type: c.source_type,
        mostUrgentSeverity: c.most_urgent,
      }));

      const formattedPoints = points.map((p) => ({
        id: p.id,
        lat: Number(p.lat),
        lng: Number(p.lng),
        type: p.source_type,
        subType: p.sub_type,
        severity: p.severity,
        status: p.status,
      }));

      res.json({
        success: true,
        data: {
          clusters: formattedClusters,
          points: formattedPoints,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
