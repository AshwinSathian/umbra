import { oklchToSrgbGamutMapped, srgbToOklch } from "./oklch.js";
import type { RGB } from "./types.js";

export type LightnessPoles = {
  /** OKLCH lightness (0-1) that the darkest input color maps toward. */
  low: number;
  /** OKLCH lightness (0-1) that the lightest input color maps toward. */
  high: number;
};

export type ColorRole = "background" | "foreground";

/**
 * The single lightness remap used for every color, background or
 * foreground, regardless of hue. This is a plain affine map of OKLCH
 * lightness — there is no per-hue branching (no "isYellow"/"isBlue"
 * special case) anywhere in this module, unlike Dark Reader's
 * `modify-colors.ts`, because OKLCH lightness is already perceptually
 * comparable across hues, so no hue-dependent correction is needed.
 */
export function remapLightness(l: number, poles: LightnessPoles): number {
  const clamped = Math.min(1, Math.max(0, l));
  return poles.low + (poles.high - poles.low) * clamped;
}

export const DEFAULT_BACKGROUND_POLES: LightnessPoles = { low: 0.05, high: 0.22 };
export const DEFAULT_FOREGROUND_POLES: LightnessPoles = { low: 0.78, high: 0.95 };

export function recolorForRole(rgb: RGB, role: ColorRole, poles?: LightnessPoles): RGB {
  const activePoles = poles ?? (role === "background" ? DEFAULT_BACKGROUND_POLES : DEFAULT_FOREGROUND_POLES);
  const oklch = srgbToOklch(rgb);
  const remappedL = remapLightness(oklch.l, activePoles);
  return oklchToSrgbGamutMapped({ l: remappedL, c: oklch.c, h: oklch.h });
}
