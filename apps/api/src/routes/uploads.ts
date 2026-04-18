// SPDX-License-Identifier: AGPL-3.0-only
import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import multer from "multer";
import crypto from "crypto";
import sharp from "sharp";
import { prisma } from "@samur/db";
import { AppError } from "../middleware/error.js";
import { optionalAuth } from "../middleware/auth.js";
import { uploadsRateLimiter } from "../middleware/rateLimiter.js";
import { logger } from "../lib/logger.js";
import {
  writeBlob,
  deleteBlob,
  getPublicUrl,
  isRemoteStorageEnabled,
} from "../lib/storage.js";

const router = Router();

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_FILES = 5;

/** Sharp's alpine prebuilt historically ships without HEIC decode
 * (HEVC is patent-encumbered and the upstream linuxmusl prebuilt strips
 * it on some versions). Probe at module load and drop heic/heif from
 * the accepted MIME list if decode isn't available — otherwise iPhone
 * users get a generic 400 when the pipeline throws. */
const HEIC_SUPPORTED = sharp.format.heif?.input?.file === true;
const ALLOWED_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  ...(HEIC_SUPPORTED ? ["image/heic", "image/heif"] : []),
];
if (!HEIC_SUPPORTED) {
  logger.warn("sharp HEIC decode unavailable — HEIC uploads will be rejected");
}
const FORMATS_LABEL = HEIC_SUPPORTED
  ? "JPEG, PNG, WebP, HEIC"
  : "JPEG, PNG, WebP";

/** Hard cap on the longest edge after re-encoding. Phone cameras upload
 * 4000+ px; a PWA doesn't need that resolution, and serving it eats
 * bandwidth on the low-connectivity target network. */
const MAX_EDGE_PX = 2560;
/** JPEG/WebP quality for re-encoded output. 85 is the visual break-even
 * — indistinguishable from source on a phone screen, 60-80% smaller. */
const REENCODE_QUALITY = 85;

/** Memory storage (not disk) so we control the write ourselves — every
 * byte that leaves this process has already passed through sharp, which
 * strips EXIF, ICC profile, XMP, and any other metadata. Holding up to
 * 5 × 5 MB in memory per request is bounded by MAX_FILE_SIZE × MAX_FILES
 * and the uploadsRateLimiter ceiling. */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new AppError(400, "INVALID_FILE_TYPE", `Допустимые форматы: ${FORMATS_LABEL}`) as unknown as Error);
    }
  },
});

/** Re-encode an uploaded image buffer. Drops every piece of metadata
 * (EXIF, GPS, ICC, XMP), applies EXIF-orientation physically before
 * dropping it, caps the longest edge at MAX_EDGE_PX, and picks an
 * output format that every browser renders natively:
 *
 *   JPEG / HEIC / HEIF → JPEG
 *   PNG  → PNG (keeps transparency)
 *   WebP → WebP
 *
 * HEIC is iOS-native but unsupported in Chrome/Firefox desktop — the
 * conversion fixes both EXIF stripping and cross-browser rendering in
 * one step. Returns the extension the caller should persist the file
 * under (matching the photoUrl regex) plus the output content type
 * for storage metadata.
 */
async function reencode(file: Express.Multer.File): Promise<{ buffer: Buffer; ext: string; mime: string }> {
  const input = sharp(file.buffer, { failOn: "none" })
    .rotate()
    .resize({ width: MAX_EDGE_PX, height: MAX_EDGE_PX, fit: "inside", withoutEnlargement: true });

  if (file.mimetype === "image/png") {
    return { buffer: await input.png({ compressionLevel: 9 }).toBuffer(), ext: "png", mime: "image/png" };
  }
  if (file.mimetype === "image/webp") {
    return { buffer: await input.webp({ quality: REENCODE_QUALITY }).toBuffer(), ext: "webp", mime: "image/webp" };
  }
  // JPEG / HEIC / HEIF all normalize to JPEG.
  return { buffer: await input.jpeg({ quality: REENCODE_QUALITY, mozjpeg: true }).toBuffer(), ext: "jpg", mime: "image/jpeg" };
}

/**
 * POST /uploads
 *
 * Upload up to 5 images. Each file is re-encoded via sharp before it
 * leaves this process — EXIF (including GPS), ICC, XMP, and other
 * metadata are dropped; HEIC is converted to JPEG for cross-browser
 * compatibility; oversize images are resampled to the MAX_EDGE_PX cap.
 *
 * Storage backend is chosen by lib/storage.ts based on env: Yandex
 * Object Storage in prod, local filesystem in dev/tests. The returned
 * URLs keep the `/api/v1/uploads/[hex].[ext]` shape regardless — in
 * prod the GET route 302-redirects to the bucket, in dev express.static
 * serves directly.
 *
 * `optionalAuth` (not `requireAuth`) is intentional: anonymous
 * incident reports still need to attach photos before they submit,
 * which is a core crisis-platform flow. The `uploadsRateLimiter` makes
 * up for the lack of authentication by pinning anonymous callers to a
 * tight per-IP hourly cap. Authenticated callers get a higher ceiling
 * since we can hold them to their account.
 */
