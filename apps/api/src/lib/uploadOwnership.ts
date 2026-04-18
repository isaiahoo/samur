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

/** Verify that every URL in `urls` references an upload the given
 * caller performed. Fails closed: unknown filenames (no matching
 * Upload row) and filenames owned by someone else both throw 403.
 *
 * `ownerId` is `string | null`:
 *   - authenticated callers pass req.user!.sub — attachments must be
 *     owned by that user id
 *   - anonymous callers pass null — attachments must be anonymous
 *     uploads (uploaderId IS NULL). A logged-in user can never
 *     attach an anon upload and an anon caller can never attach an
 *     authenticated user's upload.
 *
 * Used by every write path that accepts attachment URLs: chat message
 * send, incident create/update, help-request create/update. Anonymous
 * incident POSTs still work — the null===null case.
 */
export async function assertOwnedUploads(
  urls: string[],
  ownerId: string | null,
): Promise<void> {
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
    // undefined → no row at all; null → anonymous upload; string →
    // authenticated uploader. Strict equality handles all three.
    if (byName.get(f) !== ownerId) {
      throw new AppError(
        403,
        "UPLOAD_NOT_OWNED",
        "Можно прикреплять только собственные фото",
      );
    }
  }
}

/** PATCH-friendly variant: only check URLs that are NOT already on
 * the row being updated. An edit that re-sends the existing
 * photoUrls plus one new one is fine — only the new one is
 * ownership-checked. Lets a coordinator patch someone else's
 * incident without losing the original photos (those were owned by
 * the original author) while still enforcing that any new photos
 * they add were uploaded by them. */
export async function assertOwnedNewUploads(
  nextUrls: string[],
  existingUrls: string[],
  ownerId: string | null,
): Promise<void> {
  const existing = new Set(existingUrls);
  const added = nextUrls.filter((u) => !existing.has(u));
  if (added.length === 0) return;
  await assertOwnedUploads(added, ownerId);
}
