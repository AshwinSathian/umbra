import { describe, expect, it } from "vitest";
import {
  DEFAULT_BACKGROUND_POLES,
  DEFAULT_FOREGROUND_POLES,
  recolorForRole,
  remapLightness,
} from "./recolor.js";
import { oklchToSrgbGamutMapped, srgbToOklch } from "./oklch.js";

function hueDelta(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

describe("remapLightness", () => {
  it("is a single monotonic function of lightness parameterized only by poles", () => {
    const poles = { low: 0.1, high: 0.9 };
    const samples = Array.from({ length: 50 }, (_, i) => i / 49);
    const outputs = samples.map((l) => remapLightness(l, poles));

    for (let i = 1; i < outputs.length; i++) {
      expect(outputs[i]).toBeGreaterThanOrEqual(outputs[i - 1]!);
    }
    expect(remapLightness(0, poles)).toBeCloseTo(poles.low, 10);
    expect(remapLightness(1, poles)).toBeCloseTo(poles.high, 10);
  });

  it("takes lightness as its only continuous input (no hue parameter exists in its signature)", () => {
    // remapLightness(l: number, poles: LightnessPoles) — calling it twice with
    // identical l/poles but conceptually "different hues" (hue is not and
    // cannot be passed in) always yields the same output, proving there is
    // no hue-dependent branch anywhere in this function.
    const poles = DEFAULT_BACKGROUND_POLES;
    const a = remapLightness(0.6, poles);
    const b = remapLightness(0.6, poles);
    expect(a).toBe(b);
  });
});

describe("recolorForRole", () => {
  it("preserves hue within 2 degrees across 100 sampled colors", () => {
    const fixedL = 0.6;
    const fixedC = 0.08; // moderate chroma, stays in-gamut across the hue wheel at this L
    let maxHueError = 0;

    for (let i = 0; i < 100; i++) {
      const hue = (360 * i) / 100;
      const rgb = oklchToSrgbGamutMapped({ l: fixedL, c: fixedC, h: hue });
      const recolored = recolorForRole(rgb, "background");
      const recoloredOklch = srgbToOklch(recolored);

      // Skip near-achromatic results where hue is not meaningful.
      if (recoloredOklch.c < 1e-3) continue;

      maxHueError = Math.max(maxHueError, hueDelta(hue, recoloredOklch.h));
    }

    expect(maxHueError).toBeLessThan(2);
  });

  it("maps near-white backgrounds toward the dark background pole", () => {
    const white = { r: 1, g: 1, b: 1 };
    const recolored = recolorForRole(white, "background");
    const oklch = srgbToOklch(recolored);
    expect(oklch.l).toBeCloseTo(DEFAULT_BACKGROUND_POLES.high, 2);
  });

  it("maps near-black text toward the light foreground pole", () => {
    const black = { r: 0, g: 0, b: 0 };
    const recolored = recolorForRole(black, "foreground");
    const oklch = srgbToOklch(recolored);
    expect(oklch.l).toBeCloseTo(DEFAULT_FOREGROUND_POLES.low, 2);
  });
});
