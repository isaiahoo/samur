// SPDX-License-Identifier: AGPL-3.0-only
import { Router } from "express";
import { prisma } from "@samur/db";
import type { Prisma } from "@prisma/client";
import { optionalAuth, requireAuth, requireRole } from "../middleware/auth.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import {
  CreateHelpRequestSchema,
  UpdateHelpRequestSchema,
  HelpRequestQuerySchema,
  CreateSOSSchema,
} from "@samur/shared";
import type { HelpRequest } from "@samur/shared";
import { AppError } from "../middleware/error.js";
import { getIdsWithinRadius } from "../lib/spatial.js";
import { getHelpRequestTransitionError } from "../lib/statusTransitions.js";
import {
  emitHelpRequestCreated,
  emitHelpRequestUpdated,
  emitHelpRequestClaimed,
  emitSOSCreated,
} from "../lib/emitter.js";
import { paramId } from "../lib/params.js";
import {
  checkSosRateLimit,
  findExistingAnonymousSOS,
  computeConfidenceScore,
  isCrisisMode,
} from "../lib/sosVerification.js";

const router = Router();

router.get(
  "/",
  validateQuery(HelpRequestQuerySchema),
  async (req, res, next) => {
    try {
      const q = (req as unknown as { parsedQuery: Record<string, unknown> }).parsedQuery as {
        page: number; limit: number; type?: string; category?: string;
        status?: string; urgency?: string; source?: string;
        sort: string; order: string;
        lat?: number; lng?: number; radius?: number;
        north?: number; south?: number; east?: number; west?: number;
      };

      const where: Prisma.HelpRequestWhereInput = { deletedAt: null };

      if (q.type) where.type = q.type as never;
      if (q.category) where.category = q.category as never;
      if (q.status) where.status = q.status as never;
      if (q.urgency) where.urgency = q.urgency as never;
      if (q.source) where.source = q.source as never;

      if (q.lat != null && q.lng != null && q.radius != null) {
        const ids = await getIdsWithinRadius("help_requests", q.lat, q.lng, q.radius);
        where.id = { in: ids };
      } else if (q.north != null && q.south != null && q.east != null && q.west != null) {
        where.lat = { gte: q.south, lte: q.north };
        where.lng = { gte: q.west, lte: q.east };
      }

      const orderBy: Prisma.HelpRequestOrderByWithRelationInput =
        q.sort === "urgency"
          ? { urgency: q.order as Prisma.SortOrder }
          : q.sort === "updated_at"
            ? { updatedAt: q.order as Prisma.SortOrder }
            : { createdAt: q.order as Prisma.SortOrder };

      const [items, total] = await Promise.all([
        prisma.helpRequest.findMany({
          where,
          orderBy,
          skip: (q.page - 1) * q.limit,
          take: q.limit,
          include: {
            author: { select: { id: true, name: true, role: true } },
            claimer: { select: { id: true, name: true, role: true } },
          },
        }),
        prisma.helpRequest.count({ where }),
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

router.post(
  "/sos",
  validateBody(CreateSOSSchema),
  async (req, res, next) => {
    try {
      const { lat, lng, situation, peopleCount, contactPhone, contactName, batteryLevel, source } = req.body;
      const clientIp = req.ip ?? "unknown";

      // Tier 1.1 — Per-IP SOS rate limit (1 per 5 min)
      const rateCheck = await checkSosRateLimit(clientIp);
      if (!rateCheck.allowed) {
        res.status(429).json({
          success: false,
          error: {
            code: "SOS_RATE_LIMITED",
            message: "Вы уже отправили сигнал SOS. Подождите 5 минут.",
            retryAfterSeconds: rateCheck.retryAfterSeconds,
          },
        });
        return;
      }

      // Duplicate prevention: authenticated user — check by userId
      if (req.user?.sub) {
        const existing = await prisma.helpRequest.findFirst({
          where: {
            userId: req.user.sub,
            isSOS: true,
            status: { in: ["open", "claimed", "in_progress"] },
            deletedAt: null,
          },
          include: {
            author: { select: { id: true, name: true, role: true } },
            claimer: { select: { id: true, name: true, role: true } },
          },
          orderBy: { createdAt: "desc" },
        });
        if (existing) {
          res.status(200).json({ success: true, data: existing });
          return;
        }
      }

      // Tier 1.2 — Anonymous dedup by IP + coordinates (30 min, 1km radius)
      if (!req.user?.sub) {
        const existingAnon = await findExistingAnonymousSOS(clientIp, lat, lng);
        if (existingAnon) {
          const full = await prisma.helpRequest.findFirst({
            where: { id: existingAnon.id, deletedAt: null },
            include: {
              author: { select: { id: true, name: true, role: true } },
              claimer: { select: { id: true, name: true, role: true } },
            },
          });
          res.status(200).json({ success: true, data: full });
          return;
        }
      }

      // Tier 1.3 — Contextual confidence score + Tier 1.4 — Adaptive crisis mode
      const [confidenceScore, crisisActive] = await Promise.all([
        computeConfidenceScore({
          lat,
          lng,
          isAuthenticated: !!req.user?.sub,
          hasSituation: !!situation,
          batteryLevel,
        }),
        isCrisisMode(),
      ]);

      // During crisis: all SOS are critical. Normal mode with score < 20: flag for verification
      const urgency = crisisActive || confidenceScore >= 20 ? "critical" : "urgent";

      const hr = await prisma.helpRequest.create({
        data: {
          userId: req.user?.sub ?? null,
          type: "need",
          category: "rescue",
          urgency,
          isSOS: true,
          situation: situation ?? null,
          peopleCount: peopleCount ?? null,
          batteryLevel: batteryLevel ?? null,
          sourceIp: clientIp,
          confidenceScore,
          lat,
          lng,
          contactPhone: contactPhone ?? null,
          contactName: contactName ?? null,
          source: source ?? "pwa",
          description: situation
            ? `SOS — ${situation}`
            : "SOS",
        },
        include: {
          author: { select: { id: true, name: true, role: true } },
          claimer: { select: { id: true, name: true, role: true } },
        },
      });

      const typed = hr as unknown as HelpRequest;
      emitSOSCreated(typed);
      emitHelpRequestCreated(typed);

      res.status(201).json({ success: true, data: hr });
    } catch (err) {
      next(err);
    }
  }
);

router.get("/:id", async (req, res, next) => {
  try {
    const id = paramId(req);
    const hr = await prisma.helpRequest.findFirst({
      where: { id, deletedAt: null },
      include: {
        author: { select: { id: true, name: true, role: true, phone: true } },
        claimer: { select: { id: true, name: true, role: true, phone: true } },
        incident: true,
      },
    });

    if (!hr) {
      throw new AppError(404, "NOT_FOUND", "Запрос помощи не найден");
    }

    res.json({ success: true, data: hr });
  } catch (err) {
    next(err);
  }
});

router.post(
  "/",
  validateBody(CreateHelpRequestSchema),
  async (req, res, next) => {
    try {
      const {
        incidentId, type, category, description,
        lat, lng, address, urgency, contactPhone, contactName, photoUrls, source,
      } = req.body;

      if (incidentId) {
        const incident = await prisma.incident.findFirst({
          where: { id: incidentId, deletedAt: null },
        });
        if (!incident) {
          throw new AppError(404, "INCIDENT_NOT_FOUND", "Связанный инцидент не найден");
        }
      }

      const hr = await prisma.helpRequest.create({
        data: {
          userId: req.user?.sub ?? null,
          incidentId: incidentId ?? null,
          type,
          category,
          description,
          lat,
          lng,
          address,
          urgency: urgency ?? "normal",
          contactPhone,
          contactName,
          photoUrls: photoUrls ?? [],
          source: source ?? "pwa",
        },
        include: {
          author: { select: { id: true, name: true, role: true } },
          claimer: { select: { id: true, name: true, role: true } },
        },
      });

      emitHelpRequestCreated(hr as unknown as HelpRequest);

      res.status(201).json({ success: true, data: hr });
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  "/:id",
  requireAuth,
  validateBody(UpdateHelpRequestSchema),
  async (req, res, next) => {
    try {
      const id = paramId(req);
      const existing = await prisma.helpRequest.findFirst({
        where: { id, deletedAt: null },
      });

      if (!existing) {
        throw new AppError(404, "NOT_FOUND", "Запрос помощи не найден");
      }

      // Only author, claimer, coordinator/admin, or a volunteer claiming an
      // unclaimed request can modify. The volunteer-claim case is the reason
      // an otherwise-unrelated user is allowed to touch this row at all.
      const isOwner = existing.userId && existing.userId === req.user!.sub;
      const isClaimer = existing.claimedBy && existing.claimedBy === req.user!.sub;
      const isPrivileged = req.user!.role === "coordinator" || req.user!.role === "admin";
      const isVolunteerClaiming =
        req.body.status === "claimed" &&
        !existing.claimedBy &&
        req.user!.role === "volunteer";
      if (!isOwner && !isClaimer && !isPrivileged && !isVolunteerClaiming) {
        throw new AppError(403, "FORBIDDEN", "Недостаточно прав для редактирования");
      }

      const newStatus = req.body.status;
      if (newStatus && newStatus !== existing.status) {
        const error = getHelpRequestTransitionError(existing.status, newStatus);
        if (error) {
          throw new AppError(422, "INVALID_TRANSITION", error);
        }
      }

      const data: Prisma.HelpRequestUpdateInput = {};
      if (req.body.description !== undefined) data.description = req.body.description;
      if (req.body.urgency !== undefined) data.urgency = req.body.urgency;
      if (req.body.contactPhone !== undefined) data.contactPhone = req.body.contactPhone;
      if (req.body.contactName !== undefined) data.contactName = req.body.contactName;
      if (req.body.photoUrls !== undefined) data.photoUrls = req.body.photoUrls;

      let isClaim = false;
      if (newStatus !== undefined) {
        data.status = newStatus;
        if (newStatus === "claimed" && !existing.claimedBy) {
          // Only volunteers, coordinators, and admins can claim
          const role = req.user!.role;
          if (role !== "volunteer" && role !== "coordinator" && role !== "admin") {
            throw new AppError(403, "FORBIDDEN", "Только волонтёры могут взять заявку");
          }
          data.claimer = { connect: { id: req.user!.sub } };
          isClaim = true;
        }
        if (newStatus === "open") {
          data.claimer = { disconnect: true };
        }
      }
      data.version = { increment: 1 };

      let updated;
      try {
        updated = await prisma.helpRequest.update({
          where: { id, version: existing.version },
          data,
          include: {
            author: { select: { id: true, name: true, role: true } },
            claimer: { select: { id: true, name: true, role: true } },
          },
        });
      } catch (err: unknown) {
        if (err instanceof Error && "code" in err && (err as { code: string }).code === "P2025") {
          throw new AppError(409, "CONFLICT", "Запись была изменена другим пользователем. Обновите страницу.");
        }
        throw err;
      }

      const typed = updated as unknown as HelpRequest;
      if (isClaim) {
        emitHelpRequestClaimed(typed);
      } else {
        emitHelpRequestUpdated(typed);
      }

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
      const existing = await prisma.helpRequest.findFirst({
        where: { id, deletedAt: null },
      });

      if (!existing) {
        throw new AppError(404, "NOT_FOUND", "Запрос помощи не найден");
      }

      await prisma.helpRequest.update({
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
