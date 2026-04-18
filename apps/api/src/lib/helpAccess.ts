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
