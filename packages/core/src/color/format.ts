import type { ParsedColor } from "./parse.js";

/** Serializes a parsed color back to a CSS `rgba()` string, rounding channels to integers. */
export function formatCssColor(color: ParsedColor): string {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  // Keep alpha at reasonable precision without trailing float noise.
  const a = Math.round(color.a * 1000) / 1000;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
