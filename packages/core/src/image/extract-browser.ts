import type { ImageSampler } from "./image-theme.js";
import type { PixelGrid } from "./types.js";

const MAX_ANALYSIS_DIMENSION = 32;

/**
 * Real browser implementation of {@link ImageSampler}: decodes the image at
 * `url`, downsamples it to at most 32x32 on an OffscreenCanvas (cheap —
 * classification only needs coarse structure, not full resolution), and
 * reads back the pixels. Returns null on any failure (network error,
 * decode error, or a cross-origin image without CORS headers producing a
 * tainted canvas that throws on `getImageData`) — per the fail-safe
 * contract, a sampling failure must never be treated as "assume flat" or
 * "assume photo", only as "leave untouched".
 *
 * This module touches only standard browser APIs (Image, OffscreenCanvas)
 * available in both Chrome and Safari content-script contexts; it is
 * intentionally not unit-tested here since Vitest's happy-dom environment
 * has no real image decoder or canvas pixel backend — it's exercised by
 * the Playwright end-to-end suite instead (Phase 7 of PLAN-darkframe.md).
 */
export const sampleImageFromUrl: ImageSampler = async (url: string): Promise<PixelGrid | null> => {
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = url;
    await img.decode();

    const scale = Math.min(1, MAX_ANALYSIS_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight, 1));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.drawImage(img, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);

    return { width, height, data: imageData.data };
  } catch {
    return null;
  }
};
