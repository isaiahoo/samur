// SPDX-License-Identifier: AGPL-3.0-only
import { Router } from "express";
import { prisma } from "@samur/db";
import type { Prisma } from "@prisma/client";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import { incidentsRateLimiter } from "../middleware/rateLimiter.js";
import {
  CreateIncidentSchema,
  UpdateIncidentSchema,
  IncidentQuerySchema,
} from "@samur/shared";
import type { Incident } from "@samur/shared";
import { AppError } from "../middleware/error.js";
import { getIdsWithinRadius } from "../lib/spatial.js";
import { getIncidentTransitionError } from "../lib/statusTransitions.js";
import { emitIncidentCreated, emitIncidentUpdated } from "../lib/emitter.js";
import { paramId } from "../lib/params.js";

const router = Router();

router.get(
  "/",
  validateQuery(IncidentQuerySchema),
  async (req, res, next) => {
    try {
      const q = (req as unknown as { parsedQuery: Record<string, unknown> }).parsedQuery as {
        page: number; limit: number; type?: string; severity?: string;
        status?: string; source?: string; sort: string; order: string;
        lat?: number; lng?: number; radius?: number;
        north?: number; south?: number; east?: number; west?: number;
      };

      const where: Prisma.IncidentWhereInput = { deletedAt: null };

      if (q.type) where.type = q.type as never;
      if (q.severity) where.severity = q.severity as never;
      if (q.status) where.status = q.status as never;
      if (q.source) where.source = q.source as never;

      // Geo-filtering: radius takes precedence over bounds
      if (q.lat != null && q.lng != null && q.radius != null) {
        const ids = await getIdsWithinRadius("incidents", q.lat, q.lng, q.radius);
        where.id = { in: ids };
      } else if (q.north != null && q.south != null && q.east != null && q.west != null) {
        where.lat = { gte: q.south, lte: q.north };
        where.lng = { gte: q.west, lte: q.east };
      }

      const orderBy: Prisma.IncidentOrderByWithRelationInput =
        q.sort === "severity"
          ? { severity: q.order as Prisma.SortOrder }
          : q.sort === "updated_at"
            ? { updatedAt: q.order as Prisma.SortOrder }
            : { createdAt: q.order as Prisma.SortOrder };

      const [items, total] = await Promise.all([
        prisma.incident.findMany({
          where,
          orderBy,
          skip: (q.page - 1) * q.limit,
          take: q.limit,
          include: { author: { select: { id: true, name: true, role: true } } },
        }),
        prisma.incident.count({ where }),
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
    const incident = await prisma.incident.findFirst({
      where: { id, deletedAt: null },
      include: {
        author: { select: { id: true, name: true, role: true } },
        verifier: { select: { id: true, name: true, role: true } },
        helpRequests: {
          where: { deletedAt: null },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!incident) {
      throw new AppError(404, "NOT_FOUND", "Инцидент не найден");
    }

    res.json({ success: true, data: incident });
  } catch (err) {
    next(err);
  }
});

router.post(
  "/",
  incidentsRateLimiter,
  validateBody(CreateIncidentSchema),
  async (req, res, next) => {
    try {
      const { type, severity, lat, lng, address, description, photoUrls, source } = req.body;

      const incident = await prisma.incident.create({
        data: {
          userId: req.user?.sub ?? null,
          type,
          severity,
          lat,
          lng,
          address,
          description,
          photoUrls: photoUrls ?? [],
          source: source ?? "pwa",
        },
        include: { author: { select: { id: true, name: true, role: true } } },
      });

      emitIncidentCreated(incident as unknown as Incident);

      res.status(201).json({ success: true, data: incident });
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  "/:id",
  requireAuth,
  validateBody(UpdateIncidentSchema),
  async (req, res, next) => {
    try {
      const id = paramId(req);
      const existing = await prisma.incident.findFirst({
        where: { id, deletedAt: null },
      });

      if (!existing) {
        throw new AppError(404, "NOT_FOUND", "Инцидент не найден");
      }

      // Only author or coordinator/admin can modify
      const isOwner = existing.userId && existing.userId === req.user!.sub;
      const isPrivileged = req.user!.role === "coordinator" || req.user!.role === "admin";
      if (!isOwner && !isPrivileged) {
        throw new AppError(403, "FORBIDDEN", "Недостаточно прав для редактирования");
      }

      // Status transition validation
      if (req.body.status && req.body.status !== existing.status) {
        const error = getIncidentTransitionError(existing.status, req.body.status);
        if (error) {
          throw new AppError(422, "INVALID_TRANSITION", error);
        }
      }

      const data: Prisma.IncidentUpdateInput = {};
      if (req.body.severity !== undefined) data.severity = req.body.severity;
      if (req.body.description !== undefined) data.description = req.body.description;
      if (req.body.photoUrls !== undefined) data.photoUrls = req.body.photoUrls;
      if (req.body.status !== undefined) {
        data.status = req.body.status;
        if (req.body.status === "verified" || req.body.status === "false_report") {
          data.verifier = { connect: { id: req.user!.sub } };
        }
      }
      data.version = { increment: 1 };

      let updated;
      try {
        updated = await prisma.incident.update({
          where: { id, version: existing.version },
          data,
          include: { author: { select: { id: true, name: true, role: true } } },
        });
      } catch (err: unknown) {
        if (err instanceof Error && "code" in err && (err as { code: string }).code === "P2025") {
          throw new AppError(409, "CONFLICT", "Запись была изменена другим пользователем. Обновите страницу.");
        }
        throw err;
      }

      emitIncidentUpdated(updated as unknown as Incident);

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
      const existing = await prisma.incident.findFirst({
        where: { id, deletedAt: null },
      });

      if (!existing) {
        throw new AppError(404, "NOT_FOUND", "Инцидент не найден");
      }

      await prisma.incident.update({
        where: { id },
        data: { deletedAt: new Date(), deletedBy: req.user!.sub },
      });

      res.json({ success: true, data: { id, deleted: true } });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
