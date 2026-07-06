import { oklabToSrgb, srgbToOklab } from "./oklab.js";
import type { RGB } from "./types.js";

export type ThemeAdjustments = {
  /** 1 = unchanged, <1 darker, >1 brighter. */
  brightness: number;
  /** 1 = unchanged, <1 flatter, >1 more contrast (pivots around mid-gray). */
  contrast: number;
  /** 0 = no sepia, 1 = fully toned toward sepia. */
  sepia: number;
  /** 0 = full color, 1 = fully desaturated. */
  grayscale: number;
};

export const DEFAULT_ADJUSTMENTS: ThemeAdjustments = {
  brightness: 1,
  contrast: 1,
  sepia: 0,
  grayscale: 0,
};

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

const SEPIA_TARGET: RGB = { r: 0.44, g: 0.26, b: 0.08 };

/**
 * Applies user-adjustable brightness/contrast/sepia/grayscale on top of an
 * already-recolored value. Order: grayscale (desaturate in OKLab, which
 * keeps perceived lightness stable — a plain RGB desaturation shifts
 * lightness) -> sepia tint -> contrast pivot -> brightness scale. Callers
 * apply this *before* the WCAG contrast backstop (see theme-engine.ts), so
 * the guaranteed contrast ratio holds for whatever the user's adjustments
 * actually produce, not the pre-adjustment color.
 */
export function applyAdjustments(rgb: RGB, adjustments: ThemeAdjustments): RGB {
  let result = rgb;

  if (adjustments.grayscale > 0) {
    const lab = srgbToOklab(result);
    result = oklabToSrgb({ l: lab.l, a: lab.a * (1 - adjustments.grayscale), b: lab.b * (1 - adjustments.grayscale) });
  }

  if (adjustments.sepia > 0) {
    const t = adjustments.sepia;
    result = {
      r: result.r * (1 - t) + SEPIA_TARGET.r * t,
      g: result.g * (1 - t) + SEPIA_TARGET.g * t,
      b: result.b * (1 - t) + SEPIA_TARGET.b * t,
    };
  }

  if (adjustments.contrast !== 1) {
    const c = adjustments.contrast;
    result = {
      r: clamp01((result.r - 0.5) * c + 0.5),
      g: clamp01((result.g - 0.5) * c + 0.5),
      b: clamp01((result.b - 0.5) * c + 0.5),
    };
  }

  if (adjustments.brightness !== 1) {
    const b = adjustments.brightness;
    result = { r: clamp01(result.r * b), g: clamp01(result.g * b), b: clamp01(result.b * b) };
  }

  return result;
}
