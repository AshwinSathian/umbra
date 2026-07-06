import { clampRgb, isInSrgbGamut, oklabToSrgb, srgbToOklab } from "./oklab.js";
import type { OKLCH, RGB } from "./types.js";

const GAMUT_SEARCH_ITERATIONS = 20;

export function srgbToOklch(rgb: RGB): OKLCH {
  const lab = srgbToOklab(rgb);
  const c = Math.sqrt(lab.a * lab.a + lab.b * lab.b);
  let h = (Math.atan2(lab.b, lab.a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: lab.l, c, h };
}

export function oklchToOklab(oklch: OKLCH): { l: number; a: number; b: number } {
  const hRad = (oklch.h * Math.PI) / 180;
  return {
    l: oklch.l,
    a: oklch.c * Math.cos(hRad),
    b: oklch.c * Math.sin(hRad),
  };
}

/**
 * Converts OKLCH to sRGB. When the color is outside the sRGB gamut, reduces
 * chroma at constant lightness/hue via binary search until it fits — this is
 * the only adjustment ever made; hue is never altered as a side effect of
 * gamut mapping, unlike Dark Reader's per-hue HSL branches.
 */
export function oklchToSrgbGamutMapped(oklch: OKLCH): RGB {
  const direct = oklabToSrgb(oklchToOklab(oklch));
  if (isInSrgbGamut(direct)) {
    return clampRgb(direct);
  }

  let loC = 0;
  let hiC = oklch.c;
  for (let i = 0; i < GAMUT_SEARCH_ITERATIONS; i++) {
    const midC = (loC + hiC) / 2;
    const candidate = oklabToSrgb(oklchToOklab({ l: oklch.l, c: midC, h: oklch.h }));
    if (isInSrgbGamut(candidate)) {
      loC = midC;
    } else {
      hiC = midC;
    }
  }

  return clampRgb(oklabToSrgb(oklchToOklab({ l: oklch.l, c: loC, h: oklch.h })));
}
