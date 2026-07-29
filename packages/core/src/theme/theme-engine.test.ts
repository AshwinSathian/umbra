import { beforeEach, describe, expect, it, vi } from "vitest";
import { contrastRatio } from "../color/contrast.js";
import { parseCssColor } from "../color/parse.js";
import { clearCrossOriginSheetCache, warmCrossOriginSheetCache } from "../dom/cross-origin-cache.js";
import { OriginalValueCache } from "../dom/original-value-cache.js";
import { DEFAULT_THEME_SETTINGS, RecoloredValueCache, VarResolutionCache, computeTheme } from "./theme-engine.js";

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

  it("resolves a CSS custom property (var()) reference via the matched element's computed style", () => {
    // Reproduces the exact, confirmed cause of MongoDB Atlas's cluster
    // cards staying white under Darkframe: its leafygreen-ui design system
    // emits `background-color: var(--mdb-white)` via an Emotion-injected
    // <style> tag. parseCssColor cannot resolve `var()` itself (it has no
    // DOM to resolve a custom property against — see parse.ts), so this
    // must be resolved before reaching it, via the matched element's real
    // computed style. The custom property is declared on the same rule
    // that uses it (rather than on `:root`, as MongoDB's actual case does)
    // because happy-dom, confirmed experimentally, does not inherit a
    // custom property's computed value down to descendant elements via
    // `getPropertyValue` — real browsers do; this only works around a
    // test-environment gap, exercising the identical resolution code path.
    const style = document.createElement("style");
    style.textContent = ".css-1y5u6ib { --card-bg: #ffffff; background-color: var(--card-bg); }";
    document.head.appendChild(style);
    const card = document.createElement("div");
    card.className = "css-1y5u6ib";
    document.body.appendChild(card);

    const result = computeTheme(document);
    const rewrite = result.directRewrites.find((r) => r.property === "background-color");
    expect(rewrite).toBeDefined();
    const recolored = parseCssColor(rewrite!.value)!;
    expect(recolored.r).toBeLessThan(0.3);
    expect(recolored.g).toBeLessThan(0.3);
    expect(recolored.b).toBeLessThan(0.3);
  });

  it("resolves a var()-backed :hover/:focus rule via the element's resting (non-hovered/focused) state", () => {
    // Reproduces a second real bug found on npmjs.com's account dropdown menu
    // (found while re-verifying the MongoDB fix on another site): npm's
    // `._9e2bd439 a:hover, ._9e2bd439 a:focus { background-color: var(--color-bg-inset); }`
    // gates a design-token background behind an interaction pseudo-class.
    // `document.querySelector` only matches `:hover`/`:focus` while that
    // state is truly, momentarily live — essentially never during a render
    // pass — so without stripping it, this resolves to nothing on every
    // real render, and the hover/focus highlight is left at the page's
    // original light color sitting inside an otherwise dark-recolored menu
    // (confirmed against a real Chromium instance actually hovering the
    // element, not just this unit test — see PLAN-darkframe.md). happy-dom
    // never reports any element as genuinely `:hover`/`:focus`-matched
    // either, so this test exercises the exact same "selector doesn't
    // match live" condition without needing to simulate real interaction.
    // Custom property declared on the same resting-state selector the
    // stripped fallback will match (rather than :root) — see the happy-dom
    // inheritance-gap note on the var()-resolution tests above.
    const style = document.createElement("style");
    style.textContent =
      ".item a { --hover-bg: #f2f2f2; } .item a:hover, .item a:focus { background-color: var(--hover-bg); }";
    document.head.appendChild(style);
    const link = document.createElement("a");
    const item = document.createElement("li");
    item.className = "item";
    item.appendChild(link);
    document.body.appendChild(item);

    const result = computeTheme(document);
    const rewrite = result.directRewrites.find((r) => r.property === "background-color");
    expect(rewrite).toBeDefined();
    const recolored = parseCssColor(rewrite!.value)!;
    expect(recolored.r).toBeLessThan(0.3);
  });

  it("resolves a var() reference declared through a shorthand whose ENTIRE value is that one reference (e.g. background: var(--x))", () => {
    // Confirmed empirically against real Chromium (not assumed): when a
    // shorthand contains an unresolved var() anywhere in it, its longhand
    // sub-properties read back as "" via CSSOM (a spec-mandated
    // "pending-substitution value" — a literal `border: 1px solid red`
    // splits into longhands completely normally; only a var()-containing
    // shorthand doesn't), so `background: var(--x)` was invisible to the
    // engine even after the var()-resolution fix above, entirely separate
    // from that fix. Only safe to resolve when the shorthand's whole value
    // is nothing but the one reference — see resolveShorthandVarFallback's
    // doc comment for why that's unambiguous.
    const style = document.createElement("style");
    style.textContent = ".surface { --surface-bg: #ffffff; background: var(--surface-bg); }";
    document.head.appendChild(style);
    const el = document.createElement("div");
    el.className = "surface";
    document.body.appendChild(el);

    const result = computeTheme(document);
    const rewrite = result.directRewrites.find((r) => r.property === "background-color");
    expect(rewrite).toBeDefined();
    const recolored = parseCssColor(rewrite!.value)!;
    expect(recolored.r).toBeLessThan(0.3);
  });

  it("does NOT guess a color out of an ambiguous shorthand (border: 1px solid var(--x)) — leaves it untouched rather than risk misattributing the reference", () => {
    // Real Chromium's CSSOM behavior for a multi-token var()-containing
    // shorthand isn't reliably reproducible in happy-dom (confirmed
    // experimentally — happy-dom over-eagerly expands it into longhands,
    // unlike real Chromium's spec-accurate "" result), so this drives
    // computeTheme's injectable resolver directly to exercise exactly the
    // condition that matters: the longhand is empty, and the shorthand's
    // raw value has *other* content besides the var() reference. The width
    // and style tokens mean the reference could resolve to any of the
    // border sub-properties, not necessarily a color — resolving it as if
    // it were border-color would risk being flatly wrong, so the engine
    // must leave it alone instead of guessing.
    const style = document.createElement("style");
    style.textContent = ".card { border: 1px solid red; }";
    document.head.appendChild(style);

    const resolve = (cssStyle: CSSStyleDeclaration, property: string) => {
      if (property === "border-color") return "";
      if (property === "border") return "1px solid var(--line)";
      return cssStyle.getPropertyValue(property);
    };

    const result = computeTheme(document, undefined, resolve);
    expect(result.directRewrites.some((r) => r.property === "border-color")).toBe(false);
  });

  it("leaves a var()-backed declaration untouched (not crashing) when no element currently matches the selector", () => {
    const style = document.createElement("style");
    style.textContent = ":root { --card-bg: #ffffff; } .not-on-page { background-color: var(--card-bg); }";
    document.head.appendChild(style);

    expect(() => computeTheme(document)).not.toThrow();
    const result = computeTheme(document);
    expect(result.directRewrites.some((r) => r.property === "background-color")).toBe(false);
  });

  it("resolves a var()-backed inline style directly via the element's own computed style", () => {
    const el = document.createElement("div");
    // Custom property and its use both on the same element's inline style —
    // see the comment above for why (happy-dom inheritance gap).
    el.setAttribute("style", "--inline-bg: #ffffff; background-color: var(--inline-bg);");
    document.body.appendChild(el);

    const result = computeTheme(document);
    const rewrite = result.inlineRewrites.find((r) => r.property === "background-color");
    expect(rewrite).toBeDefined();
    const recolored = parseCssColor(rewrite!.value)!;
    expect(recolored.r).toBeLessThan(0.3);
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

describe("VarResolutionCache", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });

  it("does not re-run getComputedStyle for a selector already resolved on a previous computeTheme() call, when reusing the same cache instance", () => {
    // Reproduces the fix for real, measured jank on content-heavy pages
    // (reported live on a LinkedIn job-search page — infinite scroll, lots
    // of DOM churn): re-resolving the same var()-backed selector's custom
    // property on every single render, even though its resolved value
    // essentially never changes between renders, meant hundreds of forced-
    // synchronous-layout getComputedStyle calls across a scroll session —
    // see PLAN-darkframe.md. A persistent cache should only ever call
    // getComputedStyle once per selector, no matter how many renders follow.
    const style = document.createElement("style");
    style.textContent = ".card { --bg: #ffffff; background-color: var(--bg); }";
    document.head.appendChild(style);
    const card = document.createElement("div");
    card.className = "card";
    document.body.appendChild(card);

    const getComputedStyleSpy = vi.spyOn(window, "getComputedStyle");
    const cache = new VarResolutionCache();

    computeTheme(document, undefined, undefined, cache);
    const callsAfterFirst = getComputedStyleSpy.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    computeTheme(document, undefined, undefined, cache);
    const callsAfterSecond = getComputedStyleSpy.mock.calls.length;

    computeTheme(document, undefined, undefined, cache);
    const callsAfterThird = getComputedStyleSpy.mock.calls.length;

    // Each render also calls getComputedStyle once for native-dark
    // detection (site-detect/native-dark.ts) — unrelated to var()
    // resolution, uncached, and correctly so (it must reflect the page's
    // *current* state every time). So each subsequent render still adds
    // exactly one call from that — the assertion is that it adds *no more
    // than* that, i.e. zero additional calls from the already-resolved
    // var()-backed selector.
    expect(callsAfterSecond - callsAfterFirst).toBe(1);
    expect(callsAfterThird - callsAfterSecond).toBe(1);
    getComputedStyleSpy.mockRestore();
  });

  it("re-resolves fresh (self-heals) if the previously-matched element is later removed from the DOM, instead of reusing a now-detached reference", () => {
    // The realistic trigger for this: list virtualization on a long
    // scrolling page recycles/removes off-screen elements — a cached
    // reference to a *removed* element would silently report stale/initial
    // computed values instead of the design token's real value.
    const style = document.createElement("style");
    style.textContent = ".card { --bg: #ffffff; background-color: var(--bg); }";
    document.head.appendChild(style);
    const firstCard = document.createElement("div");
    firstCard.className = "card";
    document.body.appendChild(firstCard);

    const cache = new VarResolutionCache();
    const firstResult = computeTheme(document, undefined, undefined, cache);
    expect(firstResult.directRewrites.some((r) => r.property === "background-color")).toBe(true);

    firstCard.remove();
    const secondCard = document.createElement("div");
    secondCard.className = "card";
    document.body.appendChild(secondCard);

    const secondResult = computeTheme(document, undefined, undefined, cache);
    const rewrite = secondResult.directRewrites.find((r) => r.property === "background-color");
    expect(rewrite).toBeDefined();
    const recolored = parseCssColor(rewrite!.value)!;
    expect(recolored.r).toBeLessThan(0.3);
  });

  it("REGRESSION: a selector that matches nothing on an early render still gets resolved once a matching element appears later, instead of being permanently stuck unthemed", () => {
    // A real, serious bug found while verifying the fix above against a
    // real Chromium instance: content-heavy pages routinely define a
    // class's CSS (in a shared stylesheet, or via a bulk insertRule() burst
    // ahead of the content that will use it) before any element with that
    // class exists in the DOM yet. An earlier version of this cache
    // treated a "nothing matched" result as a permanent, reusable answer —
    // so the very first check, made before the matching element existed,
    // would silently and permanently prevent that selector from ever being
    // themed, even once a real matching element showed up on every
    // subsequent render.
    const style = document.createElement("style");
    style.textContent = ".late-card { --bg: #ffffff; background-color: var(--bg); }";
    document.head.appendChild(style);

    const cache = new VarResolutionCache();
    const beforeElementExists = computeTheme(document, undefined, undefined, cache);
    expect(beforeElementExists.directRewrites.some((r) => r.property === "background-color")).toBe(false);

    const card = document.createElement("div");
    card.className = "late-card";
    document.body.appendChild(card);

    const afterElementExists = computeTheme(document, undefined, undefined, cache);
    const rewrite = afterElementExists.directRewrites.find((r) => r.property === "background-color");
    expect(rewrite).toBeDefined();
    const recolored = parseCssColor(rewrite!.value)!;
    expect(recolored.r).toBeLessThan(0.3);
  });

  it("PERF REGRESSION: reuses the memoized recolor output for a repeated (property, raw value) pair across many rules instead of resolving each independently", () => {
    // A real stylesheet overwhelmingly repeats a small design-token palette
    // across hundreds/thousands of selectors. Without RecoloredValueCache,
    // the identical OKLCH/gamut-mapping/contrast-solve pipeline reruns once
    // per rule regardless — this asserts the *output* stays correct when a
    // shared cache is reused across many identical declarations (the
    // dedicated RecoloredValueCache describe block below asserts the actual
    // recompute is skipped via a spy).
    const style = document.createElement("style");
    style.textContent = Array.from({ length: 50 }, (_, i) => `.card-${i} { background-color: #ffffff; }`).join("\n");
    document.head.appendChild(style);

    const cache = new RecoloredValueCache();
    const result = computeTheme(document, undefined, undefined, undefined, cache);
    expect(result.directRewrites.length).toBe(50);
    const values = new Set(result.directRewrites.map((r) => r.value));
    expect(values.size).toBe(1); // every rule shares the identical recolored output
  });
});

