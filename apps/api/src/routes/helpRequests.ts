// SPDX-License-Identifier: AGPL-3.0-only
import crypto from "node:crypto";
import { Router } from "express";
import { prisma } from "@samur/db";
import type { Prisma } from "@prisma/client";
import { getRedis } from "../lib/redis.js";
import { optionalAuth, requireAuth, requireRole } from "../middleware/auth.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import {
  CreateHelpRequestSchema,
  UpdateHelpRequestSchema,
  HelpRequestQuerySchema,
  CreateSOSSchema,
  CreateHelpResponseSchema,
  UpdateMyHelpResponseSchema,
  CreateHelpMessageSchema,
  CreateHelpMessageReportSchema,
  SOSFollowUpSchema,
} from "@samur/shared";
import type { HelpRequest, HelpRequestParty, HelpRequestStatus, HelpResponseStatus, HelpMessage } from "@samur/shared";
import { AppError } from "../middleware/error.js";
import { getIdsWithinRadius } from "../lib/spatial.js";
import { getHelpRequestTransitionError } from "../lib/statusTransitions.js";
import {
  emitHelpRequestCreated,
  emitHelpRequestUpdated,
  emitHelpResponseChanged,
  emitHelpMessageCreated,
  emitHelpMessageDeleted,
  emitSOSCreated,
} from "../lib/emitter.js";
import { evictUserFromHelpRoom, clearHelpRoom } from "../socket.js";
import { assertHelpChatAccess, getHelpChatJoinTime } from "../lib/helpAccess.js";
import { assertOwnedUploads, assertOwnedNewUploads } from "../lib/uploadOwnership.js";
import { reportsRateLimiter, messagesRateLimiter } from "../middleware/rateLimiter.js";
import { auditLog } from "../lib/auditLog.js";
import { helpRequestsCreatedTotal } from "../lib/metrics.js";
import { computeUserStats, type UserStats } from "../lib/userStats.js";
import { getRealIp } from "../lib/clientIp.js";
import { paramId } from "../lib/params.js";
import {
  checkSosRateLimit,
  clearSosRateLimit,
  findExistingAnonymousSOS,
  computeConfidenceScore,
  isCrisisMode,
} from "../lib/sosVerification.js";

const router = Router();

/** Generate a random 48-hex update token, bind it to an SOS id in
 * Redis for 60 min, and return it. Used by POST /sos on both the new
 * and existing-row paths — the client always receives a token it can
 * later send back via the follow-up endpoint without having to
 * authenticate (anonymous SOS has no JWT). If Redis is unreachable
 * we return the token anyway; follow-up will fail gracefully. */
async function issueSosUpdateToken(hrId: string): Promise<string> {
  const token = crypto.randomBytes(24).toString("hex");
  const redis = getRedis();
  if (redis) {
    await redis.set(`sos_update:${token}`, hrId, "EX", 3600);
  }
  return token;
}

// ── Phone-number privacy filter ───────────────────────────────────────────
// `contactPhone` is public (the requester explicitly shared it). But the
// user's *account* phone (`author.phone`, `claimer.phone`, responses[].user.phone)
// is their login credential, so we only expose it to parties already tied to
// the request.
//
// Author of the request → sees phones of every responder (needs to call them).
// Each responder → sees their own phone + the author's phone.
// Other responders → can see peer names and statuses but NOT their phones.
// Coordinators / admins → see everything.
interface Caller { sub: string; role: string }
type HelpRequestWithParties = Record<string, unknown> & {
  userId: string | null;
  claimedBy: string | null;
  author?: { phone?: string | null } | null;
  claimer?: { phone?: string | null } | null;
  responses?: Array<{ userId: string; user?: { phone?: string | null } | null }> | null;
};
function filterPhones<T extends HelpRequestWithParties>(row: T, caller: Caller | null): T {
  const isAuthor = !!caller && row.userId === caller.sub;
  const isPrivileged = caller?.role === "coordinator" || caller?.role === "admin";
  // Legacy single-claimer check kept for the claimer column on the row shape.
  const isSingleClaimer = !!caller && row.claimedBy === caller.sub;
  const canSeeAllRelatedPhones = isAuthor || isPrivileged;

  if (!canSeeAllRelatedPhones && !isSingleClaimer) {
    // Strip top-level author/claimer phones for strangers / other responders.
    if (row.author) row.author = { ...row.author, phone: null };
    if (row.claimer) row.claimer = { ...row.claimer, phone: null };
  }

  // Responses[].user.phone: each responder sees their own, the author sees
  // everyone's, strangers see none.
  if (Array.isArray(row.responses)) {
    row.responses = row.responses.map((r) => {
      if (!r.user) return r;
      const isMyResponse = !!caller && r.userId === caller.sub;
      const phoneVisible = canSeeAllRelatedPhones || isMyResponse;
      if (phoneVisible) return r;
      return { ...r, user: { ...r.user, phone: null } };
    }) as typeof row.responses;
  }

  return row;
}
function getCaller(req: { user?: { sub: string; role: string } }): Caller | null {
  return req.user ? { sub: req.user.sub, role: req.user.role } : null;
}

