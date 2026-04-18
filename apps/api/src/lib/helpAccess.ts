// SPDX-License-Identifier: AGPL-3.0-only
import { prisma } from "@samur/db";
import { AppError } from "../middleware/error.js";

/** Participant rule for a help-request chat: request author, any non-
 * cancelled responder, or coordinator/admin. This is the single source
 * of truth — both the HTTP message endpoints and the Socket.IO
 * subscribe handler consult it, so room access and HTTP access can't
 * drift. */
export async function isHelpChatParticipant(
  helpRequestId: string,
  user: { id: string; role: string | undefined },
): Promise<boolean> {
  if (user.role === "coordinator" || user.role === "admin") return true;
  const hr = await prisma.helpRequest.findFirst({
    where: { id: helpRequestId, deletedAt: null },
    select: { userId: true },
  });
  if (!hr) return false;
  if (hr.userId === user.id) return true;
  const resp = await prisma.helpResponse.findFirst({
    where: { helpRequestId, userId: user.id, status: { not: "cancelled" } },
    select: { id: true },
  });
  return !!resp;
}

/** HTTP-flavored wrapper: throws the appropriate AppError instead of
 * returning boolean, so route handlers can just `await` it. */
export async function assertHelpChatAccess(
  helpRequestId: string,
  user: { sub: string; role: string },
): Promise<void> {
  if (user.role === "coordinator" || user.role === "admin") return;
  const hr = await prisma.helpRequest.findFirst({
    where: { id: helpRequestId, deletedAt: null },
    select: { userId: true },
  });
  if (!hr) throw new AppError(404, "NOT_FOUND", "Запрос помощи не найден");
  if (hr.userId === user.sub) return;
  const response = await prisma.helpResponse.findFirst({
    where: { helpRequestId, userId: user.sub, status: { not: "cancelled" } },
    select: { id: true },
  });
  if (response) return;
  throw new AppError(
    403,
    "NOT_PARTICIPANT",
    "Обсуждение доступно только автору и откликнувшимся",
  );
}

/** Return the timestamp from which the caller is allowed to see
 * messages in this help-request chat, or null if they get full
 * history. Called AFTER assertHelpChatAccess has passed, so the
 * caller is guaranteed to be a participant.
 *
 * Policy:
 *   - request author → full history (null)
 *   - coordinator / admin → full history (null) — audit needs the
 *     whole thread
 *   - responder → messages from their response.createdAt onward. A
 *     late-joining responder doesn't see earlier private exchanges
 *     between the author and earlier responders; this is the
 *     privacy-safer default for a hub chat.
 *
 * Returns null rather than the Unix epoch so the caller can skip the
 * date filter entirely in the full-history case, which keeps the
 * query plan clean.
 */
export async function getHelpChatJoinTime(
  helpRequestId: string,
  user: { sub: string; role: string },
): Promise<Date | null> {
  if (user.role === "coordinator" || user.role === "admin") return null;
  const hr = await prisma.helpRequest.findFirst({
    where: { id: helpRequestId, deletedAt: null },
    select: { userId: true },
  });
  if (hr?.userId === user.sub) return null;
  const response = await prisma.helpResponse.findFirst({
    where: { helpRequestId, userId: user.sub, status: { not: "cancelled" } },
    select: { createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  return response?.createdAt ?? null;
}
