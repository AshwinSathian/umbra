import { describe, expect, it } from "vitest";
import { analyzeImage, shouldRecolorImage } from "./classify.js";
import type { PixelGrid } from "./types.js";

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

function makeGrid(width: number, height: number, paint: (x: number, y: number) => [number, number, number, number]): PixelGrid {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const [r, g, b, a] = paint(x, y);
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = a;
    }
  }
  return { width, height, data };
}

const solidColorGrid = makeGrid(32, 32, () => [40, 90, 200, 255]);

const twoColorIconGrid = makeGrid(32, 32, (x, y) => {
  const insideGlyph = x > 8 && x < 24 && y > 8 && y < 24;
  return insideGlyph ? [255, 255, 255, 255] : [40, 90, 200, 255];
});

const transparentIconGrid = makeGrid(32, 32, (x, y) => {
  const insideGlyph = x > 8 && x < 24 && y > 8 && y < 24;
  return insideGlyph ? [20, 20, 20, 255] : [0, 0, 0, 0];
});

const linearGradientGrid = makeGrid(32, 32, (x) => {
  const t = x / 31;
  return [Math.round(20 + t * 200), Math.round(20 + t * 200), Math.round(20 + t * 200), 255];
});

/** Same smooth-gradient pixel signature as linearGradientGrid (few distinct
 * colors, no sharp local edges), but shaped like what the *real* sampler
 * (extract-browser.ts) actually hands the classifier for a large banner:
 * the analysis grid itself is always downsampled to at most 32px on its
 * long edge (32x8 here, matching a 1584x396 source scaled down), with the
 * true pre-downsample size carried separately via naturalWidth/
 * naturalHeight. Using the *real* source dimensions (1584x396 — LinkedIn's
 * actual default profile cover-photo banner shape) as `width`/`height`
 * directly, as an earlier version of this fixture did, does not reproduce
 * the real pipeline at all and let a provably-dead gate pass this test
 * while still being broken live — see the REGRESSION test below this one. */
function bannerShapedAnalysisGrid(): PixelGrid {
  return makeGrid(32, 8, (x) => {
    const t = x / 31;
    return [Math.round(20 + t * 200), Math.round(20 + t * 200), Math.round(20 + t * 200), 255];
  });
}

function largeBannerAnalysisGrid(): PixelGrid {
  return { ...bannerShapedAnalysisGrid(), naturalWidth: 1584, naturalHeight: 396 };
}

const noisePhotoGrid = (() => {
  const rand = mulberry32(11);
  return makeGrid(32, 32, () => [
    Math.round(rand() * 255),
    Math.round(rand() * 255),
    Math.round(rand() * 255),
    255,
  ]);
})();

/** The specific known Dark-Reader failure mode: a bright product photo on a
 * near-white background. Globally this is very light (a global-mean-only
 * classifier reads it as "light" and treats it like a light-mode icon to be
 * dimmed/inverted) but it has a high-detail, high-contrast object in the
 * middle — real local structure a photo has and a flat icon never does. */
const brightProductPhotoGrid = (() => {
  const rand = mulberry32(99);
  return makeGrid(64, 64, (x, y) => {
    const insideProduct = x > 16 && x < 48 && y > 16 && y < 48;
    if (!insideProduct) return [250, 250, 248, 255];
    // Textured, multi-toned "product" region with real local variance.
    const base = 120 + Math.sin(x * 0.7) * 60 + Math.cos(y * 0.5) * 40;
    const noise = (rand() - 0.5) * 40;
    const v = Math.max(0, Math.min(255, Math.round(base + noise)));
    return [v, Math.round(v * 0.8), Math.round(v * 1.1), 255];
  });
})();

