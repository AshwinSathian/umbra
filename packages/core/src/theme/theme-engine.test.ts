import { beforeEach, describe, expect, it } from "vitest";
import { contrastRatio } from "../color/contrast.js";
import { parseCssColor } from "../color/parse.js";
import { clearCrossOriginSheetCache, warmCrossOriginSheetCache } from "../dom/cross-origin-cache.js";
import { OriginalValueCache } from "../dom/original-value-cache.js";
import { computeTheme } from "./theme-engine.js";

describe("computeTheme", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
    document.documentElement.style.removeProperty("color-scheme");
    clearCrossOriginSheetCache();
  });

  it("returns no overrides at all for a page that already declares native dark support", () => {
    const meta = document.createElement("meta");
    meta.name = "color-scheme";
    meta.content = "dark";
    document.head.appendChild(meta);

    const style = document.createElement("style");
    style.textContent = "body { background-color: #ffffff; }";
    document.head.appendChild(style);

    const result = computeTheme(document);
    expect(result.isNativeDark).toBe(true);
    expect(result.overridesByRoot.size).toBe(0);
    expect(result.directRewrites.length).toBe(0);
  });

  it("recolors a white background toward the dark pole", () => {
    const style = document.createElement("style");
    style.textContent = "body { background-color: #ffffff; }";
    document.head.appendChild(style);

    const result = computeTheme(document);
    expect(result.directRewrites.length).toBe(1);
    const rewrite = result.directRewrites[0]!;
    expect(rewrite.property).toBe("background-color");
    const recolored = parseCssColor(rewrite.value)!;
    expect(recolored.r).toBeLessThan(0.3);
    expect(recolored.g).toBeLessThan(0.3);
    expect(recolored.b).toBeLessThan(0.3);
  });

  it("recolors black text toward the light pole and guarantees WCAG AA contrast", () => {
    const style = document.createElement("style");
    style.textContent = "p { color: #000000; }";
    document.head.appendChild(style);

    const result = computeTheme(document);
    const rewrite = result.directRewrites.find((r) => r.property === "color")!;
    expect(rewrite).toBeDefined();
    const recolored = parseCssColor(rewrite.value)!;
    expect(recolored.r).toBeGreaterThan(0.6);

    const assumedBackground = { r: 0.22, g: 0.22, b: 0.22 };
    expect(contrastRatio(recolored, assumedBackground)).toBeGreaterThanOrEqual(4.45);
  });

  it("skips fully transparent colors", () => {
    const style = document.createElement("style");
    style.textContent = "div { background-color: transparent; }";
    document.head.appendChild(style);

    const result = computeTheme(document);
    expect(result.directRewrites.length).toBe(0);
  });

  it("groups overrides by root, so a shadow root gets its own override list", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    const shadowStyle = document.createElement("style");
    shadowStyle.textContent = ".card { background-color: white; }";
    shadow.appendChild(shadowStyle);

    const docStyle = document.createElement("style");
    docStyle.textContent = "body { background-color: white; }";
    document.head.appendChild(docStyle);

    const result = computeTheme(document);
    expect(result.overridesByRoot.has(shadow)).toBe(true);
    expect(result.overridesByRoot.has(document)).toBe(true);
    expect(result.overridesByRoot.get(shadow)![0]!.selectorText).toBe(".card");
  });

  it("themes a cross-origin stylesheet once resolved via the cross-origin cache, via overridesByRoot but never directRewrites", async () => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://cdn.example.com/styles.css";
    document.head.appendChild(link);

    await warmCrossOriginSheetCache(document, async () => "h1 { background-color: #ffffff; }");

    const result = computeTheme(document);
    const docOverrides = result.overridesByRoot.get(document) ?? [];
    expect(docOverrides.some((o) => o.selectorText === "h1")).toBe(true);
    // No live rule object exists for a detached cross-origin sheet, so it
    // must never appear in the CSSOM-direct-rewrite fallback's instructions.
    expect(result.directRewrites.some((r) => r.property === "background-color")).toBe(false);
  });

  it("REGRESSION: recolors from the true original on every render, not from its own previous output, when the live value has already been overwritten in place", () => {
    // This reproduces a real bug found in a live browser: an inline-style
    // element's declaration is mutated in place (see
    // dom/inline-rewrite-tracker.ts), so on a second render the "current"
    // DOM value a naive read would see is already Darkframe's own prior
    // output. Recoloring that again is not a no-op — the pole-based remap
    // is a contraction toward a fixed point, not idempotent — which
    // caused the recolored value to drift by a tiny amount on every
    // mutation-triggered re-render, forever, pinning a live tab's CPU.
    const el = document.createElement("div");
    el.setAttribute("style", "background-color: #ffffff;");
    document.body.appendChild(el);

    const cache = new OriginalValueCache();
    const resolve = (style: CSSStyleDeclaration, property: string) => cache.resolve(style, property);

    const firstPass = computeTheme(document, undefined, resolve);
    const firstValue = firstPass.inlineRewrites.find((r) => r.property === "background-color")!.value;

    // Simulate what apply-theme.ts's InlineRewriteTracker actually does:
    // write the recolored value into the live DOM in place.
    el.style.setProperty("background-color", firstValue, "important");

    // A second render, reusing the SAME cache (as apply-theme.ts does
    // across its render() calls), must recompute the exact same value —
    // not a further-shifted one — because it must resolve the *original*
    // #ffffff, not the now-live recolored value.
    const secondPass = computeTheme(document, undefined, resolve);
    const secondValue = secondPass.inlineRewrites.find((r) => r.property === "background-color")?.value;

    expect(secondValue).toBe(firstValue);
  });

  it("preserves the original alpha channel of a semi-transparent color", () => {
    const style = document.createElement("style");
    style.textContent = "div { background-color: rgba(255, 255, 255, 0.5); }";
    document.head.appendChild(style);

    const result = computeTheme(document);
    const rewrite = result.directRewrites[0]!;
    const recolored = parseCssColor(rewrite.value)!;
    expect(recolored.a).toBeCloseTo(0.5, 2);
  });
});
