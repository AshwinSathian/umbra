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