describe("RecoloredValueCache", () => {
  it("skips recompute for a repeated (property, raw) pair", () => {
    const cache = new RecoloredValueCache();
    const compute = vi.fn(() => "rgb(1, 2, 3)");

    expect(cache.resolve("#ffffff", "background-color", DEFAULT_THEME_SETTINGS, compute)).toBe("rgb(1, 2, 3)");
    expect(cache.resolve("#ffffff", "background-color", DEFAULT_THEME_SETTINGS, compute)).toBe("rgb(1, 2, 3)");
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("treats the same raw value differently per property (background vs. foreground recolor differently)", () => {
    const cache = new RecoloredValueCache();
    const computeBg = vi.fn(() => "bg-result");
    const computeFg = vi.fn(() => "fg-result");

    expect(cache.resolve("#ffffff", "background-color", DEFAULT_THEME_SETTINGS, computeBg)).toBe("bg-result");
    expect(cache.resolve("#ffffff", "color", DEFAULT_THEME_SETTINGS, computeFg)).toBe("fg-result");
    expect(computeBg).toHaveBeenCalledTimes(1);
    expect(computeFg).toHaveBeenCalledTimes(1);
  });

  it("memoizes a null (no-op / unchanged) result too, not just a truthy recolored value", () => {
    const cache = new RecoloredValueCache();
    const compute = vi.fn(() => null);

    expect(cache.resolve("transparent", "background-color", DEFAULT_THEME_SETTINGS, compute)).toBeNull();
    expect(cache.resolve("transparent", "background-color", DEFAULT_THEME_SETTINGS, compute)).toBeNull();
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("invalidates every entry when the settings reference changes (e.g. the user adjusts a slider), never serving output computed under stale settings", () => {
    const cache = new RecoloredValueCache();
    const settingsA = { ...DEFAULT_THEME_SETTINGS };
    const settingsB = { ...DEFAULT_THEME_SETTINGS };
    const computeUnderA = vi.fn(() => "under-a");
    const computeUnderB = vi.fn(() => "under-b");

    expect(cache.resolve("#ffffff", "background-color", settingsA, computeUnderA)).toBe("under-a");
    // Same raw+property, but settings identity changed — must not reuse "under-a".
    expect(cache.resolve("#ffffff", "background-color", settingsB, computeUnderB)).toBe("under-b");
    expect(computeUnderB).toHaveBeenCalledTimes(1);
  });
});
