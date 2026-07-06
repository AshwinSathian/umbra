import type { SelectorOverride } from "../dom/layer-injector.js";
import { analyzeImage, shouldRecolorImage } from "./classify.js";
import { isProtectedMediaElement } from "./media-guard.js";
import type { PixelGrid } from "./types.js";

/** Given an image URL, returns its decoded pixels, or null if it can't be
 * sampled (failed to load, opaque cross-origin canvas read, etc.) — a null
 * result must always mean "leave untouched", never "assume transparent" or
 * "assume any particular classification". The real implementation
 * (browser-only, using OffscreenCanvas) lives in extract-browser.ts; tests
 * inject a synthetic sampler instead. */
export type ImageSampler = (url: string) => Promise<PixelGrid | null>;

const RECOLOR_FILTER_VALUE = "invert(1) hue-rotate(180deg)";

function escapeAttributeValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
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
 */
export async function planImageOverrides(
  doc: Document,
  sampleImage: ImageSampler,
  conservativeMode = true,
): Promise<SelectorOverride[]> {
  const overrides: SelectorOverride[] = [];
  const seenSelectors = new Set<string>();

  const images = Array.from(doc.querySelectorAll("img"));
  for (const img of images) {
    if (isProtectedMediaElement(img)) continue; // defensive — img never matches, keeps the invariant explicit at every call site

    const src = img.currentSrc || img.getAttribute("src");
    if (!src) continue;

    const selectorText = `img[src="${escapeAttributeValue(src)}"]`;
    if (seenSelectors.has(selectorText)) continue;

    const grid = await sampleImage(src);
    if (!grid) continue; // failed/unresolved load — never guess

    const analysis = analyzeImage(grid);
    if (!shouldRecolorImage(analysis, conservativeMode)) continue;

    seenSelectors.add(selectorText);
    overrides.push({ selectorText, properties: [{ property: "filter", value: RECOLOR_FILTER_VALUE }] });
  }

  return overrides;
}