// Attach a UserStats object to every responder.user across a batch of
// help-request rows. Replaces the role-as-identity signal ("Волонтёр")
// with a record of what the person has actually done, which is also the
// foundation for the future achievements layer.
async function attachResponderStats<T extends { responses?: Array<{ user?: { id: string; stats?: UserStats } | null }> | null }>(
  rows: T[],
): Promise<void> {
  const userIds: string[] = [];
  for (const row of rows) {
    if (!Array.isArray(row.responses)) continue;
    for (const r of row.responses) {
      if (r.user?.id) userIds.push(r.user.id);
    }
  }
  if (userIds.length === 0) return;

  const stats = await computeUserStats(userIds);
  for (const row of rows) {
    if (!Array.isArray(row.responses)) continue;
    for (const r of row.responses) {
      if (r.user?.id) {
        const s = stats.get(r.user.id);
        if (s) r.user.stats = s;
      }
    }
  }
}

// Enrich each help-request row with per-caller activity fields: the
// caller's own response status, unread message count (since their last-read
// watermark), and the thread's last-message timestamp. This is what powers
// the "Мои отклики" section on the Help page so a volunteer never has to
// hunt for the requests they're working on.
async function attachCallerActivity<T extends { id: string }>(
  rows: T[],
  userId: string,
): Promise<Array<T & {
  myResponseStatus: string | null;
  myResponseUpdatedAt: string | null;
  unreadMessages: number;
  lastMessageAt: string | null;
}>> {
  if (rows.length === 0) return [] as never;
  const ids = rows.map((r) => r.id);

  const [myResponses, reads, lastMessages, unreadCounts] = await Promise.all([
    prisma.helpResponse.findMany({
      where: { helpRequestId: { in: ids }, userId },
      select: { helpRequestId: true, status: true, updatedAt: true },
    }),
    prisma.helpMessageRead.findMany({
      where: { helpRequestId: { in: ids }, userId },
      select: { helpRequestId: true, lastReadAt: true },
    }),
    prisma.helpMessage.groupBy({
      by: ["helpRequestId"],
      where: { helpRequestId: { in: ids }, deletedAt: null },
      _max: { createdAt: true },
    }),
    // Per-request unread count: messages after my watermark, authored by
    // someone else. We can't express this in a single groupBy (watermark
    // is per-request), so batch via one raw query.
    prisma.$queryRaw<Array<{ help_request_id: string; unread: bigint }>>`
      SELECT m.help_request_id, COUNT(*)::bigint AS unread
      FROM help_messages m
      LEFT JOIN help_message_reads r
        ON r.help_request_id = m.help_request_id AND r.user_id = ${userId}
      WHERE m.help_request_id = ANY(${ids}::text[])
        AND m.deleted_at IS NULL
        AND m.author_id <> ${userId}
        AND m.created_at > COALESCE(r.last_read_at, '1970-01-01'::timestamp)
      GROUP BY m.help_request_id
    `,
  ]);

  const statusByReq = new Map(myResponses.map((r) => [r.helpRequestId, r.status]));
  const myUpdatedByReq = new Map(myResponses.map((r) => [r.helpRequestId, r.updatedAt]));
  void reads; // kept for future derivations; unread computation uses raw query
  const lastMsgByReq = new Map(
    lastMessages.map((m) => [m.helpRequestId, m._max.createdAt]),
  );
  const unreadByReq = new Map(
    unreadCounts.map((u) => [u.help_request_id, Number(u.unread)]),
  );

  return rows.map((r) => ({
    ...r,
    myResponseStatus: statusByReq.get(r.id) ?? null,
    // Timestamp of the caller's response's last state change. Drives the
    // age indicator on the card (amber at 2h, red at 6h) and the
    // forthcoming auto-stale reaper in Phase 3.
    myResponseUpdatedAt: myUpdatedByReq.get(r.id)?.toISOString() ?? null,
    unreadMessages: unreadByReq.get(r.id) ?? 0,
    lastMessageAt: lastMsgByReq.get(r.id)?.toISOString() ?? null,
  }));
}

// Derive a HelpRequest.status from the responses list. The DB column is still
// maintained for backwards compat and list filters, but the canonical
// "what's happening" signal comes from responses[].
function deriveRequestStatus(
  current: string,
  responses: Array<{ status: string }>,
): string {
  // Author cancellation is terminal — don't auto-revert it.
  if (current === "cancelled" || current === "completed") return current;
  if (responses.length === 0) return "open";
  const active = responses.filter((r) => r.status !== "cancelled");
  if (active.length === 0) return "open";
  if (active.some((r) => r.status === "helped")) return "completed";
  if (active.some((r) => r.status === "on_way" || r.status === "arrived")) return "in_progress";
  return "claimed";
}

