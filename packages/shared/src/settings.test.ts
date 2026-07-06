import { describe, expect, it } from "vitest";
import { DEFAULT_STORED_THEME_SETTINGS } from "./settings.js";

describe("DEFAULT_STORED_THEME_SETTINGS", () => {
  it("keeps lightness poles within the valid OKLCH [0,1] range, background below foreground", () => {
    const { backgroundLightness, foregroundLightness } = DEFAULT_STORED_THEME_SETTINGS;
    expect(backgroundLightness).toBeGreaterThanOrEqual(0);
    expect(backgroundLightness).toBeLessThanOrEqual(1);
    expect(foregroundLightness).toBeGreaterThanOrEqual(0);
    expect(foregroundLightness).toBeLessThanOrEqual(1);
    expect(backgroundLightness).toBeLessThan(foregroundLightness);
  });

  it("defaults the contrast target to WCAG 2.1 AA (4.5:1) for normal text", () => {
    expect(DEFAULT_STORED_THEME_SETTINGS.contrastTarget).toBe(4.5);
  });

  it("defaults every adjustment to its identity/neutral value", () => {
    expect(DEFAULT_STORED_THEME_SETTINGS.brightness).toBe(1);
    expect(DEFAULT_STORED_THEME_SETTINGS.contrast).toBe(1);
    expect(DEFAULT_STORED_THEME_SETTINGS.sepia).toBe(0);
    expect(DEFAULT_STORED_THEME_SETTINGS.grayscale).toBe(0);
  });

  it("defaults imageConservativeMode to true (the fail-safe 'never guess' behavior)", () => {
    expect(DEFAULT_STORED_THEME_SETTINGS.imageConservativeMode).toBe(true);
  });
});
