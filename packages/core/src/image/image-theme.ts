import type { SelectorOverride } from "../dom/layer-injector.js";
import { type ImageAnalysis, analyzeImage, shouldRecolorImage } from "./classify.js";
import { isProtectedMediaElement } from "./media-guard.js";
import type { PixelGrid } from "./types.js";

/**
 * Memoizes classification results by resolved image URL across repeated
 * `planImageOverrides` calls. Without this, every image on the page is
 * re-decoded (`OffscreenCanvas`/`getImageData` in extract-browser.ts —
 * real, non-trivial work) and re-classified on *every* mutation-triggered
 * re-render, even when nothing about that specific image changed — a
 * real, unbounded performance cost on any page with a non-trivial image
 * count and any amount of unrelated DOM churn (class toggles, animations,
 * etc. all trigger a re-render). One instance is created per `applyTheme`
 * call in apply-theme.ts, so it's naturally cleared when the extension is
 * toggled off and back on.
 */
export class ImageAnalysisCache {
  private cache = new Map<string, ImageAnalysis>();

  get(url: string): ImageAnalysis | undefined {
    return this.cache.get(url);
  }

  set(url: string, analysis: ImageAnalysis): void {
    this.cache.set(url, analysis);
  }
}

/** Given an image URL, returns its decoded pixels, or null if it can't be
 * sampled (failed to load, opaque cross-origin canvas read, etc.) — a null
 * result must always mean "leave untouched", never "assume transparent" or
 * "assume any particular classification". The real implementation
 * (browser-only, using OffscreenCanvas) lives in extract-browser.ts; tests
 * inject a synthetic sampler instead. */
export type ImageSampler = (url: string) => Promise<PixelGrid | null>;

const RECOLOR_FILTER_VALUE = "invert(1) hue-rotate(180deg)";

const CONTROL_CHAR_PATTERN = new RegExp("[" + "\\u0000-\\u001f\\u007f" + "]", "g");

/**
 * Escapes a string for safe use inside a double-quoted CSS attribute
 * selector value (`[src="<here>"]`). Escaping only `\` and `"` is *not*
 * sufficient: per the CSS syntax spec, an unescaped literal control
 * character (newline, carriage return, form feed) inside a quoted string
 * terminates the string token early, and everything after it is
 * re-tokenized as fresh CSS — including, in this codebase's case, inside
 * Darkframe's own `!important`-marked `@layer` stylesheet (see
 * dom/layer-injector.ts), which is specifically designed to win the
 * cascade. An `<img src>` containing an embedded control character (e.g.
 * a raw newline byte in attacker-supplied page HTML, followed by
 * `body{background:red!important}`) would otherwise let a malicious page
 * inject arbitrary CSS rules into that trusted stylesheet. Every C0
 * control character and DEL is hex-escaped using the standard CSS escape
 * syntax (a backslash, the hex code point, and a trailing space — valid
 * CSS for escaping any character, not just non-ASCII ones), which cannot
 * be reinterpreted as a string terminator regardless of context.
 */
function escapeAttributeValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(CONTROL_CHAR_PATTERN, (ch) => "\\" + ch.charCodeAt(0).toString(16) + " ");
}

/**
 * `<img>` is a replaced element with no rendered children, so a CSS
 * `filter` applied directly to it recolors only that image — unlike a
 * `background-image`, where `filter` would also recolor any text/children
 * rendered on top of the same element. That ambiguity is why v1 only
 * recolors `<img>` elements; recoloring background-images safely needs a
 * way to isolate just that layer, deferred as follow-up work.
 *
 * Targets images by their own `src` attribute value rather than adding any
 * `id`/`class`/`data-*` marker — zero markup mutation, and every element
 * sharing that exact image (e.g. a repeated icon) is recolored identically
 * for free.
 *
 * Uses the resolved `img.src` IDL property (not `getAttribute("src")`) as
 * the fallback when `currentSrc` isn't populated yet (e.g. a lazy-loaded,
 * off-screen image whose resource-selection algorithm hasn't run). Both
 * `currentSrc` and the `src` property go through URL parsing/resolution,
 * which — unlike a raw attribute read — strips embedded control
 * characters; combined with the escaping above, this is defense in depth
 * against the same control-character injection class.
 */
export async function planImageOverrides(
  doc: Document,
  sampleImage: ImageSampler,
  conservativeMode = true,
  cache?: ImageAnalysisCache,
): Promise<SelectorOverride[]> {
  const overrides: SelectorOverride[] = [];
  const seenSelectors = new Set<string>();

  const images = Array.from(doc.querySelectorAll("img"));
  for (const img of images) {
    if (isProtectedMediaElement(img)) continue; // defensive — img never matches, keeps the invariant explicit at every call site

    const src = img.currentSrc || img.src;
    if (!src) continue;

    const selectorText = `img[src="${escapeAttributeValue(src)}"]`;
    if (seenSelectors.has(selectorText)) continue;

    let analysis = cache?.get(src);
    if (!analysis) {
      const grid = await sampleImage(src);
      if (!grid) continue; // failed/unresolved load — never guess
      analysis = analyzeImage(grid);
      cache?.set(src, analysis);
    }

    if (!shouldRecolorImage(analysis, conservativeMode)) continue;

    seenSelectors.add(selectorText);
    overrides.push({ selectorText, properties: [{ property: "filter", value: RECOLOR_FILTER_VALUE }] });
  }

  return overrides;
}
