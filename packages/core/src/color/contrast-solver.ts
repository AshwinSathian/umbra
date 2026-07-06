import { contrastRatio } from "./contrast.js";
import { oklchToSrgbGamutMapped, srgbToOklch } from "./oklch.js";
import type { RGB } from "./types.js";

export type ContrastDirection = "lighter" | "darker";

const SOLVER_ITERATIONS = 40;

/**
 * Solves for the OKLCH lightness (holding hue and chroma fixed, so the
 * solved color's hue never drifts from the seed hue) that produces the
 * smallest possible move away from the background's own lightness while
 * still meeting `targetRatio` against `backgroundSrgb`, in the requested
 * direction. If even the most extreme lightness in that direction cannot
 * reach the target ratio, returns the best achievable (most extreme) color
 * instead of silently failing.
 */
export function solveContrastingColor(
  backgroundSrgb: RGB,
  seedHueDeg: number,
  seedChroma: number,
  targetRatio: number,
  direction: ContrastDirection,
): RGB {
  const bgOklch = srgbToOklch(backgroundSrgb);
  const colorAtLightness = (l: number): RGB =>
    oklchToSrgbGamutMapped({ l, c: seedChroma, h: seedHueDeg });

  let lo = direction === "lighter" ? bgOklch.l : 0;
  let hi = direction === "lighter" ? 1 : bgOklch.l;
  const extremeL = direction === "lighter" ? hi : lo;
  const extreme = colorAtLightness(extremeL);

  if (contrastRatio(extreme, backgroundSrgb) < targetRatio) {
    // Target is unreachable in this direction even at the extreme lightness
    // (e.g. a mid-gray background with a very high target ratio) — return
    // the best achievable color rather than overshoot into the other tone.
    return extreme;
  }

  for (let i = 0; i < SOLVER_ITERATIONS; i++) {
    const mid = (lo + hi) / 2;
    const ratio = contrastRatio(colorAtLightness(mid), backgroundSrgb);
    const meetsTarget = ratio >= targetRatio;

    if (direction === "lighter") {
      if (meetsTarget) hi = mid;
      else lo = mid;
    } else {
      if (meetsTarget) lo = mid;
      else hi = mid;
    }
  }

  return colorAtLightness(direction === "lighter" ? hi : lo);
}
