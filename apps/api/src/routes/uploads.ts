// SPDX-License-Identifier: AGPL-3.0-only
import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { AppError } from "../middleware/error.js";
import { optionalAuth } from "../middleware/auth.js";
import { uploadsRateLimiter } from "../middleware/rateLimiter.js";
import { logger } from "../lib/logger.js";

const router = Router();

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_FILES = 5;
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/heic": ".heic",
  "image/heif": ".heif",
};

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = MIME_TO_EXT[file.mimetype] || ".jpg";
    const name = crypto.randomBytes(16).toString("hex") + ext;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new AppError(400, "INVALID_FILE_TYPE", "Допустимые форматы: JPEG, PNG, WebP") as unknown as Error);
    }
  },
});

/**
 * POST /uploads
 * Upload up to 5 images. Returns array of relative URLs.
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
    upload.array("photos", MAX_FILES)(req, res, (err) => {
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

      const urls = files.map((f) => `/api/v1/uploads/${f.filename}`);
      logger.info({ count: files.length }, "Files uploaded");

      res.json({ success: true, data: { urls } });
    });
  },
);

export default router;