router.get(
  "/",
  optionalAuth,
  validateQuery(HelpRequestQuerySchema),
  async (req, res, next) => {
    try {
      const q = (req as unknown as { parsedQuery: Record<string, unknown> }).parsedQuery as {
        page: number; limit: number; type?: string; category?: string;
        status?: string; activeOnly?: boolean;
        urgency?: string; source?: string;
        sort: string; order: string;
        lat?: number; lng?: number; radius?: number;
        north?: number; south?: number; east?: number; west?: number;
      };

      const where: Prisma.HelpRequestWhereInput = { deletedAt: null };

      if (q.type) where.type = q.type as never;
      if (q.category) where.category = q.category as never;
      if (q.status) {
        // Explicit single-status filter still wins when provided — callers
        // who want strictly "open" (or any other single value) can opt in.
        where.status = q.status as never;
      } else if (q.activeOnly) {
        // The normal list view: show work that's still in flight. Keeps the
        // author's own request visible after a responder claims it.
        where.status = { notIn: ["completed", "cancelled"] } as never;
      }
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
            author: { select: { id: true, name: true, role: true, phone: true } },
            claimer: { select: { id: true, name: true, role: true, phone: true } },
            responses: {
              where: { status: { not: "cancelled" } },
              orderBy: { createdAt: "asc" },
              include: { user: { select: { id: true, name: true, role: true, phone: true } } },
            },
          },
        }),
        prisma.helpRequest.count({ where }),
      ]);

      const caller = getCaller(req as never);
      const filtered = items.map((row) =>
        filterPhones(row as unknown as HelpRequestWithParties, caller)
      );

      await attachResponderStats(filtered as never);

      // Per-caller helpers so the PWA can surface "Мои отклики" + unread
      // badges without a second round-trip. Only fetched when there's an
      // authenticated caller (anonymous lists have no "me").
      const enriched = caller
        ? await attachCallerActivity(filtered as unknown as Array<{ id: string }>, caller.sub)
        : filtered;

      res.json({
        success: true,
        data: enriched,
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
      const clientIp = getRealIp(req);

      // Duplicate detection comes FIRST, before any rate-limit charge.
      // Why: the rate limiter is meant to prevent fresh-SOS spam, not
      // to block a legitimate author from re-opening the post-send
      // screen on their own active signal. If we consumed a rate-limit
      // token here and then returned the existing row, the second tap
      // after "Готово" would 429 and the author would see a bogus
      // "Ошибка отправки" when nothing is actually wrong.
      //
      // Auth path: any active SOS by this user.
      // Anon path: IP + coords match within 30 min (findExistingAnonymousSOS).
      // Either returns the existing row + a fresh updateToken so the
      // follow-up form is reachable.
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
          const token = await issueSosUpdateToken(existing.id);
          res.status(200).json({ success: true, data: { ...existing, updateToken: token, existing: true } });
          return;
        }
      } else {
        const existingAnon = await findExistingAnonymousSOS(clientIp, lat, lng);
        if (existingAnon) {
          const full = await prisma.helpRequest.findFirst({
            where: { id: existingAnon.id, deletedAt: null },
            include: {
              author: { select: { id: true, name: true, role: true } },
              claimer: { select: { id: true, name: true, role: true } },
            },
          });
          if (full) {
            const token = await issueSosUpdateToken(full.id);
            res.status(200).json({ success: true, data: { ...full, updateToken: token, existing: true } });
            return;
          }
        }
      }

      // Rate-limit applies to anonymous callers only. Authenticated
      // users are accountable via their userId (the dedup branch above
      // already catches their re-presses). The rate-limiter was
      // blocking a logged-in user from retrying after they cancelled
      // their own test SOS — the cap wasn't the right tool for that.
      if (!req.user?.sub) {
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
      helpRequestsCreatedTotal.inc({ source: hr.source, type: "sos" });

      // Issue an update token so the author can follow up with a text
      // description or voice memo. The token is the only auth that
      // anonymous SOS authors have (they have no JWT); logged-in
      // authors can use JWT instead but we return the token for them
      // too so the client can use a single code path.
      const updateToken = await issueSosUpdateToken(hr.id);

      res.status(201).json({ success: true, data: { ...hr, updateToken } });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PATCH /help-requests/sos/:id/follow-up
 *
 * Attaches a typed description and/or a recorded voice memo to an SOS
 * that was already fired. Authorization is EITHER a valid JWT whose
 * subject is the SOS's author, OR an `updateToken` that the server
 * returned at SOS creation (1-hour TTL in Redis, single request body
 * ties it to exactly one SOS id). Anonymous SOS callers only have the
 * token — there's no user row they could authenticate as.
 *
 * Body fields (all optional, independent): description, audioUrl.
 */
router.patch(
  "/sos/:id/follow-up",
  optionalAuth,
  validateBody(SOSFollowUpSchema),
  async (req, res, next) => {
    try {
      const id = paramId(req);
      const { updateToken, description, audioUrl, address, contactPhone, contactName, cancel } = req.body as {
        updateToken?: string;
        description?: string;
        audioUrl?: string | null;
        address?: string;
        contactPhone?: string;
        contactName?: string;
        cancel?: boolean;
      };

      const hr = await prisma.helpRequest.findFirst({
        where: { id, deletedAt: null, isSOS: true },
      });
      if (!hr) {
        throw new AppError(404, "NOT_FOUND", "SOS не найден");
      }

      // Two valid auth paths. Either is enough, but the token path is
      // the one anonymous authors use — so we check it first to avoid
      // a needless JWT round-trip check for them.
      let authorized = false;
      if (updateToken) {
        const redis = getRedis();
        if (redis) {
          const owningId = await redis.get(`sos_update:${updateToken}`);
          if (owningId === id) authorized = true;
        }
      }
      if (!authorized && req.user?.sub && hr.userId === req.user.sub) {
        authorized = true;
      }
      if (!authorized) {
        throw new AppError(403, "FORBIDDEN", "Нет прав на обновление этого SOS");
      }

      const data: Prisma.HelpRequestUpdateInput = {};
      if (description !== undefined) {
        // Keep the "SOS" prefix + newline separator so volunteers
        // scanning the list still see the emergency framing first.
        const trimmed = description.trim();
        data.description = trimmed ? `SOS — ${trimmed}` : "SOS";
      }
      if (audioUrl !== undefined) {
        data.audioUrl = audioUrl;
      }
      if (address !== undefined) {
        const trimmed = address.trim();
        data.address = trimmed || null;
      }
      if (contactPhone !== undefined) {
        data.contactPhone = contactPhone || null;
      }
      if (contactName !== undefined) {
        const trimmed = contactName.trim();
        data.contactName = trimmed || null;
      }
      if (cancel === true) {
        // Author-initiated retraction (e.g. accidental press, test).
        // Flip status to cancelled so volunteers stop seeing it; also
        // cascade-cancel any responders who already claimed, matching
        // PATCH /:id's behavior for coherent derived-status.
        if (hr.status !== "cancelled" && hr.status !== "completed") {
          data.status = "cancelled";
          await prisma.helpResponse.updateMany({
            where: { helpRequestId: id, status: { not: "cancelled" } },
            data: { status: "cancelled" },
          });
        }
        // Free the per-IP rate-limit token so the author can
        // immediately retry if the first SOS was a test — the 5-min
        // cap is there to block spam, not to punish a legitimate
        // "this was an accident, let me send the real one" retry.
        if (hr.sourceIp) {
          await clearSosRateLimit(hr.sourceIp);
        }
      }

      if (Object.keys(data).length === 0) {
        res.json({ success: true, data: hr });
        return;
      }

      data.version = { increment: 1 };

      const updated = await prisma.helpRequest.update({
        where: { id, version: hr.version },
        data,
        include: {
          author: { select: { id: true, name: true, role: true } },
          claimer: { select: { id: true, name: true, role: true } },
        },
      });

      emitHelpRequestUpdated(updated as unknown as HelpRequest);
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  }
);

router.get("/:id", optionalAuth, async (req, res, next) => {
  try {
    const id = paramId(req);
    const hr = await prisma.helpRequest.findFirst({
      where: { id, deletedAt: null },
      include: {
        author: { select: { id: true, name: true, role: true, phone: true } },
        claimer: { select: { id: true, name: true, role: true, phone: true } },
        incident: true,
        responses: {
          where: { status: { not: "cancelled" } },
          orderBy: { createdAt: "asc" },
          include: { user: { select: { id: true, name: true, role: true, phone: true } } },
        },
      },
    });

    if (!hr) {
      throw new AppError(404, "NOT_FOUND", "Запрос помощи не найден");
    }

    const caller = getCaller(req as never);
    const filtered = filterPhones(hr as unknown as HelpRequestWithParties, caller);
    await attachResponderStats([filtered as never]);
    const enriched = caller
      ? (await attachCallerActivity([filtered as unknown as { id: string }], caller.sub))[0]
      : filtered;
    res.json({ success: true, data: enriched });
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

      // Attachment ownership: same rule as incidents — authenticated
      // callers must own their photos, anonymous callers must reference
      // anonymous uploads. Blocks cross-user photo theft at create time.
      await assertOwnedUploads((photoUrls ?? []) as string[], req.user?.sub ?? null);

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
          author: { select: { id: true, name: true, role: true, phone: true } },
          claimer: { select: { id: true, name: true, role: true, phone: true } },
        },
      });

      const broadcast = filterPhones(
        { ...(hr as unknown as HelpRequestWithParties) },
        null,
      ) as unknown as HelpRequest;
      emitHelpRequestCreated(broadcast);
      helpRequestsCreatedTotal.inc({ source: hr.source, type: hr.type });

      const caller = getCaller(req as never);
      const filtered = filterPhones(hr as unknown as HelpRequestWithParties, caller);
      res.status(201).json({ success: true, data: filtered });
    } catch (err) {
      next(err);
    }
  }
);

