import { describe, expect, it } from "vitest";
import { solveContrastingColor } from "./contrast-solver.js";
import { contrastRatio } from "./contrast.js";
import type { RGB } from "./types.js";

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("solveContrastingColor", () => {
  it("achieves the target WCAG contrast ratio within +/-0.05 across 50 background/ratio pairs", () => {
    const rand = mulberry32(7);
    const targetRatios = [3, 4.5, 7];
    const hues = [0, 60, 120, 180, 240, 300];

    const black: RGB = { r: 0, g: 0, b: 0 };
    const white: RGB = { r: 1, g: 1, b: 1 };
    let pairsChecked = 0;

    for (let i = 0; i < 50; i++) {
      const background: RGB = { r: rand(), g: rand(), b: rand() };
      const seedHue = hues[i % hues.length]!;

      // WCAG contrast against a fixed background is bounded: the maximum
      // reachable ratio toward black or toward white is fixed by the
      // background's own luminance. Pick whichever direction reaches
      // further, and cap the requested target below that ceiling so every
      // (background, ratio) pair is guaranteed solvable — the solver's job
      // is to hit the target precisely, not to violate WCAG math.
      const ratioTowardBlack = contrastRatio(black, background);
      const ratioTowardWhite = contrastRatio(white, background);
      const direction = ratioTowardBlack >= ratioTowardWhite ? "darker" : "lighter";
      const maxReachable = Math.max(ratioTowardBlack, ratioTowardWhite);

      const desiredRatio = targetRatios[i % targetRatios.length]!;
      const targetRatio = Math.min(desiredRatio, maxReachable - 0.1);
      if (targetRatio < 1.5) continue; // background too close to the crossover point at this ceiling

      const solved = solveContrastingColor(background, seedHue, 0.02, targetRatio, direction);
      const achieved = contrastRatio(solved, background);

      expect(achieved).toBeGreaterThanOrEqual(targetRatio - 0.05);
      expect(achieved).toBeLessThanOrEqual(targetRatio + 0.05);
      pairsChecked++;
    }

    expect(pairsChecked).toBeGreaterThan(30);
  });

  it("returns the best-effort extreme when the target ratio is unreachable in the requested direction", () => {
    // A near-white background asked to solve "lighter" for a 7:1 ratio can
    // never reach it (max distance from white to white is 0) — must return
    // the extreme (white itself) rather than throw or silently misreport.
    const nearWhite: RGB = { r: 0.98, g: 0.98, b: 0.98 };
    const solved = solveContrastingColor(nearWhite, 0, 0.02, 7, "lighter");
    expect(contrastRatio(solved, nearWhite)).toBeLessThan(7);
    expect(solved.r).toBeGreaterThan(0.9);
  });
});
