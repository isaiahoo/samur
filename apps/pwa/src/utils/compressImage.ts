// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Compress an image file using Canvas API.
 * Scales down to maxWidth, outputs JPEG at given quality.
 * Returns original file if already small enough or on error.
 */
export async function compressImage(
  file: File,
  maxWidth = 1920,
  quality = 0.8,
): Promise<File> {
  // Skip small files
  if (file.size <= 500 * 1024) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;

    // Skip if already within bounds
    if (width <= maxWidth && file.size <= 500 * 1024) {
      bitmap.close();
      return file;
    }

    const scale = width > maxWidth ? maxWidth / width : 1;
    const w = Math.round(width * scale);
    const h = Math.round(height * scale);

    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }

    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();

    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
    return new File([blob], file.name.replace(/\.\w+$/, ".jpg"), {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } catch {
    // Browser can't decode (e.g. HEIC on some Android) — return original
    return file;
  }
}