// ── Multi-responder endpoints ───────────────────────────────────────────
// Refresh the DB-backed request.status + denormalised claimedBy fields after
// any response change, so list-view filters / legacy consumers stay coherent.
async function recomputeRequestStatus(requestId: string): Promise<{
  derivedStatus: HelpRequestStatus;
  responseCount: number;
}> {
  const hr = await prisma.helpRequest.findUnique({
    where: { id: requestId },
    include: {
      responses: {
        where: { status: { not: "cancelled" } },
        orderBy: { createdAt: "asc" },
        select: { status: true, userId: true },
      },
    },
  });
  if (!hr) return { derivedStatus: "open", responseCount: 0 };

  const derived = deriveRequestStatus(hr.status, hr.responses) as HelpRequestStatus;
  // claimedBy: the first non-cancelled responder, or null if none.
  const primary = hr.responses[0]?.userId ?? null;

  const needsStatusUpdate = derived !== hr.status;
  const needsClaimerUpdate = primary !== hr.claimedBy;
  if (needsStatusUpdate || needsClaimerUpdate) {
    await prisma.helpRequest.update({
      where: { id: requestId },
      data: {
        ...(needsStatusUpdate ? { status: derived } : {}),
        ...(needsClaimerUpdate ? { claimedBy: primary } : {}),
      },
    });
  }

  return { derivedStatus: derived, responseCount: hr.responses.length };
}

async function emitResponseChanged(
  requestId: string,
  response: { id: string; status: HelpResponseStatus; user: { id: string; name: string | null; role: string } },
): Promise<void> {
  const { derivedStatus, responseCount } = await recomputeRequestStatus(requestId);
  const partyUser: HelpRequestParty = {
    id: response.user.id,
    name: response.user.name,
    role: response.user.role,
  };
  emitHelpResponseChanged({
    helpRequestId: requestId,
    responseId: response.id,
    status: response.status,
    user: partyUser,
    responseCount,
    derivedStatus,
  });
}

