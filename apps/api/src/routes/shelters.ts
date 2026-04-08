// SPDX-License-Identifier: AGPL-3.0-only
import { Router } from "express";
import { prisma } from "@samur/db";
import type { Prisma, Amenity } from "@prisma/client";
import { optionalAuth, requireAuth, requireRole } from "../middleware/auth.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import {
  CreateShelterSchema,
  UpdateShelterSchema,
  ShelterQuerySchema,
} from "@samur/shared";
import type { Shelter } from "@samur/shared";
import { AppError } from "../middleware/error.js";
import { getIdsWithinRadius } from "../lib/spatial.js";
import { emitShelterUpdated } from "../lib/emitter.js";
import { paramId } from "../lib/params.js";

const router = Router();

router.get(
  "/",
  validateQuery(ShelterQuerySchema),
  async (req, res, next) => {
    try {
      const q = (req as unknown as { parsedQuery: Record<string, unknown> }).parsedQuery as {
        page: number; limit: number; status?: string; amenity?: string;
        sort: string; order: string;
        lat?: number; lng?: number; radius?: number;
      };

      const where: Prisma.ShelterWhereInput = { deletedAt: null };

      if (q.status) where.status = q.status as never;
      if (q.amenity) where.amenities = { has: q.amenity as Amenity };

      if (q.lat != null && q.lng != null && q.radius != null) {
        const ids = await getIdsWithinRadius("shelters", q.lat, q.lng, q.radius);
        where.id = { in: ids };
      }

      const orderBy: Prisma.ShelterOrderByWithRelationInput =
        q.sort === "current_occupancy"
          ? { currentOccupancy: q.order as Prisma.SortOrder }
          : q.sort === "name"
            ? { name: q.order as Prisma.SortOrder }
            : { createdAt: q.order as Prisma.SortOrder };

      const [items, total] = await Promise.all([
        prisma.shelter.findMany({
          where,
          orderBy,
          skip: (q.page - 1) * q.limit,
          take: q.limit,
        }),
        prisma.shelter.count({ where }),
      ]);

      res.json({
        success: true,
        data: items,
        meta: { total, page: q.page, limit: q.limit },
      });
    } catch (err) {
      next(err);
    }
  }
);

router.get("/:id", async (req, res, next) => {
  try {
    const id = paramId(req);
    const shelter = await prisma.shelter.findFirst({
      where: { id, deletedAt: null },
    });

    if (!shelter) {
      throw new AppError(404, "NOT_FOUND", "Убежище не найдено");
    }

    res.json({ success: true, data: shelter });
  } catch (err) {
    next(err);
  }
});

router.post(
  "/",
  requireAuth,
  requireRole("coordinator", "admin"),
  validateBody(CreateShelterSchema),
  async (req, res, next) => {
    try {
      const { name, lat, lng, address, capacity, currentOccupancy, amenities, contactPhone, status } = req.body;

      const shelter = await prisma.shelter.create({
        data: {
          name,
          lat,
          lng,
          address,
          capacity,
          currentOccupancy: currentOccupancy ?? 0,
          amenities: amenities ?? [],
          contactPhone,
          status: status ?? "open",
        },
      });

      emitShelterUpdated(shelter as unknown as Shelter);

      res.status(201).json({ success: true, data: shelter });
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  "/:id",
  requireAuth,
  requireRole("coordinator", "admin"),
  validateBody(UpdateShelterSchema),
  async (req, res, next) => {
    try {
      const id = paramId(req);
      const existing = await prisma.shelter.findFirst({
        where: { id, deletedAt: null },
      });

      if (!existing) {
        throw new AppError(404, "NOT_FOUND", "Убежище не найдено");
      }

      const data: Prisma.ShelterUpdateInput = {};
      if (req.body.name !== undefined) data.name = req.body.name;
      if (req.body.capacity !== undefined) data.capacity = req.body.capacity;
      if (req.body.currentOccupancy !== undefined) data.currentOccupancy = req.body.currentOccupancy;
      if (req.body.amenities !== undefined) data.amenities = req.body.amenities;
      if (req.body.contactPhone !== undefined) data.contactPhone = req.body.contactPhone;
      if (req.body.status !== undefined) data.status = req.body.status;

      const updated = await prisma.shelter.update({
        where: { id },
        data,
      });

      emitShelterUpdated(updated as unknown as Shelter);

      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  }
);

router.delete(
  "/:id",
  requireAuth,
  requireRole("coordinator", "admin"),
  async (req, res, next) => {
    try {
      const id = paramId(req);
      const existing = await prisma.shelter.findFirst({
        where: { id, deletedAt: null },
      });

      if (!existing) {
        throw new AppError(404, "NOT_FOUND", "Убежище не найдено");
      }

      await prisma.shelter.update({
        where: { id },
        data: { deletedAt: new Date() },
      });

      res.json({ success: true, data: { id, deleted: true } });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
