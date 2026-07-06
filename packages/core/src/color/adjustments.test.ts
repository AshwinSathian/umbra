import { describe, expect, it } from "vitest";
import { DEFAULT_ADJUSTMENTS, applyAdjustments } from "./adjustments.js";
import { srgbToOklch } from "./oklch.js";

describe("applyAdjustments", () => {
  it("leaves a color unchanged under default (identity) adjustments", () => {
    const rgb = { r: 0.3, g: 0.5, b: 0.7 };
    const result = applyAdjustments(rgb, DEFAULT_ADJUSTMENTS);
    expect(result.r).toBeCloseTo(rgb.r, 5);
    expect(result.g).toBeCloseTo(rgb.g, 5);
    expect(result.b).toBeCloseTo(rgb.b, 5);
  });

  it("fully desaturates at grayscale=1 while roughly preserving lightness", () => {
    const rgb = { r: 0.8, g: 0.2, b: 0.2 };
    const before = srgbToOklch(rgb);
    const result = applyAdjustments(rgb, { ...DEFAULT_ADJUSTMENTS, grayscale: 1 });
    const after = srgbToOklch(result);
    expect(after.c).toBeCloseTo(0, 2);
    expect(after.l).toBeCloseTo(before.l, 2);
  });

  it("moves fully toward the sepia target at sepia=1", () => {
    const rgb = { r: 0.1, g: 0.9, b: 0.1 };
    const result = applyAdjustments(rgb, { ...DEFAULT_ADJUSTMENTS, sepia: 1 });
    expect(result.r).toBeCloseTo(0.44, 2);
    expect(result.g).toBeCloseTo(0.26, 2);
    expect(result.b).toBeCloseTo(0.08, 2);
  });

  it("pushes values away from mid-gray as contrast increases", () => {
    const rgb = { r: 0.6, g: 0.6, b: 0.6 };
    const result = applyAdjustments(rgb, { ...DEFAULT_ADJUSTMENTS, contrast: 2 });
    expect(result.r).toBeGreaterThan(rgb.r);
  });

  it("scales channel values with brightness, clamped to [0,1]", () => {
    const rgb = { r: 0.9, g: 0.9, b: 0.9 };
    const brighter = applyAdjustments(rgb, { ...DEFAULT_ADJUSTMENTS, brightness: 2 });
    expect(brighter.r).toBe(1);

    const darker = applyAdjustments(rgb, { ...DEFAULT_ADJUSTMENTS, brightness: 0.5 });
    expect(darker.r).toBeCloseTo(0.45, 2);
  });
});
