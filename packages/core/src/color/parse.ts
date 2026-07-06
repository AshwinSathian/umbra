import { CSS_NAMED_COLORS } from "./named-colors.js";

export type ParsedColor = { r: number; g: number; b: number; a: number };

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function parseChannel(raw: string): number {
  const trimmed = raw.trim();
  if (trimmed.endsWith("%")) {
    return clamp01(parseFloat(trimmed) / 100);
  }
  return clamp01(parseFloat(trimmed) / 255);
}

function parseAlpha(raw: string | undefined): number {
  if (raw === undefined) return 1;
  const trimmed = raw.trim();
  if (trimmed.endsWith("%")) {
    return clamp01(parseFloat(trimmed) / 100);
  }
  return clamp01(parseFloat(trimmed));
}

function splitComponents(inner: string): string[] {
  // Supports both legacy comma syntax "255, 0, 0, 0.5" and modern
  // space-with-optional-slash syntax "255 0 0 / 50%".
  const [beforeSlash, afterSlash] = inner.split("/");
  const parts = beforeSlash!
    .trim()
    .split(/[\s,]+/)
    .filter((p) => p.length > 0);
  if (afterSlash !== undefined) {
    parts.push(afterSlash.trim());
  }
  return parts;
}

function hslToRgb(hDeg: number, s: number, l: number): { r: number; g: number; b: number } {
  const h = ((hDeg % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;

  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (h < 60) [r1, g1, b1] = [c, x, 0];
  else if (h < 120) [r1, g1, b1] = [x, c, 0];
  else if (h < 180) [r1, g1, b1] = [0, c, x];
  else if (h < 240) [r1, g1, b1] = [0, x, c];
  else if (h < 300) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];

  return { r: clamp01(r1 + m), g: clamp01(g1 + m), b: clamp01(b1 + m) };
}

function parseHex(hex: string): ParsedColor | null {
  const digits = hex.slice(1);
  const expand = (s: string): string =>
    s
      .split("")
      .map((c) => c + c)
      .join("");

  let normalized: string;
  if (digits.length === 3) normalized = expand(digits) + "ff";
  else if (digits.length === 4) normalized = expand(digits.slice(0, 3)) + expand(digits.slice(3));
  else if (digits.length === 6) normalized = digits + "ff";
  else if (digits.length === 8) normalized = digits;
  else return null;

  if (!/^[0-9a-fA-F]{8}$/.test(normalized)) return null;

  const r = parseInt(normalized.slice(0, 2), 16) / 255;
  const g = parseInt(normalized.slice(2, 4), 16) / 255;
  const b = parseInt(normalized.slice(4, 6), 16) / 255;
  const a = parseInt(normalized.slice(6, 8), 16) / 255;
  return { r, g, b, a };
}

/**
 * Parses a CSS color value (as returned by CSSStyleDeclaration.getPropertyValue)
 * into normalized RGBA. Returns null for values this parser cannot resolve
 * on its own (e.g. `currentcolor`, which requires inherited-value context) —
 * callers must treat null as "leave this declaration untouched", never as
 * black or transparent.
 */
export function parseCssColor(value: string): ParsedColor | null {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "") return null;
  if (trimmed === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  if (trimmed === "currentcolor" || trimmed === "inherit" || trimmed === "initial" || trimmed === "unset") {
    return null;
  }

  if (trimmed.startsWith("#")) {
    return parseHex(trimmed);
  }

  const fnMatch = trimmed.match(/^(rgb|rgba|hsl|hsla)\((.+)\)$/);
  if (fnMatch) {
    const fn = fnMatch[1]!;
    const parts = splitComponents(fnMatch[2]!);

    if (fn === "rgb" || fn === "rgba") {
      if (parts.length < 3) return null;
      const r = parseChannel(parts[0]!);
      const g = parseChannel(parts[1]!);
      const b = parseChannel(parts[2]!);
      const a = parseAlpha(parts[3]);
      return { r, g, b, a };
    }

    // hsl/hsla
    if (parts.length < 3) return null;
    const h = parseFloat(parts[0]!);
    const s = clamp01(parseFloat(parts[1]!) / 100);
    const l = clamp01(parseFloat(parts[2]!) / 100);
    const a = parseAlpha(parts[3]);
    const { r, g, b } = hslToRgb(h, s, l);
    return { r, g, b, a };
  }

  const named = CSS_NAMED_COLORS[trimmed];
  if (named) {
    return { r: named[0] / 255, g: named[1] / 255, b: named[2] / 255, a: 1 };
  }

  return null;
}
