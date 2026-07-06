import type { CssFetcher } from "../dom/cross-origin-cache.js";
import { warmCrossOriginSheetCache } from "../dom/cross-origin-cache.js";
import {
  type DirectRewriteEntry,
  type SelectorOverride,
  applyDirectRewrite,
  applyLayerTheme,
  buildLayerStylesheetText,
  revertDirectRewrites,
  supportsCascadeLayers,
} from "../dom/layer-injector.js";
import { InlineRewriteTracker } from "../dom/inline-rewrite-tracker.js";
import { type DisposeFn, observeMutations } from "../dom/mutation-tree.js";
import { OriginalValueCache } from "../dom/original-value-cache.js";
import type { ImageSampler } from "../image/image-theme.js";
import { planImageOverrides } from "../image/image-theme.js";
import { DEFAULT_THEME_SETTINGS, type ThemeSettings, computeTheme } from "./theme-engine.js";

/**
 * The single function that touches the live DOM. Computes the theme,
 * applies it via whichever strategy the engine supports (additive `@layer`
 * stylesheet, or CSSOM-direct-rewrite fallback), and keeps it live via the
 * mutation watcher. Returns a disposer that fully reverts every change —
 * used both for toggling the extension off and by tests asserting clean
 * teardown.
 */
export type ApplyThemeOptions = {
  settings?: ThemeSettings;
  /** Overrides the runtime `@layer` feature-detection — used by tests to
   * exercise both application strategies deterministically, and available
   * as an escape hatch if a real browser's feature detection ever
   * misreports on a specific engine version. */
  forceLayerSupport?: boolean;
  /** Enables `<img>` recoloring for images the classifier confidently
   * calls "flat" (icons/logos/solid swatches) — see image/classify.ts.
   * Omitted in tests (no real image decoder in happy-dom); the Chrome/
   * Safari shells pass `sampleImageFromUrl` from extract-browser.ts.
   * Image scanning is deliberately decoupled from the synchronous color
   * render loop: decoding and downsampling every image on a page is much
   * more expensive than a CSSOM pass, so it runs as an independent async
   * task that merges its results in once resolved, rather than blocking
   * (or re-running fully) on every single DOM mutation. Only requires
   * `@layer` support — image overrides have no pre-existing rule to
   * mutate in place, so the CSSOM-direct-rewrite fallback has no
   * equivalent path for them; on an engine without Cascade Layers, images
   * are simply left untouched (a safe failure mode, not a broken one). */
  imageSampler?: ImageSampler;
  imageConservativeMode?: boolean;
  /** Enables resolving cross-origin `<link>` stylesheets (blocked from
   * direct CSSOM access by CORS) via a background-fetch round-trip — see
   * dom/cross-origin-cache.ts. Like image scanning, this runs as an
   * independent async task decoupled from the synchronous render loop
   * (a network round-trip has no place blocking a CSSOM pass), merging in
   * once resolved rather than on every mutation. */
  cssFetcher?: CssFetcher;
};

