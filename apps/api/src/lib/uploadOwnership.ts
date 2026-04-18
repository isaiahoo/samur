// SPDX-License-Identifier: AGPL-3.0-only
import { prisma } from "@samur/db";
import { AppError } from "../middleware/error.js";

/** Exactly what POST /uploads produces — keep in sync with the regex
 * in `photoUrl` (packages/shared/src/schemas/index.ts). Anchored so
 * a pathological input can't sneak past. */
const UPLOAD_URL_RE = /^\/api\/v1\/uploads\/([a-f0-9]{32}\.(?:jpg|png|webp|heic|heif))$/;

/** Extract just the filename component from a validated photoUrl. */
function filenameFromUrl(url: string): string | null {
  const m = UPLOAD_URL_RE.exec(url);
  return m ? m[1] : null;
}

/** Verify that every URL in `urls` references an upload the given user
 * performed. Fails closed: unknown filenames (no matching Upload row)
 * and filenames owned by someone else both throw 403.
 *
 * Used by authenticated write paths that accept attachment URLs (chat
 * message-send). Not applied to incident/help-request POSTs, which are
 * single-author commit flows where referencing another user's photo
 * URL only harms the attacker's own submission.
 */
export async function assertOwnedUploads(urls: string[], userId: string): Promise<void> {
  if (urls.length === 0) return;
  const filenames: string[] = [];
  for (const u of urls) {
    const f = filenameFromUrl(u);
    if (!f) throw new AppError(400, "INVALID_UPLOAD_URL", "Недопустимый URL фото");
    filenames.push(f);
  }
  const rows = await prisma.upload.findMany({
    where: { filename: { in: filenames } },
    select: { filename: true, uploaderId: true },
  });
  const byName = new Map(rows.map((r) => [r.filename, r.uploaderId] as const));
  for (const f of filenames) {
    const owner = byName.get(f);
    // owner=undefined → no row, owner=null → anonymous upload (not
    // eligible for authenticated attach), owner=someone else → theft.
    if (owner !== userId) {
      throw new AppError(
        403,
        "UPLOAD_NOT_OWNED",
        "Можно прикреплять только собственные фото",
      );
    }
  }
}