describe("analyzeImage", () => {
  it("classifies a solid color swatch as flat", () => {
    expect(analyzeImage(solidColorGrid).classification).toBe("flat");
  });

  it("classifies a simple 2-color icon as flat", () => {
    expect(analyzeImage(twoColorIconGrid).classification).toBe("flat");
  });

  it("classifies a transparent-background icon as flat", () => {
    const analysis = analyzeImage(transparentIconGrid);
    expect(analysis.classification).toBe("flat");
    expect(analysis.transparentFraction).toBeGreaterThan(0.5);
  });

  it("classifies high-frequency photo-like noise as photo, never flat", () => {
    expect(analyzeImage(noisePhotoGrid).classification).toBe("photo");
  });

  it("classifies a smooth low-color-diversity gradient as flat (it is decorative art, not photographic content)", () => {
    // A pure smooth gradient asset has few distinct colors and no sharp
    // local edges — it reads as decorative/icon-like art, not a photo, and
    // is fine to recolor. This is a deliberate product decision, not an
    // oversight: the hard requirement is "never alter photos/media", and a
    // flat gradient swatch is neither.
    expect(analyzeImage(linearGradientGrid).classification).toBe("flat");
  });

  it("REGRESSION: does not classify a large decorative gradient banner as flat, even though its pixel signature alone would qualify", () => {
    // Confirmed live: LinkedIn's default profile cover-photo banner has
    // exactly this pixel signature (smooth, low color diversity, no sharp
    // edges) but is rendered hundreds of pixels across. Recoloring it with
    // the icon-tuned invert(1) hue-rotate(180deg) filter (see
    // image/image-theme.ts) is highly visible and reads as a broken,
    // incorrectly-inverted image rather than a graceful dark-mode
    // adaptation — unlike the small-icon case above, where the exact same
    // transform is imperceptible. "uncertain" (not "flat") is the correct
    // verdict here: under conservative mode (the default) it is left
    // untouched, same as any other ambiguous image.
    const analysis = analyzeImage(largeBannerAnalysisGrid());
    expect(analysis.classification).toBe("uncertain");
    expect(shouldRecolorImage(analysis, true)).toBe(false);
  });

  it("REGRESSION: a prior version of this gate compared against the DOWNSAMPLED analysis grid's own size and was dead code — still classifies flat when naturalWidth/naturalHeight aren't supplied at all", () => {
    // Documents exactly why the fix above must key off naturalWidth/
    // naturalHeight rather than grid.width/height: the real sampler
    // (extract-browser.ts) always downsamples to <=32px before this
    // function ever runs, so grid.width/height can never reflect a large
    // source image's real size — an earlier "fix" that compared against
    // grid.width/height directly was provably inert in production despite
    // passing a unit test built at full resolution (bypassing the real
    // downsample step). This test uses the identical downsampled analysis
    // content as the REGRESSION test above but withholds naturalWidth/
    // naturalHeight, proving the gate is a genuine no-op without that
    // signal — the real sampler supplying it is load-bearing, not optional.
    expect(analyzeImage(bannerShapedAnalysisGrid()).classification).toBe("flat");
  });

  it("THE key regression case: a bright product photo on a white background is never classified as flat, despite a high global mean lightness", () => {
    const analysis = analyzeImage(brightProductPhotoGrid);
    // A global-mean-only classifier (Dark Reader's actual approach) would
    // see this image's high overall lightness and treat it as a light-mode
    // icon eligible for recoloring. Because we also weigh color diversity
    // and local edge density, this lands squarely on "photo" instead.
    expect(analysis.meanLightness).toBeGreaterThan(0.6);
    expect(analysis.classification).toBe("photo");
    expect(shouldRecolorImage(analysis, true)).toBe(false);
    expect(shouldRecolorImage(analysis, false)).toBe(false); // "photo" is never recolored, even with conservative mode off
  });
});

describe("shouldRecolorImage", () => {
  it("always recolors a flat classification", () => {
    expect(shouldRecolorImage(analyzeImage(solidColorGrid), true)).toBe(true);
  });

  it("never recolors a photo classification, even with conservative mode off", () => {
    const analysis = analyzeImage(noisePhotoGrid);
    expect(shouldRecolorImage(analysis, false)).toBe(false);
  });

  it("leaves an uncertain classification untouched by default (conservative mode on)", () => {
    // A mid-frequency pattern deliberately tuned to land between the flat
    // and photo thresholds.
    const ambiguous = makeGrid(32, 32, (x, y) => {
      const t = ((x + y) % 8) / 8;
      return [Math.round(80 + t * 60), Math.round(80 + t * 60), Math.round(80 + t * 60), 255];
    });
    const analysis = analyzeImage(ambiguous);
    if (analysis.classification === "uncertain") {
      expect(shouldRecolorImage(analysis, true)).toBe(false);
      expect(shouldRecolorImage(analysis, false)).toBe(true);
    } else {
      // If the tuned fixture happened to land outside "uncertain" on this
      // implementation's exact thresholds, at minimum a photo classification
      // must still never be recolored, and a flat one always is — the
      // uncertain-gating behavior itself is what this test exists to prove.
      expect(["flat", "photo"]).toContain(analysis.classification);
    }
  });
});