export function applyTheme(
  doc: Document,
  win: Window = doc.defaultView as Window,
  options: ApplyThemeOptions = {},
): DisposeFn {
  const settings = options.settings ?? DEFAULT_THEME_SETTINGS;
  const useLayers = options.forceLayerSupport ?? supportsCascadeLayers(win);
  const imageConservativeMode = options.imageConservativeMode ?? true;

  const layerDisposersByRoot = new Map<Document | ShadowRoot, DisposeFn>();
  let directRewriteEntries: DirectRewriteEntry[] = [];
  const inlineTracker = new InlineRewriteTracker();
  // Ensures every render recolors from each rule/element's true original
  // value, never from our own previous output — see original-value-cache.ts
  // for why this is load-bearing, not an optimization.
  const originalValues = new OriginalValueCache();
  let latestImageOverrides: SelectorOverride[] = [];
  let imageScanInFlight = false;
  let crossOriginScanInFlight = false;
  let disposed = false;

  function renderLayerPath(overridesByRoot: ReturnType<typeof computeTheme>["overridesByRoot"]) {
    const nextRoots = new Set(overridesByRoot.keys());

    for (const [root, dispose] of layerDisposersByRoot) {
      if (!nextRoots.has(root)) {
        dispose();
        layerDisposersByRoot.delete(root);
      }
    }

    for (const [root, overrides] of overridesByRoot) {
      const cssText = buildLayerStylesheetText(overrides);
      // applyLayerTheme updates the existing managed element in place when
      // one is already present, so a root that persists across renders
      // gets a single textContent write, not a remove+recreate churn.
      const dispose = applyLayerTheme(root, cssText);
      layerDisposersByRoot.set(root, dispose);
    }
  }

  function renderDirectRewritePath(directRewrites: ReturnType<typeof computeTheme>["directRewrites"]) {
    // CSSOM rule-declaration mutations are invisible to MutationObserver
    // (it only observes DOM tree/attribute/text changes), so reverting and
    // reapplying here never re-triggers the mutation watcher below.
    revertDirectRewrites(directRewriteEntries);
    directRewriteEntries = directRewrites.map((r) => applyDirectRewrite(r.style, r.property, r.value));
  }

  function renderInlineRewrites(inlineRewrites: ReturnType<typeof computeTheme>["inlineRewrites"]) {
    // Inline styles have no selector to hang an additive `@layer` override
    // off, so they're rewritten in place unconditionally, regardless of
    // which strategy the stylesheet pass uses. Unlike a stylesheet rule's
    // `.style` (invisible to MutationObserver), mutating an element's
    // inline `style` fires a real `style`-attribute mutation record that
    // dom/mutation-tree.ts is watching — so this uses the idempotent
    // tracker (only writes what actually changed) instead of an
    // unconditional revert+reapply, which would otherwise retrigger the
    // observer and loop forever. See dom/inline-rewrite-tracker.ts.
    inlineTracker.sync(inlineRewrites);
  }

  function maybeScanImages() {
    if (!options.imageSampler || imageScanInFlight || !useLayers) return;
    imageScanInFlight = true;
    planImageOverrides(doc, options.imageSampler, imageConservativeMode)
      .then((overrides) => {
        imageScanInFlight = false;
        if (disposed) return;
        latestImageOverrides = overrides;
        // Re-render to merge the freshly-scanned image overrides in, but
        // without requesting yet another scan of either kind — only a
        // genuine page mutation (via the observer below) should trigger a
        // re-scan, or this would loop forever re-scanning after every scan
        // completes.
        render(false, false);
      })
      .catch(() => {
        imageScanInFlight = false;
      });
  }

  function maybeWarmCrossOriginSheets() {
    if (!options.cssFetcher || crossOriginScanInFlight) return;
    crossOriginScanInFlight = true;
    warmCrossOriginSheetCache(doc, options.cssFetcher)
      .then((changed) => {
        crossOriginScanInFlight = false;
        if (disposed || !changed) return;
        // Same reasoning as the image scan: re-render to pick up the
        // newly-cached sheets, but don't cascade into another scan.
        render(false, false);
      })
      .catch(() => {
        crossOriginScanInFlight = false;
      });
  }

  function render(shouldScanImages = true, shouldScanCrossOrigin = true) {
    const result = computeTheme(doc, settings, (style, property) => originalValues.resolve(style, property));

    if (result.isNativeDark) {
      renderLayerPath(new Map());
      revertDirectRewrites(directRewriteEntries);
      directRewriteEntries = [];
      inlineTracker.revertAll();
      return;
    }

    if (useLayers) {
      const docOverrides = result.overridesByRoot.get(doc) ?? [];
      const merged = new Map(result.overridesByRoot);
      if (latestImageOverrides.length > 0) {
        merged.set(doc, [...docOverrides, ...latestImageOverrides]);
      }
      renderLayerPath(merged);
    } else {
      renderDirectRewritePath(result.directRewrites);
    }

    renderInlineRewrites(result.inlineRewrites);

    if (shouldScanImages) {
      maybeScanImages();
    }
    if (shouldScanCrossOrigin) {
      maybeWarmCrossOriginSheets();
    }
  }

  render();
  const stopWatching = observeMutations(doc, render);

  return () => {
    disposed = true;
    stopWatching();
    for (const dispose of layerDisposersByRoot.values()) dispose();
    layerDisposersByRoot.clear();
    revertDirectRewrites(directRewriteEntries);
    directRewriteEntries = [];
    inlineTracker.revertAll();
  };
}
