// SPDX-License-Identifier: AGPL-3.0-only
import { Router } from "express";
import { prisma } from "@samur/db";
import { optionalAuth } from "../middleware/auth.js";

const router = Router();

router.get("/", optionalAuth, async (_req, res, next) => {
  try {
    const [
      incidentsByType,
      openHelpRequestsByCategory,
      activeVolunteers,
      shelterStats,
    ] = await Promise.all([
      prisma.incident.groupBy({
        by: ["type"],
        where: { deletedAt: null, status: { not: "false_report" } },
        _count: { id: true },
      }),

      prisma.helpRequest.groupBy({
        by: ["category"],
        where: { deletedAt: null, status: { in: ["open", "claimed", "in_progress"] } },
        _count: { id: true },
      }),

      prisma.user.count({
        where: {
          role: "volunteer",
          claimedRequests: {
            some: {
              status: { in: ["claimed", "in_progress"] },
              deletedAt: null,
            },
          },
        },
      }),

      prisma.shelter.aggregate({
        where: { deletedAt: null, status: { not: "closed" } },
        _sum: { capacity: true, currentOccupancy: true },
      }),
    ]);

    const incidentTypeMap: Record<string, number> = {};
    for (const row of incidentsByType) {
      incidentTypeMap[row.type] = row._count.id;
    }

    const helpCategoryMap: Record<string, number> = {};
    for (const row of openHelpRequestsByCategory) {
      helpCategoryMap[row.category] = row._count.id;
    }

    res.json({
      success: true,
      data: {
        incidentsByType: incidentTypeMap,
        openHelpRequestsByCategory: helpCategoryMap,
        activeVolunteers,
        shelterCapacity: {
          total: shelterStats._sum.capacity ?? 0,
          occupied: shelterStats._sum.currentOccupancy ?? 0,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
