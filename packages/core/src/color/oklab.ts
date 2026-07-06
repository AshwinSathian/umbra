import type { OKLab, RGB } from "./types.js";

// OKLab conversion per Björn Ottosson's reference implementation:
// https://bottosson.github.io/posts/oklab/
// All RGB channels are sRGB, normalized to [0, 1] (not [0, 255]).

export function srgbChannelToLinear(c: number): number {
  const abs = Math.abs(c);
  const sign = c < 0 ? -1 : 1;
  return abs <= 0.04045 ? c / 12.92 : sign * Math.pow((abs + 0.055) / 1.055, 2.4);
}

export function linearChannelToSrgb(c: number): number {
  const abs = Math.abs(c);
  const sign = c < 0 ? -1 : 1;
  return abs <= 0.0031308 ? c * 12.92 : sign * (1.055 * Math.pow(abs, 1 / 2.4) - 0.055);
}

export function srgbToOklab(rgb: RGB): OKLab {
  const r = srgbChannelToLinear(rgb.r);
  const g = srgbChannelToLinear(rgb.g);
  const b = srgbChannelToLinear(rgb.b);

  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  return {
    l: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  };
}

export function oklabToSrgb(lab: OKLab): RGB {
  const l_ = lab.l + 0.3963377774 * lab.a + 0.2158037573 * lab.b;
  const m_ = lab.l - 0.1055613458 * lab.a - 0.0638541728 * lab.b;
  const s_ = lab.l - 0.0894841775 * lab.a - 1.291485548 * lab.b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  const r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  return {
    r: linearChannelToSrgb(r),
    g: linearChannelToSrgb(g),
    b: linearChannelToSrgb(b),
  };
}

export function isInSrgbGamut(rgb: RGB, epsilon = 1e-4): boolean {
  return (
    rgb.r >= -epsilon &&
    rgb.r <= 1 + epsilon &&
    rgb.g >= -epsilon &&
    rgb.g <= 1 + epsilon &&
    rgb.b >= -epsilon &&
    rgb.b <= 1 + epsilon
  );
}

export function clampRgb(rgb: RGB): RGB {
  return {
    r: Math.min(1, Math.max(0, rgb.r)),
    g: Math.min(1, Math.max(0, rgb.g)),
    b: Math.min(1, Math.max(0, rgb.b)),
  };
}