router.post(
  "/",
  optionalAuth,
  uploadsRateLimiter,
  (req: Request, res: Response, next: NextFunction) => {
    upload.array("photos", MAX_FILES)(req, res, async (err) => {
      if (err) {
        if (err instanceof multer.MulterError) {
          if (err.code === "LIMIT_FILE_SIZE") {
            return next(new AppError(400, "FILE_TOO_LARGE", "Максимальный размер файла: 5 МБ"));
          }
          if (err.code === "LIMIT_FILE_COUNT") {
            return next(new AppError(400, "TOO_MANY_FILES", "Максимум 5 файлов"));
          }
          return next(new AppError(400, "UPLOAD_ERROR", err.message));
        }
        return next(err);
      }

      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        return next(new AppError(400, "NO_FILES", "Файлы не выбраны"));
      }

      // Track what we've already persisted so a mid-loop failure can
      // be rolled back — otherwise a 2nd-file reencode failure leaves
      // the 1st file orphaned in the backend forever (the client
      // never learns the URL, so it's unreachable garbage).
      const written: string[] = [];
      try {
        const urls: string[] = [];
        const filenames: string[] = [];
        for (const file of files) {
          const { buffer, ext, mime } = await reencode(file);
          const hex = crypto.randomBytes(16).toString("hex");
          const filename = `${hex}.${ext}`;
          await writeBlob(filename, buffer, mime);
          written.push(filename);
          filenames.push(filename);
          // getPublicUrl returns /api/v1/uploads/... on local fs and
          // the full Yandex URL in remote mode. We always store the
          // LOCAL shape in photoUrls so the photoUrl regex in the
          // shared schemas keeps passing; the redirect handler flips
          // it to the Yandex URL at serve time.
          urls.push(`/api/v1/uploads/${filename}`);
        }

        // Record each file's uploader so downstream write paths (chat
        // message-send) can verify attachments belong to the sender.
        // Anonymous uploads land with uploaderId=null — those can
        // still be referenced by anonymous-write flows (incident
        // reports) but will fail any requireAuth-scoped ownership
        // check. skipDuplicates guards the vanishingly-unlikely
        // 128-bit random collision, which would otherwise 500 here.
        const uploaderId = req.user?.sub ?? null;
        await prisma.upload.createMany({
          data: filenames.map((f) => ({ filename: f, uploaderId })),
          skipDuplicates: true,
        });

        logger.info(
          { count: files.length, uploaderId, backend: isRemoteStorageEnabled() ? "yandex" : "local" },
          "Files uploaded (re-encoded)",
        );
        res.json({ success: true, data: { urls } });
      } catch (reencodeErr) {
        logger.warn({ err: reencodeErr, orphanCount: written.length }, "Image re-encode failed");
        await Promise.allSettled(written.map((f) => deleteBlob(f)));
        return next(new AppError(400, "INVALID_IMAGE", "Не удалось обработать изображение"));
      }
    });
  },
);

/**
 * GET /uploads/:filename
 *
 * Serve a previously-uploaded blob. In remote mode (Yandex configured),
 * 302-redirects the browser to the public bucket URL — the API node
 * never proxies bytes, which removes this workload from our bandwidth
 * envelope. In local mode, the route is unreachable because
 * express.static claims /api/v1/uploads first in src/index.ts.
 *
 * We validate the filename matches our storage shape before
 * redirecting, so someone passing `..%2F../etc/passwd` can't trick
 * us into emitting a Location header pointing somewhere unintended.
 */
const UPLOAD_FILENAME_RE = /^[a-f0-9]{32}\.(?:jpg|png|webp|heic|heif)$/;

router.get("/:filename", (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!isRemoteStorageEnabled()) {
      // Local mode: express.static would have served this at the
      // app-level mount before we reached this router. Hitting here
      // means the file doesn't exist on disk.
      return next(new AppError(404, "NOT_FOUND", "Файл не найден"));
    }
    const filename = String(req.params.filename || "");
    if (!UPLOAD_FILENAME_RE.test(filename)) {
      return next(new AppError(400, "INVALID_FILENAME", "Некорректное имя файла"));
    }
    const target = getPublicUrl(filename);
    // Small Cache-Control so browsers + CDNs cache the 302 itself for a
    // while — the target URL is static forever per the immutable
    // filename convention, so re-redirecting every request is waste.
    res.set("Cache-Control", "public, max-age=3600");
    res.redirect(302, target);
  } catch (err) {
    next(err);
  }
});

export default router;
