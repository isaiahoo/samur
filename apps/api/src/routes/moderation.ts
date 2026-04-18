// SPDX-License-Identifier: AGPL-3.0-only
import { Router } from "express";
import { prisma } from "@samur/db";
import type { Prisma } from "@prisma/client";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { ResolveHelpMessageReportSchema } from "@samur/shared";
import { AppError } from "../middleware/error.js";
import { emitHelpMessageDeleted } from "../lib/emitter.js";
import { auditLog } from "../lib/auditLog.js";

const router = Router();

/**
 * GET /moderation/message-reports
 * Coordinator/admin queue of user-submitted reports on help-request
 * chat messages. Defaults to status=open so the queue is actionable;
 * ?status=resolved_delete|resolved_dismiss|all for audit views.
 */
router.get(
  "/message-reports",
  requireAuth,
  requireRole("coordinator", "admin"),
  async (req, res, next) => {
    try {
      const statusFilter = String(req.query.status ?? "open");
      const limit = Math.min(Math.max(parseInt(String(req.query.limit)) || 50, 1), 100);

      const where: Prisma.HelpMessageReportWhereInput =
        statusFilter === "all"
          ? {}
          : statusFilter === "resolved_delete" ||
              statusFilter === "resolved_dismiss" ||
              statusFilter === "open"
            ? { status: statusFilter }
            : { status: "open" };

      const reports = await prisma.helpMessageReport.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        include: {
          message: {
            // Coordinators see full content including the original body of
            // already-deleted messages so they can audit the moderation
            // decision — participants never see it (GET /:id/messages
            // strips body on deletedAt).
            include: {
              author: { select: { id: true, name: true, role: true } },
              helpRequest: { select: { id: true } },
            },
          },
          reporter: { select: { id: true, name: true, role: true } },
          resolver: { select: { id: true, name: true, role: true } },
        },
      });

      // Flatten helpRequestId up to the report for client convenience.
      const data = reports.map((r) => ({
        id: r.id,
        messageId: r.messageId,
        reporterId: r.reporterId,
        reason: r.reason,
        details: r.details,
        status: r.status,
        resolvedBy: r.resolvedBy,
        resolvedAt: r.resolvedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        helpRequestId: r.message.helpRequestId,
        message: {
          id: r.message.id,
          helpRequestId: r.message.helpRequestId,
          authorId: r.message.authorId,
          body: r.message.body,
          photoUrls: r.message.photoUrls,
          createdAt: r.message.createdAt.toISOString(),
          deletedAt: r.message.deletedAt?.toISOString() ?? null,
          deletedReason: r.message.deletedReason,
          author: r.message.author,
        },
        reporter: r.reporter,
        resolver: r.resolver,
      }));

      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * PATCH /moderation/message-reports/:id
 * Coordinator/admin resolves a report. `delete_message` soft-deletes
 * the offending message (and cascades to every open report on it), so
 * two reports on the same message resolved with `delete_message` don't
 * double-delete.
 */
router.patch(
  "/message-reports/:id",
  requireAuth,
  requireRole("coordinator", "admin"),
  validateBody(ResolveHelpMessageReportSchema),
  async (req, res, next) => {
    try {
      const reportId = String(req.params.id || "").trim();
      if (!reportId || reportId.length > 64) {
        throw new AppError(400, "INVALID_ID", "Некорректный идентификатор жалобы");
      }
      const report = await prisma.helpMessageReport.findUnique({
        where: { id: reportId },
        include: { message: { select: { id: true, helpRequestId: true, deletedAt: true } } },
      });
      if (!report) throw new AppError(404, "NOT_FOUND", "Жалоба не найдена");
      if (report.status !== "open") {
        // Idempotent — already resolved.
        res.json({ success: true, data: { id: reportId, status: report.status } });
        return;
      }
      const now = new Date();
      const { action } = req.body as { action: "delete_message" | "dismiss" };

      if (action === "delete_message") {
        // Atomically soft-delete the message + mark every open report
        // on the same message resolved_delete (not just this one — the
        // queue shouldn't still show siblings after the message is gone).
        const shouldDelete = !report.message.deletedAt;
        await prisma.$transaction([
          ...(shouldDelete
            ? [
                prisma.helpMessage.update({
                  where: { id: report.message.id },
                  data: {
                    deletedAt: now,
                    deletedBy: req.user!.sub,
                    deletedReason: "moderator_removed",
                  },
                }),
              ]
            : []),
          prisma.helpMessageReport.updateMany({
            where: { messageId: report.message.id, status: "open" },
            data: {
              status: "resolved_delete",
              resolvedBy: req.user!.sub,
              resolvedAt: now,
            },
          }),
        ]);
        if (shouldDelete) {
          emitHelpMessageDeleted(report.message.helpRequestId, report.message.id);
        }
      } else {
        // Dismiss: resolve just this report. Siblings on the same
        // message stay open — each reporter's claim is independent.
        await prisma.helpMessageReport.update({
          where: { id: reportId },
          data: {
            status: "resolved_dismiss",
            resolvedBy: req.user!.sub,
            resolvedAt: now,
          },
        });
      }

      auditLog({
        action: "resolve_help_message_report",
        actorId: req.user!.sub,
        targetId: reportId,
        meta: { resolution: action, messageId: report.message.id },
      });

      res.json({
        success: true,
        data: {
          id: reportId,
          status: action === "delete_message" ? "resolved_delete" : "resolved_dismiss",
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
