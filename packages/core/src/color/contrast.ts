import { srgbChannelToLinear } from "./oklab.js";
import type { RGB } from "./types.js";

/** WCAG 2.1 relative luminance (https://www.w3.org/TR/WCAG21/#dfn-relative-luminance). */
export function relativeLuminance(rgb: RGB): number {
  const r = srgbChannelToLinear(rgb.r);
  const g = srgbChannelToLinear(rgb.g);
  const b = srgbChannelToLinear(rgb.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.1 contrast ratio, always >= 1. */
export function contrastRatio(a: RGB, b: RGB): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}
