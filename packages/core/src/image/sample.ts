import { relativeLuminance } from "../color/contrast.js";
import type { PixelGrid } from "./types.js";

const TRANSPARENT_ALPHA_THRESHOLD = 0.05;
const COLOR_QUANTIZE_LEVELS = 4; // per channel -> 4^3 = 64 possible buckets

export type LightnessStats = {
  meanLightness: number;
  stdDevLightness: number;
  transparentFraction: number;
  opaquePixelCount: number;
};

function pixelLightness(grid: PixelGrid, index: number): number {
  const r = grid.data[index]! / 255;
  const g = grid.data[index + 1]! / 255;
  const b = grid.data[index + 2]! / 255;
  return relativeLuminance({ r, g, b });
}

/** Global lightness mean + variance over opaque pixels only — this alone is
 * exactly Dark Reader's signal (isDark/isLight thresholds on mean lightness).
 * It's kept here as one input among several, not the sole classifier. */
export function computeLightnessStats(grid: PixelGrid): LightnessStats {
  const pixelCount = grid.width * grid.height;
  let opaquePixelCount = 0;
  let transparentPixelCount = 0;
  let sum = 0;
  let sumSq = 0;

  for (let i = 0; i < pixelCount; i++) {
    const offset = i * 4;
    const alpha = grid.data[offset + 3]! / 255;
    if (alpha < TRANSPARENT_ALPHA_THRESHOLD) {
      transparentPixelCount++;
      continue;
    }
    const lightness = pixelLightness(grid, offset);
    sum += lightness;
    sumSq += lightness * lightness;
    opaquePixelCount++;
  }

  if (opaquePixelCount === 0) {
    return { meanLightness: 0, stdDevLightness: 0, transparentFraction: 1, opaquePixelCount: 0 };
  }

  const mean = sum / opaquePixelCount;
  const variance = Math.max(0, sumSq / opaquePixelCount - mean * mean);

  return {
    meanLightness: mean,
    stdDevLightness: Math.sqrt(variance),
    transparentFraction: transparentPixelCount / pixelCount,
    opaquePixelCount,
  };
}

const EDGE_MAGNITUDE_CUTOFF = 0.5;

/**
 * Fraction of interior pixels whose local Sobel gradient magnitude (over
 * the lightness channel) exceeds a fixed cutoff — i.e. "how much of this
 * image has a sharp local transition somewhere nearby". Deliberately a
 * *fraction of pixels*, not a mean magnitude: a flat icon with one crisp
 * outline (e.g. a glyph on a solid background) has a strong gradient
 * concentrated in a thin boundary, so its *mean* gradient can be
 * misleadingly high even though almost the entire image is flat. The
 * fraction correctly reads that as "small edge region, mostly flat",
 * while a textured photo has significant gradient spread across most of
 * the image. This — plus {@link computeColorDiversity} — is the signal
 * Dark Reader's classifier never computes at all; it only ever looks at
 * global mean lightness, which is exactly what misclassifies a bright
 * product photo on a white background as a flat light-mode icon.
 */
export function computeEdgeDensity(grid: PixelGrid): number {
  const { width, height } = grid;
  if (width < 3 || height < 3) return 0;

  const lightness = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      lightness[idx] = pixelLightness(grid, idx * 4);
    }
  }

  let edgePixelCount = 0;
  let count = 0;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const at = (dx: number, dy: number) => lightness[(y + dy) * width + (x + dx)]!;

      // Sobel operator.
      const gx =
        -at(-1, -1) - 2 * at(-1, 0) - at(-1, 1) + at(1, -1) + 2 * at(1, 0) + at(1, 1);
      const gy =
        -at(-1, -1) - 2 * at(0, -1) - at(1, -1) + at(-1, 1) + 2 * at(0, 1) + at(1, 1);

      if (Math.sqrt(gx * gx + gy * gy) > EDGE_MAGNITUDE_CUTOFF) {
        edgePixelCount++;
      }
      count++;
    }
  }

  return count === 0 ? 0 : edgePixelCount / count;
}

/**
 * Counts distinct quantized colors among opaque pixels (each channel
 * bucketed into `COLOR_QUANTIZE_LEVELS` levels). A flat icon or a solid
 * swatch uses a small, fixed palette; a photo uses many. This is a second,
 * independent signal from edge density (a smooth gradient can have low
 * edge density but still span many distinct colors), so the two together
 * catch more photo shapes than either alone.
 */
export function computeColorDiversity(grid: PixelGrid): number {
  const pixelCount = grid.width * grid.height;
  const seen = new Set<number>();
  const bucketSize = 256 / COLOR_QUANTIZE_LEVELS;

  for (let i = 0; i < pixelCount; i++) {
    const offset = i * 4;
    const alpha = grid.data[offset + 3]! / 255;
    if (alpha < TRANSPARENT_ALPHA_THRESHOLD) continue;

    const rBucket = Math.floor(grid.data[offset]! / bucketSize);
    const gBucket = Math.floor(grid.data[offset + 1]! / bucketSize);
    const bBucket = Math.floor(grid.data[offset + 2]! / bucketSize);
    seen.add(rBucket * COLOR_QUANTIZE_LEVELS * COLOR_QUANTIZE_LEVELS + gBucket * COLOR_QUANTIZE_LEVELS + bBucket);
  }

  return seen.size;
}
