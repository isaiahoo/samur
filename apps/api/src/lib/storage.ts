// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Blob storage abstraction. Two backends:
 *
 *   - Yandex Object Storage (prod, when YANDEX_STORAGE_* env is set):
 *     upload via S3 PutObject, serve by 302-redirecting from our
 *     existing /api/v1/uploads/:filename route to the public bucket
 *     URL. The API never proxies bytes back to the client — browsers
 *     fetch photos directly from Yandex after one redirect.
 *
 *   - Local filesystem (dev + tests, when env is unset): write to
 *     UPLOAD_DIR, serve via express.static in src/index.ts. This
 *     preserves the `docker compose up` workflow for local dev
 *     without anyone needing cloud credentials.
 *
 * The call sites don't know which backend they're on — they call
 * writeBlob() / getPublicUrl() / deleteBlob() and get back a string
 * key that matches the photoUrl regex regardless of backend.
 */
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import path from "path";
import fs from "fs";
import { config } from "../config.js";
import { logger } from "./logger.js";

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");

/** Whether the Yandex backend is fully configured. Single source of
 * truth so dispatch decisions can't drift between call sites. */
export function isRemoteStorageEnabled(): boolean {
  return !!(
    config.YANDEX_STORAGE_ENDPOINT &&
    config.YANDEX_STORAGE_BUCKET &&
    config.YANDEX_STORAGE_ACCESS_KEY_ID &&
    config.YANDEX_STORAGE_SECRET_ACCESS_KEY
  );
}

/** Lazily-initialised S3 client. Yandex is S3-compatible but needs
 * forcePathStyle — virtual-host-style URLs require custom DNS per
 * bucket and we'd rather keep the single endpoint. */
let s3Client: S3Client | null = null;
function getS3(): S3Client {
  if (s3Client) return s3Client;
  s3Client = new S3Client({
    endpoint: config.YANDEX_STORAGE_ENDPOINT,
    region: config.YANDEX_STORAGE_REGION,
    credentials: {
      accessKeyId: config.YANDEX_STORAGE_ACCESS_KEY_ID,
      secretAccessKey: config.YANDEX_STORAGE_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
  });
  return s3Client;
}

/** Ensure the local upload dir exists when we're on the fs backend. */
function ensureLocalDir(): void {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

/** Write a blob under `filename` (already the 32-hex + extension
 * shape produced by the uploads handler). Returns the filename
 * unchanged — the public URL is computed later via getPublicUrl.
 *
 * Remote: PutObject with the file's MIME type + 1-year Cache-Control
 * (objects are immutable — new uploads get new random filenames, so
 * aggressive caching is safe). Does NOT set ACL on each Put because
 * the bucket-level "Чтение объектов = Для всех" already makes every
 * object public-read.
 *
 * Local: writeFile to UPLOAD_DIR. */
export async function writeBlob(filename: string, body: Buffer, contentType: string): Promise<void> {
  if (isRemoteStorageEnabled()) {
    await getS3().send(new PutObjectCommand({
      Bucket: config.YANDEX_STORAGE_BUCKET,
      Key: filename,
      Body: body,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable",
    }));
    return;
  }
  ensureLocalDir();
  await fs.promises.writeFile(path.join(UPLOAD_DIR, filename), body);
}

/** Delete a blob by filename. Used by the orphan-cleanup path on
 * mid-batch failure. Tolerates "not found" on both backends. */
export async function deleteBlob(filename: string): Promise<void> {
  if (isRemoteStorageEnabled()) {
    try {
      await getS3().send(new DeleteObjectCommand({
        Bucket: config.YANDEX_STORAGE_BUCKET,
        Key: filename,
      }));
    } catch (err) {
      logger.warn({ err, filename }, "remote deleteBlob failed");
    }
    return;
  }
  try {
    await fs.promises.unlink(path.join(UPLOAD_DIR, filename));
  } catch {
    /* not found — fine */
  }
}

/** Return the public URL a browser should fetch to get this blob.
 *
 * Remote: combines PUBLIC_URL + filename. PUBLIC_URL already
 * includes the bucket so we just append the filename.
 *
 * Local: returns the /api/v1/uploads/... path that express.static
 * serves. Same shape the photoUrl regex validates. */
export function getPublicUrl(filename: string): string {
  if (isRemoteStorageEnabled()) {
    const base = config.YANDEX_STORAGE_PUBLIC_URL.replace(/\/+$/, "");
    return `${base}/${filename}`;
  }
  return `/api/v1/uploads/${filename}`;
}
