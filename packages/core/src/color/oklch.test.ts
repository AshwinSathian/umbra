import { describe, expect, it } from "vitest";
import { oklchToSrgbGamutMapped, srgbToOklch } from "./oklch.js";
import { isInSrgbGamut } from "./oklab.js";
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

describe("srgbToOklch / oklchToSrgbGamutMapped round-trip", () => {
  it("round-trips 10,000 random in-gamut sRGB samples within 1e-4", () => {
    const rand = mulberry32(42);
    let maxError = 0;

    for (let i = 0; i < 10_000; i++) {
      const original: RGB = { r: rand(), g: rand(), b: rand() };
      const oklch = srgbToOklch(original);
      const roundTripped = oklchToSrgbGamutMapped(oklch);

      const error = Math.max(
        Math.abs(original.r - roundTripped.r),
        Math.abs(original.g - roundTripped.g),
        Math.abs(original.b - roundTripped.b),
      );
      maxError = Math.max(maxError, error);
    }

    expect(maxError).toBeLessThan(1e-4);
  });

  it("gamut-maps out-of-gamut OKLCH colors into valid sRGB", () => {
    const outOfGamutSamples = [
      { l: 0.9, c: 0.5, h: 30 },
      { l: 0.5, c: 0.8, h: 145 },
      { l: 0.2, c: 0.6, h: 260 },
      { l: 0.99, c: 0.4, h: 0 },
      { l: 0.05, c: 0.4, h: 200 },
    ];

    for (const sample of outOfGamutSamples) {
      const mapped = oklchToSrgbGamutMapped(sample);
      expect(isInSrgbGamut(mapped, 1e-6)).toBe(true);
      expect(mapped.r).toBeGreaterThanOrEqual(0);
      expect(mapped.r).toBeLessThanOrEqual(1);
      expect(mapped.g).toBeGreaterThanOrEqual(0);
      expect(mapped.g).toBeLessThanOrEqual(1);
      expect(mapped.b).toBeGreaterThanOrEqual(0);
      expect(mapped.b).toBeLessThanOrEqual(1);
    }
  });
});
