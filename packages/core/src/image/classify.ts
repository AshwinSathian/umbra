import { computeColorDiversity, computeEdgeDensity, computeLightnessStats } from "./sample.js";
import type { PixelGrid } from "./types.js";

export type ImageClassification = "photo" | "flat" | "uncertain";

export type ImageAnalysis = {
  meanLightness: number;
  stdDevLightness: number;
  transparentFraction: number;
  edgeDensity: number;
  colorDiversity: number;
  classification: ImageClassification;
};

// Global lightness standard deviation turns out NOT to reliably separate
// "flat 2-tone icon" from "photo": a high-contrast glyph-on-background icon
// (e.g. white glyph on a saturated blue square) is bimodal and has a *high*
// stddev despite being trivially flat — the same or higher stddev than many
// real photos. It's kept in the analysis output as a diagnostic, but the
// actual flat/photo gate is driven by the two signals that empirically do
// separate them: color diversity (an icon uses a handful of flat colors; a
// photo uses dozens+) and edge *fraction* (an icon's sharp boundary is
// confined to a thin region; a photo's texture is spread across most of the
// image). A "flat" candidate must score low on both; a "photo" candidate
// only needs to trip either one — the asymmetry (easy to prove "photo",
// hard to prove "flat") is the deliberate fail-safe bias the hard "never
// alter photos" requirement calls for. Anything that doesn't clearly land
// in either bucket is "uncertain", which callers must treat as "leave
// untouched" by default — see shouldRecolorImage.
// 0.2 (not a tighter value) is deliberate: real-world testing against an
// actual anti-aliased circular icon (rendered by a real browser canvas, not
// a synthetic hard-edged square fixture) measured an edge density of 0.16 —
// a curved boundary spreads anti-aliased edge pixels across more of the
// image than a straight one. 0.2 still safely excludes real photographic
// noise, which measures an order of magnitude higher (~0.8+).
const FLAT_EDGE_DENSITY_MAX = 0.2;
const FLAT_COLOR_DIVERSITY_MAX = 6;

const PHOTO_EDGE_DENSITY_MIN = 0.3;
const PHOTO_COLOR_DIVERSITY_MIN = 8;

// The flat/photo gate above is pixel-content-only — it has no notion of how
// large or visually prominent the image actually is. That is correct for
// its original target (a smooth gradient *icon or badge asset*, small
// enough that a lightness/hue shift is imperceptible), but the exact same
// pixel signature (few distinct colors, no sharp local edges) is produced
// by a large decorative hero/banner image — e.g. a profile page's cover
// photo, confirmed live on LinkedIn's default gradient banner. Applying the
// icon-tuned recolor filter (`invert(1) hue-rotate(180deg)` — see
// image/image-theme.ts) to something rendered at hundreds of pixels across
// is highly visible and reads as a broken/incorrectly-inverted image, not a
// graceful dark-mode adaptation, even though the classifier's reasoning for
// calling it "flat" was sound in isolation. A size gate catches this — but
// it MUST compare against the image's real, natural (pre-downsample) size,
// never `PixelGrid.width`/`height`: the real sampler (extract-browser.ts)
// always downsamples every image to at most 32px on its long edge before
// this function ever sees it (cheap — classification only needs coarse
// structure), so `grid.width`/`height` can *never* exceed 32 regardless of
// the source image's actual rendered size. An earlier version of this gate
// compared against `grid.width`/`height` directly and was provably dead
// code in the real pipeline for exactly that reason — it only appeared to
// work in unit tests that construct a `PixelGrid` directly at full
// resolution, bypassing the real downsampling step entirely; confirmed live
// on LinkedIn's actual banner still getting incorrectly recolored despite
// that "fix". `PixelGrid.naturalWidth`/`naturalHeight` (captured by the
// sampler before it downsamples — see types.ts) is the real signal: real
// icons/logos/badges are essentially always well under this size, while
// banner/hero art is essentially always well over it. Falls back to
// `grid.width`/`height` when natural size isn't supplied (every existing
// unit test, and any future caller that doesn't downsample) — correct
// there since natural size and analysis size are the same thing by
// construction when nothing was ever downsampled. Only downgrades "flat" to
// "uncertain" (never touches "photo") — under conservative mode (the
// default) "uncertain" is left untouched, the same safe fallback every
// other ambiguous case already gets; it remains eligible for recolor only
// if the user has explicitly opted out of conservative mode, same as any
// other uncertain image.
const MAX_FLAT_RECOLOR_DIMENSION = 512;

export function analyzeImage(grid: PixelGrid): ImageAnalysis {
  const lightness = computeLightnessStats(grid);
  const edgeDensity = computeEdgeDensity(grid);
  const colorDiversity = computeColorDiversity(grid);

  const looksFlat = edgeDensity <= FLAT_EDGE_DENSITY_MAX && colorDiversity <= FLAT_COLOR_DIVERSITY_MAX;

  const looksPhoto = edgeDensity >= PHOTO_EDGE_DENSITY_MIN || colorDiversity >= PHOTO_COLOR_DIVERSITY_MIN;

  let classification: ImageClassification;
  if (looksFlat && !looksPhoto) classification = "flat";
  else if (looksPhoto && !looksFlat) classification = "photo";
  else classification = "uncertain";

  // See MAX_FLAT_RECOLOR_DIMENSION above — a large image never gets the
  // icon-tuned "flat" treatment purely on the strength of a low-edge-
  // density/low-color-diversity pixel signature; a "photo" verdict is
  // untouched by this (the hard "never alter photos" guarantee never
  // depends on this gate being right). Must compare against the *natural*
  // (pre-downsample) size, not the analysis grid's own width/height — see
  // the doc comment above.
  const naturalWidth = grid.naturalWidth ?? grid.width;
  const naturalHeight = grid.naturalHeight ?? grid.height;
  if (classification === "flat" && (naturalWidth > MAX_FLAT_RECOLOR_DIMENSION || naturalHeight > MAX_FLAT_RECOLOR_DIMENSION)) {
    classification = "uncertain";
  }

  return {
    meanLightness: lightness.meanLightness,
    stdDevLightness: lightness.stdDevLightness,
    transparentFraction: lightness.transparentFraction,
    edgeDensity,
    colorDiversity,
    classification,
  };
}

/**
 * Whether an image classified by {@link analyzeImage} should have its
 * colors touched at all. "photo" is never recolored, full stop, regardless
 * of settings — that is the hard guarantee this module exists to provide.
 * "uncertain" is only recolored if the user has explicitly turned off
 * conservative mode (an informed, opt-in relaxation of the default
 * fail-safe); "flat" is always eligible.
 */
export function shouldRecolorImage(analysis: ImageAnalysis, conservativeMode = true): boolean {
  if (analysis.classification === "photo") return false;
  if (analysis.classification === "flat") return true;
  return !conservativeMode;
}