// POST /:id/respond — create a new response for the caller. Idempotent-ish:
// if one exists in "cancelled", reset it back to "responded"; if an active
// response already exists, return 409.
router.post(
  "/:id/respond",
  requireAuth,
  validateBody(CreateHelpResponseSchema),
  async (req, res, next) => {
    try {
      const id = paramId(req);
      // Any authenticated user can respond. The old "only volunteers" gate
      // treated role as a static identity (chosen at signup with no context)
      // — in practice, the same person needs help one day and offers help
      // the next. Trust now comes from action history (stats / achievements
      // surfaced on the profile), not a self-declared role at signup.
      const existing = await prisma.helpRequest.findFirst({
        where: { id, deletedAt: null },
      });
      if (!existing) throw new AppError(404, "NOT_FOUND", "Запрос помощи не найден");

      if (existing.userId === req.user!.sub) {
        throw new AppError(400, "SELF_RESPONSE", "Нельзя откликнуться на свой запрос");
      }
      if (existing.status === "cancelled" || existing.status === "completed") {
        throw new AppError(
          422,
          "INVALID_STATE",
          "Запрос закрыт — на него больше нельзя откликнуться",
        );
      }

      // Participant cap: hard-limit 10 active responders per help
      // request to keep the hub chat usable. Re-activating a
      // previously-cancelled response doesn't count (caller is
      // already "in"). Coordinators and admins bypass the cap — they
      // operate in a privileged capacity, not as another responder.
      const isPrivileged = req.user!.role === "coordinator" || req.user!.role === "admin";
      if (!isPrivileged) {
        const mine = await prisma.helpResponse.findUnique({
          where: { helpRequestId_userId: { helpRequestId: id, userId: req.user!.sub } },
          select: { status: true },
        });
        const isReactivating = mine && mine.status === "cancelled";
        if (!isReactivating) {
          const activeCount = await prisma.helpResponse.count({
            where: { helpRequestId: id, status: { not: "cancelled" } },
          });
          if (activeCount >= 10) {
            throw new AppError(
              409,
              "RESPONDER_CAP_REACHED",
              "На эту заявку уже откликнулось максимальное число участников. Попробуйте связаться с автором напрямую.",
            );
          }
        }
      }

      // Upsert: re-activate a previously cancelled response instead of 409'ing.
      const response = await prisma.helpResponse.upsert({
        where: {
          helpRequestId_userId: { helpRequestId: id, userId: req.user!.sub },
        },
        update: { status: "responded", note: req.body.note ?? null },
        create: {
          helpRequestId: id,
          userId: req.user!.sub,
          status: "responded",
          note: req.body.note ?? null,
        },
        include: { user: { select: { id: true, name: true, role: true, phone: true } } },
      });

      await emitResponseChanged(id, response);

      // Return the full request so the client can drop it straight into state.
      const updated = await prisma.helpRequest.findFirst({
        where: { id, deletedAt: null },
        include: {
          author: { select: { id: true, name: true, role: true, phone: true } },
          claimer: { select: { id: true, name: true, role: true, phone: true } },
          responses: {
            where: { status: { not: "cancelled" } },
            orderBy: { createdAt: "asc" },
            include: { user: { select: { id: true, name: true, role: true, phone: true } } },
          },
        },
      });
      const caller = getCaller(req as never);
      const filtered = filterPhones(updated as unknown as HelpRequestWithParties, caller);
      await attachResponderStats([filtered as never]);
      // Same enrichment as the list/detail endpoints so the client's state
      // swap includes myResponseStatus and unreadMessages — otherwise the
      // just-claimed card won't pass the "Мои отклики" filter until the
      // next full page fetch.
      const enriched = caller
        ? (await attachCallerActivity(
            [filtered as unknown as { id: string }],
            caller.sub,
          ))[0]
        : filtered;
      res.status(201).json({ success: true, data: enriched });
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /:id/my-response — update the caller's response status or note.
router.patch(
  "/:id/my-response",
  requireAuth,
  validateBody(UpdateMyHelpResponseSchema),
  async (req, res, next) => {
    try {
      const id = paramId(req);
      const mine = await prisma.helpResponse.findUnique({
        where: { helpRequestId_userId: { helpRequestId: id, userId: req.user!.sub } },
      });
      if (!mine) {
        throw new AppError(404, "NO_RESPONSE", "Вы ещё не откликнулись на этот запрос");
      }

      const { status, note } = req.body as {
        status: HelpResponseStatus;
        note?: string | null;
      };
      const updated = await prisma.helpResponse.update({
        where: { id: mine.id },
        data: { status, ...(note !== undefined ? { note } : {}) },
        include: { user: { select: { id: true, name: true, role: true, phone: true } } },
      });

      // If the caller just cancelled themselves out of the thread, kick
      // their sockets out of the chat room so they stop receiving new
      // messages in realtime. Historical messages stay in their client
      // cache — that's the documented behavior.
      if (status === "cancelled") {
        await evictUserFromHelpRoom(req.user!.sub, id);
      }

      await emitResponseChanged(id, updated);

      // Return the full request for easy client-side state swap.
      const hr = await prisma.helpRequest.findFirst({
        where: { id, deletedAt: null },
        include: {
          author: { select: { id: true, name: true, role: true, phone: true } },
          claimer: { select: { id: true, name: true, role: true, phone: true } },
          responses: {
            where: { status: { not: "cancelled" } },
            orderBy: { createdAt: "asc" },
            include: { user: { select: { id: true, name: true, role: true, phone: true } } },
          },
        },
      });
      const caller = getCaller(req as never);
      const filtered = filterPhones(hr as unknown as HelpRequestWithParties, caller);
      await attachResponderStats([filtered as never]);
      const enriched = caller
        ? (await attachCallerActivity(
            [filtered as unknown as { id: string }],
            caller.sub,
          ))[0]
        : filtered;
      res.json({ success: true, data: enriched });
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /:id/my-response — cancel the caller's own response (soft).
router.delete("/:id/my-response", requireAuth, async (req, res, next) => {
  try {
    const id = paramId(req);
    const mine = await prisma.helpResponse.findUnique({
      where: { helpRequestId_userId: { helpRequestId: id, userId: req.user!.sub } },
    });
    if (!mine) {
      throw new AppError(404, "NO_RESPONSE", "Вы ещё не откликнулись на этот запрос");
    }

    const updated = await prisma.helpResponse.update({
      where: { id: mine.id },
      data: { status: "cancelled" },
      include: { user: { select: { id: true, name: true, role: true, phone: true } } },
    });

    await evictUserFromHelpRoom(req.user!.sub, id);
    await emitResponseChanged(id, updated);
    res.json({ success: true, data: { id: mine.id, cancelled: true } });
  } catch (err) {
    next(err);
  }
});

// ── In-app messaging ─────────────────────────────────────────────────────
// Participants: request author, any non-cancelled responder, and
// coordinator/admin. Access rule lives in lib/helpAccess.ts — shared with
// the Socket.IO subscribe handler so room access and HTTP access can't
// drift out of sync.
const assertCanAccessMessages = assertHelpChatAccess;

// GET /:id/messages — paginated history (newest first via cursor).
// Soft-deleted messages are still returned so the UI can render a
// "[Сообщение удалено]" placeholder in the right spot — but their
// body and photoUrls are stripped server-side so the content can't be
// recovered by a chat participant. Admins inspect full deleted content
// through the moderation queue, not through this endpoint.
router.get("/:id/messages", requireAuth, async (req, res, next) => {
  try {
    const id = paramId(req);
    await assertCanAccessMessages(id, req.user!);

    const limit = Math.min(Math.max(parseInt(String(req.query.limit)) || 50, 1), 100);
    const before = req.query.before ? new Date(String(req.query.before)) : null;

    // Responders see history from their response time onward — late-
    // join privacy. Author and coord/admin get null (full history).
    const joinedAt = await getHelpChatJoinTime(id, req.user!);

    // Build the createdAt filter in one object — two separate
    // `...(cond ? {createdAt: ...} : {})` spreads on the same key
    // would clobber each other.
    const createdAtFilter: { gte?: Date; lt?: Date } = {};
    if (joinedAt) createdAtFilter.gte = joinedAt;
    if (before) createdAtFilter.lt = before;

    const messages = await prisma.helpMessage.findMany({
      where: {
        helpRequestId: id,
        ...(Object.keys(createdAtFilter).length > 0 ? { createdAt: createdAtFilter } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        author: { select: { id: true, name: true, role: true } },
      },
    });

    const safeMessages = messages.map((m) =>
      m.deletedAt ? { ...m, body: "", photoUrls: [] } : m,
    );

    // Unread count: anything newer than max(my last-read watermark,
    // my join time). Deleted messages don't contribute — once content
    // is gone there's nothing to read.
    const read = await prisma.helpMessageRead.findUnique({
      where: { helpRequestId_userId: { helpRequestId: id, userId: req.user!.sub } },
      select: { lastReadAt: true },
    });
    const watermark = read?.lastReadAt ?? new Date(0);
    const unreadCutoff = joinedAt && joinedAt > watermark ? joinedAt : watermark;
    const unread = await prisma.helpMessage.count({
      where: {
        helpRequestId: id,
        deletedAt: null,
        authorId: { not: req.user!.sub },
        createdAt: { gt: unreadCutoff },
      },
    });

    // Oldest-first for UI rendering. `joinedAt` in meta tells the
    // client whether to render a "Предыдущие сообщения скрыты" marker
    // at the top of the timeline.
    res.json({
      success: true,
      data: safeMessages.reverse(),
      meta: {
        unread,
        lastReadAt: watermark.toISOString(),
        joinedAt: joinedAt?.toISOString() ?? null,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /:id/messages — send a message to the thread.
router.post(
  "/:id/messages",
  requireAuth,
  messagesRateLimiter,
  validateBody(CreateHelpMessageSchema),
  async (req, res, next) => {
    try {
      const id = paramId(req);
      await assertCanAccessMessages(id, req.user!);

      const photoUrls: string[] = req.body.photoUrls ?? [];
      await assertOwnedUploads(photoUrls, req.user!.sub);

      const message = await prisma.helpMessage.create({
        data: {
          helpRequestId: id,
          authorId: req.user!.sub,
          body: req.body.body,
          photoUrls,
        },
        include: { author: { select: { id: true, name: true, role: true } } },
      });

      // Author's own last-read moves forward to this message automatically —
      // otherwise they'd see their own message as "unread".
      await prisma.helpMessageRead.upsert({
        where: { helpRequestId_userId: { helpRequestId: id, userId: req.user!.sub } },
        update: { lastReadAt: message.createdAt },
        create: { helpRequestId: id, userId: req.user!.sub, lastReadAt: message.createdAt },
      });

      const participantIds = await resolveMessageParticipants(id);
      emitHelpMessageCreated(message as unknown as HelpMessage, participantIds);
      res.status(201).json({ success: true, data: message });
    } catch (err) {
      next(err);
    }
  },
);

// POST /:id/messages/:msgId/report — flag a message for coordinator review.
// Rule: reporter must be a chat participant AND cannot report their own
// message. Duplicate submissions from the same (message, reporter)
// upsert (update reason/details) rather than create a 2nd row.
router.post(
  "/:id/messages/:msgId/report",
  requireAuth,
  reportsRateLimiter,
  validateBody(CreateHelpMessageReportSchema),
  async (req, res, next) => {
    try {
      const id = paramId(req);
      await assertCanAccessMessages(id, req.user!);
      const msgId = String(req.params.msgId || "").trim();
      if (!msgId || msgId.length > 64) {
        throw new AppError(400, "INVALID_ID", "Некорректный идентификатор сообщения");
      }
      const message = await prisma.helpMessage.findFirst({
        where: { id: msgId, helpRequestId: id },
        select: { id: true, authorId: true },
      });
      if (!message) throw new AppError(404, "NOT_FOUND", "Сообщение не найдено");
      if (message.authorId === req.user!.sub) {
        throw new AppError(
          400,
          "CANNOT_REPORT_OWN",
          "Нельзя жаловаться на собственное сообщение",
        );
      }
      const { reason, details } = req.body as {
        reason: "abuse" | "spam" | "doxxing" | "off_topic" | "other";
        details?: string;
      };
      const report = await prisma.helpMessageReport.upsert({
        where: {
          messageId_reporterId: {
            messageId: msgId,
            reporterId: req.user!.sub,
          },
        },
        update: {
          reason,
          details: details ?? null,
          // If the same user revisits after a prior resolution,
          // re-open the report — the coordinator should see the new
          // submission, not a stale "resolved" row.
          status: "open",
          resolvedBy: null,
          resolvedAt: null,
        },
        create: {
          messageId: msgId,
          reporterId: req.user!.sub,
          reason,
          details: details ?? null,
        },
      });
      res.status(201).json({ success: true, data: { id: report.id, status: report.status } });
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /:id/messages/:msgId — coordinator/admin soft-delete a message.
// Atomically resolves every open report on the message as
// resolved_delete so the queue doesn't show stale entries. Emits
// help_message:deleted to the chat room so participants' UIs swap to
// the placeholder without a refresh.
router.delete(
  "/:id/messages/:msgId",
  requireAuth,
  requireRole("coordinator", "admin"),
  async (req, res, next) => {
    try {
      const id = paramId(req);
      const msgId = String(req.params.msgId || "").trim();
      if (!msgId || msgId.length > 64) {
        throw new AppError(400, "INVALID_ID", "Некорректный идентификатор сообщения");
      }
      const existing = await prisma.helpMessage.findFirst({
        where: { id: msgId, helpRequestId: id },
        select: { id: true, deletedAt: true },
      });
      if (!existing) throw new AppError(404, "NOT_FOUND", "Сообщение не найдено");
      if (existing.deletedAt) {
        // Idempotent — already deleted.
        res.json({ success: true, data: { id: msgId, deleted: true } });
        return;
      }
      const now = new Date();
      await prisma.$transaction([
        prisma.helpMessage.update({
          where: { id: msgId },
          data: {
            deletedAt: now,
            deletedBy: req.user!.sub,
            deletedReason: "moderator_removed",
          },
        }),
        prisma.helpMessageReport.updateMany({
          where: { messageId: msgId, status: "open" },
          data: {
            status: "resolved_delete",
            resolvedBy: req.user!.sub,
            resolvedAt: now,
          },
        }),
      ]);
      emitHelpMessageDeleted(id, msgId);
      auditLog({
        action: "delete_help_message",
        actorId: req.user!.sub,
        targetId: msgId,
        meta: { helpRequestId: id },
      });
      res.json({ success: true, data: { id: msgId, deleted: true } });
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /:id/participants/:userId — author or coordinator removes a
// responder from the chat. Reuses the existing "cancelled" response
// flow (same downstream effects as self-cancel), plus evicts the
// removed user's sockets from the room.
router.delete(
  "/:id/participants/:userId",
  requireAuth,
  async (req, res, next) => {
    try {
      const id = paramId(req);
      const targetUserId = String(req.params.userId || "").trim();
      if (!targetUserId || targetUserId.length > 64) {
        throw new AppError(400, "INVALID_ID", "Некорректный идентификатор пользователя");
      }
      const hr = await prisma.helpRequest.findFirst({
        where: { id, deletedAt: null },
        select: { userId: true },
      });
      if (!hr) throw new AppError(404, "NOT_FOUND", "Запрос помощи не найден");
      const isAuthor = hr.userId === req.user!.sub;
      const isStaff = req.user!.role === "coordinator" || req.user!.role === "admin";
      if (!isAuthor && !isStaff) {
        throw new AppError(
          403,
          "FORBIDDEN",
          "Удалять участников может только автор запроса или модератор",
        );
      }
      if (targetUserId === hr.userId) {
        throw new AppError(
          400,
          "CANNOT_REMOVE_AUTHOR",
          "Автор запроса не может быть удалён из обсуждения",
        );
      }
      const resp = await prisma.helpResponse.findFirst({
        where: { helpRequestId: id, userId: targetUserId, status: { not: "cancelled" } },
        include: { user: { select: { id: true, name: true, role: true, phone: true } } },
      });
      if (!resp) {
        throw new AppError(404, "NOT_FOUND", "У пользователя нет активного отклика");
      }
      const updated = await prisma.helpResponse.update({
        where: { id: resp.id },
        data: { status: "cancelled" },
        include: { user: { select: { id: true, name: true, role: true, phone: true } } },
      });
      await evictUserFromHelpRoom(targetUserId, id);
      await emitResponseChanged(id, updated);
      auditLog({
        action: "remove_help_participant",
        actorId: req.user!.sub,
        targetId: targetUserId,
        meta: { helpRequestId: id },
      });
      res.json({ success: true, data: { userId: targetUserId, removed: true } });
    } catch (err) {
      next(err);
    }
  },
);

/** Authoritative participant list for a help-request chat: the request
 * author plus every non-cancelled responder. Mirrors the HTTP access
 * rule in assertCanAccessMessages. Coordinator/admin are excluded from
 * notify fan-out — they opt in by subscribing to the room. */
async function resolveMessageParticipants(helpRequestId: string): Promise<string[]> {
  const [hr, responders] = await Promise.all([
    prisma.helpRequest.findFirst({
      where: { id: helpRequestId, deletedAt: null },
      select: { userId: true },
    }),
    prisma.helpResponse.findMany({
      where: { helpRequestId, status: { not: "cancelled" } },
      select: { userId: true },
    }),
  ]);
  const ids = new Set<string>();
  if (hr?.userId) ids.add(hr.userId);
  for (const r of responders) ids.add(r.userId);
  return Array.from(ids);
}

// POST /:id/messages/read — advance the caller's last-read watermark to now.
router.post("/:id/messages/read", requireAuth, async (req, res, next) => {
  try {
    const id = paramId(req);
    await assertCanAccessMessages(id, req.user!);

    const now = new Date();
    await prisma.helpMessageRead.upsert({
      where: { helpRequestId_userId: { helpRequestId: id, userId: req.user!.sub } },
      update: { lastReadAt: now },
      create: { helpRequestId: id, userId: req.user!.sub, lastReadAt: now },
    });

    res.json({ success: true, data: { lastReadAt: now.toISOString() } });
  } catch (err) {
    next(err);
  }
});

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

      // Edits are restricted to the author or coordinators/admins. Responders
      // manage their own progress via POST /:id/respond + PATCH /:id/my-response
      // rather than writing to the request row directly.
      const isOwner = existing.userId && existing.userId === req.user!.sub;
      const isPrivileged = req.user!.role === "coordinator" || req.user!.role === "admin";
      if (!isOwner && !isPrivileged) {
        // Pre-response-API clients used to claim via PATCH { status: "claimed" }.
        // Point them to the new endpoint rather than silently rejecting.
        if (req.body.status === "claimed") {
          throw new AppError(
            400,
            "USE_RESPOND_ENDPOINT",
            "Откликаться нужно через POST /help-requests/:id/respond",
          );
        }
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
      if (req.body.photoUrls !== undefined) {
        await assertOwnedNewUploads(
          req.body.photoUrls as string[],
          existing.photoUrls,
          req.user!.sub,
        );
        data.photoUrls = req.body.photoUrls;
      }

      let cancelledResponderIds: string[] = [];
      if (newStatus !== undefined) {
        data.status = newStatus;
        // Author / admin can force-close: mark all active responses
        // "cancelled" so the derived-status logic stays coherent next time.
        if (newStatus === "cancelled" || newStatus === "completed") {
          // Capture affected responders before updating so we can evict
          // them from the socket room. "completed" flips responses to
          // "helped" (they're kept as participants for chat follow-up);
          // "cancelled" is the only branch that removes participation.
          if (newStatus === "cancelled") {
            const active = await prisma.helpResponse.findMany({
              where: { helpRequestId: id, status: { not: "cancelled" } },
              select: { userId: true },
            });
            cancelledResponderIds = active.map((r) => r.userId);
          }
          await prisma.helpResponse.updateMany({
            where: { helpRequestId: id, status: { not: "cancelled" } },
            data: { status: newStatus === "completed" ? "helped" : "cancelled" },
          });
        }
      }
      data.version = { increment: 1 };

      let updated;
      try {
        updated = await prisma.helpRequest.update({
          where: { id, version: existing.version },
          data,
          include: {
            author: { select: { id: true, name: true, role: true, phone: true } },
            claimer: { select: { id: true, name: true, role: true, phone: true } },
          },
        });
      } catch (err: unknown) {
        if (err instanceof Error && "code" in err && (err as { code: string }).code === "P2025") {
          throw new AppError(409, "CONFLICT", "Запись была изменена другим пользователем. Обновите страницу.");
        }
        throw err;
      }

      // Evict any responders who were just force-cancelled from the
      // socket chat room — they lose realtime access going forward,
      // matching the HTTP participant-check rule. Historical messages
      // in their client cache stay (by design).
      if (cancelledResponderIds.length > 0) {
        await Promise.all(
          cancelledResponderIds.map((uid) => evictUserFromHelpRoom(uid, id)),
        );
      }

      // Socket broadcast goes to every connected client — strip phones before
      // emitting so the public event never carries account-phone numbers.
      // Each party re-fetches the REST detail to get their allowed phones.
      const broadcast = filterPhones(
        { ...(updated as unknown as HelpRequestWithParties) },
        null,
      ) as unknown as HelpRequest;
      emitHelpRequestUpdated(broadcast);

      const caller = getCaller(req as never);
      const filtered = filterPhones(updated as unknown as HelpRequestWithParties, caller);
      const enriched = caller
        ? (await attachCallerActivity(
            [filtered as unknown as { id: string }],
            caller.sub,
          ))[0]
        : filtered;
      res.json({ success: true, data: enriched });
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
        data: { deletedAt: new Date(), deletedBy: req.user!.sub },
      });

      clearHelpRoom(id);
      auditLog({ action: "delete_help_request", actorId: req.user!.sub, targetId: id });

      res.json({ success: true, data: { id, deleted: true } });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
