import { DEFAULT_ADJUSTMENTS, type ThemeAdjustments, applyAdjustments } from "../color/adjustments.js";
import { contrastRatio } from "../color/contrast.js";
import { solveContrastingColor } from "../color/contrast-solver.js";
import { formatCssColor } from "../color/format.js";
import { oklchToSrgbGamutMapped, srgbToOklch } from "../color/oklch.js";
import { parseCssColor } from "../color/parse.js";
import {
  DEFAULT_BACKGROUND_POLES,
  DEFAULT_FOREGROUND_POLES,
  type LightnessPoles,
  recolorForRole,
} from "../color/recolor.js";
import type { RGB } from "../color/types.js";
import { getCachedCrossOriginSheet } from "../dom/cross-origin-cache.js";
import { findInlineStyledElements } from "../dom/inline-style-scan.js";
import type { PropertyOverride, SelectorOverride } from "../dom/layer-injector.js";
import { discoverStylesheets, walkStyleRules } from "../dom/style-discovery.js";
import { detectNativeDark } from "../site-detect/native-dark.js";

export type ThemeSettings = {
  backgroundPoles: LightnessPoles;
  foregroundPoles: LightnessPoles;
  /** WCAG 2.1 contrast ratio text must meet against the theme's typical
   * background, enforced as a backstop even when the pole-based remap
   * alone would not reach it (rare — see ensureForegroundContrast). */
  contrastTarget: number;
  adjustments: ThemeAdjustments;
};

export const DEFAULT_THEME_SETTINGS: ThemeSettings = {
  backgroundPoles: DEFAULT_BACKGROUND_POLES,
  foregroundPoles: DEFAULT_FOREGROUND_POLES,
  contrastTarget: 4.5,
  adjustments: DEFAULT_ADJUSTMENTS,
};

const BACKGROUND_PROPERTIES = [
  "background-color",
  "border-color",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "outline-color",
] as const;

const FOREGROUND_PROPERTIES = ["color", "text-decoration-color", "caret-color"] as const;

const ALL_THEMED_PROPERTIES: readonly string[] = [...BACKGROUND_PROPERTIES, ...FOREGROUND_PROPERTIES];

/**
 * Maps each color longhand to the shorthand that can also carry it (`color`
 * and `caret-color` have no shorthand form, so they're absent). Used only
 * as a fallback when the longhand's own CSSOM value is empty — see
 * `resolveShorthandVarFallback` below for why that happens and why the
 * fallback is safe.
 */
const SHORTHAND_FOR_PROPERTY: Partial<Record<string, string>> = {
  "background-color": "background",
  "border-color": "border",
  "border-top-color": "border-top",
  "border-right-color": "border-right",
  "border-bottom-color": "border-bottom",
  "border-left-color": "border-left",
  "outline-color": "outline",
  "text-decoration-color": "text-decoration",
};

const TRANSPARENT_ALPHA_THRESHOLD = 0.02;
const NO_OP_CHANNEL_EPSILON = 1 / 255;

export type DirectRewriteInstruction = { style: CSSStyleDeclaration; property: string; value: string };

export type ThemeResult = {
  isNativeDark: boolean;
  /** Grouped by the root (Document or ShadowRoot) they must be injected
   * into — shadow DOM styling is encapsulated, so each root needs its own
   * `@layer` stylesheet. Used on the Cascade-Layers-supported path. */
  overridesByRoot: Map<Document | ShadowRoot, SelectorOverride[]>;
  /** The same computed overrides, referencing the exact live stylesheet
   * rule's style declaration instead of selector text, for the
   * CSSOM-direct-rewrite fallback path used when Cascade Layers are
   * unsupported. */
  directRewrites: DirectRewriteInstruction[];
  /** Recolored `style="..."` attribute declarations. Applied the same way
   * on *every* engine, `@layer`-capable or not: an inline style has no
   * selector to hang an additive override rule off, so there is no
   * non-destructive equivalent for it — direct (but !important, fully
   * revertible) mutation is the only mechanism available. */
  inlineRewrites: DirectRewriteInstruction[];
};

function isRoughlyUnchanged(original: RGB, recolored: RGB): boolean {
  return (
    Math.abs(original.r - recolored.r) < NO_OP_CHANNEL_EPSILON &&
    Math.abs(original.g - recolored.g) < NO_OP_CHANNEL_EPSILON &&
    Math.abs(original.b - recolored.b) < NO_OP_CHANNEL_EPSILON
  );
}

/**
 * The pole-based remap alone (see recolor.ts) almost always produces ample
 * contrast, since the foreground pole range sits far above the background
 * pole range by construction. This is the backstop for the rare case where
 * it doesn't — e.g. a low-chroma color remapped close to the assumed
 * background's own lightness. Rather than accept a static assumption, it
 * re-solves in OKLCH space, holding the already-chosen hue and chroma
 * fixed, for the *actual* minimum move needed to hit the target ratio.
 */
function ensureForegroundContrast(candidate: RGB, backgroundRgb: RGB, targetRatio: number): RGB {
  if (contrastRatio(candidate, backgroundRgb) >= targetRatio) {
    return candidate;
  }
  const oklch = srgbToOklch(candidate);
  return solveContrastingColor(backgroundRgb, oklch.h, oklch.c, targetRatio, "lighter");
}

/**
 * Computes the recolored CSS value for one declared property, or null if
 * it's unparseable, effectively transparent, or would be a no-op change.
 * Shared by both the stylesheet-rule pass and the inline-style pass so the
 * two can never silently drift into different recoloring behavior.
 */
function computeRecoloredValue(
  raw: string,
  property: string,
  settings: ThemeSettings,
  assumedBackgroundRgb: RGB,
): string | null {
  const parsed = parseCssColor(raw);
  if (!parsed || parsed.a < TRANSPARENT_ALPHA_THRESHOLD) return null;

  const isForeground = (FOREGROUND_PROPERTIES as readonly string[]).includes(property);
  const poles = isForeground ? settings.foregroundPoles : settings.backgroundPoles;
  let recolored = recolorForRole(parsed, isForeground ? "foreground" : "background", poles);
  recolored = applyAdjustments(recolored, settings.adjustments);

  if (isForeground) {
    recolored = ensureForegroundContrast(recolored, assumedBackgroundRgb, settings.contrastTarget);
  }

  if (isRoughlyUnchanged(parsed, recolored)) return null;

  return formatCssColor({ ...recolored, a: parsed.a });
}

/**
 * Reads the "true original" declared value for `property` on `style`,
 * rather than trusting a live DOM read at face value. This matters
 * specifically for the CSSOM-direct-rewrite fallback path and inline
 * styles: both mutate a `CSSStyleDeclaration` *in place*, so a live
 * `getPropertyValue` on a second render would return *our own previous
 * output*, not the page's authored value — and re-recoloring an
 * already-recolored color is not a no-op (the pole-based remap is a
 * contraction toward a fixed point, not idempotent), which without this
 * indirection caused a real, observed bug: an inline-styled element's
 * color would shift by a fraction of a unit on every mutation-triggered
 * re-render, forever, because floating-point/rounding noise almost never
 * lands on *exactly* the previous value, so the idempotency check in
 * dom/inline-rewrite-tracker.ts never saw two consecutive renders agree —
 * pinning the tab's CPU in a live browser (a case the happy-dom unit tests
 * did not catch, since nothing there iterates renders against real
 * floating-point rounding). Callers (apply-theme.ts) supply a resolver
 * backed by their own first-seen-value cache; the default (a plain live
 * read) is only correct for a single, one-shot computeTheme() call such
 * as in tests.
 */
export type OriginalValueResolver = (style: CSSStyleDeclaration, property: string) => string;

const defaultResolveOriginalValue: OriginalValueResolver = (style, property) => style.getPropertyValue(property);

/**
 * Matches a declared value that is *entirely* a single `var(--name)` or
 * `var(--name, fallback)` reference (optionally whitespace-padded) — the
 * overwhelming majority of real-world custom-property-backed color
 * declarations, including the confirmed MongoDB Atlas case
 * (`background-color: var(--mdb-white)`). A value that combines a `var()`
 * with other syntax (`color-mix(in srgb, var(--x) 50%, white)`, string
 * concatenation, etc.) deliberately does not match — those fall through to
 * the same "leave untouched" behavior as before this resolver existed,
 * rather than risk misinterpreting a compound value.
 */
const SIMPLE_VAR_PATTERN = /^var\(\s*(--[a-zA-Z0-9_-]+)\s*(?:,([\s\S]+))?\)$/;

/**
 * Resolves a `var(--token)`-backed declared value to the literal color it
 * references, by reading the browser's *computed value of the custom
 * property itself* — never the computed value of the target property
 * (`background-color` etc.) that Darkframe recolors. This distinction is
 * load-bearing, not stylistic: reading the target property's computed
 * value would reflect Darkframe's *own* previously-applied `!important`
 * override once one exists, feeding an already-recolored color back in as
 * if it were the original — the pole-based remap is a contraction toward a
 * fixed point, not idempotent (see original-value-cache.ts's doc comment
 * for the identical failure mode this project already fixed once, for
 * inline styles), so this would silently drift the color darker on every
 * render, converging on near-black. Confirmed as a real, reproduced bug in
 * an earlier version of this function before landing on custom-property
 * resolution instead. Reading the *custom property's* computed value has
 * no such risk: Darkframe never writes to a custom property, only to
 * `background-color`/`color`/border/outline longhands (see
 * BACKGROUND_PROPERTIES/FOREGROUND_PROPERTIES above), so `--token`'s
 * computed value is always the page author's, never Darkframe's own
 * output — genuinely safe to recolor from, every render, indefinitely.
 *
 * `parseCssColor` only understands literal hex/rgb/hsl/named syntax and
 * correctly returns null for a bare `var(...)` reference (it has no DOM to
 * resolve a custom property against) — without this step, ANY declaration
 * authored via a design token was silently left untouched entirely. Cheap
 * for the overwhelming majority of declarations that don't reference a
 * custom property at all: callers only invoke this after a
 * `raw.includes("var(")` check, so no extra DOM work happens for plain
 * literal colors.
 */
function resolveVarBackedValue(raw: string, computed: CSSStyleDeclaration | null, depth = 0): string {
  if (!computed || depth > 4) return raw;
  const match = raw.trim().match(SIMPLE_VAR_PATTERN);
  if (!match) return raw;

  const [, varName, fallback] = match;
  const resolved = computed.getPropertyValue(varName!).trim();
  if (resolved) return resolved;
  if (fallback !== undefined) return resolveVarBackedValue(fallback.trim(), computed, depth + 1);
  return raw;
}

/**
 * Reads a color longhand's value the way `computeTheme`'s two passes
 * already do, falling back to its shorthand (`background-color` ->
 * `background`, `border-color` -> `border`, etc. — see
 * SHORTHAND_FOR_PROPERTY) when the longhand itself is empty.
 *
 * The longhand comes back empty — not just absent, genuinely empty even
 * though the color is visibly set — whenever the shorthand contains an
 * unresolved `var()` reference anywhere in it: per the CSS spec, a
 * shorthand with a `var()` in any of its sub-values becomes a "pending-
 * substitution value" that cannot be split into longhands until the
 * variable is resolved, so `style.getPropertyValue("border-color")`
 * returns `""` for a rule declared as `border: 1px solid var(--x)`, even
 * though a literal `border: 1px solid red` splits into longhands
 * completely normally. Confirmed empirically against real Chromium (not
 * assumed) for both stylesheet rules and inline styles — this is a
 * genuine engine-wide gap independent of the `var()`-resolution fix above,
 * not a hypothetical.
 *
 * Only treated as a match when the shorthand's *entire* value is a single
 * `var(--name[, fallback])` reference (reusing SIMPLE_VAR_PATTERN) — e.g.
 * `background: var(--surface)`. That is unambiguous: a bare color value
 * assigned to a shorthand sets that shorthand's color sub-property and
 * resets every other sub-property to its initial value, so there is only
 * one thing the reference could mean. `border: 1px solid var(--x)` does
 * NOT match (there's other content in the shorthand besides the var()), so
 * it deliberately falls through unresolved rather than guess which
 * sub-property the reference was meant for — misattributing it (e.g.
 * treating a border-*width* token as a color) would be worse than leaving
 * it untouched. Even in the case that does match, if the resolved custom
 * property turns out not to be a real color (e.g. someone really did
 * write a bare `--token: 2px dashed red` design token), `parseCssColor`
 * downstream simply returns null and the declaration is left alone — the
 * failure mode is "unrecolored", never "recolored wrong".
 */
function resolveShorthandVarFallback(
  resolveOriginalValue: OriginalValueResolver,
  style: CSSStyleDeclaration,
  property: string,
): string {
  const shorthand = SHORTHAND_FOR_PROPERTY[property];
  if (!shorthand) return "";
  const shorthandRaw = resolveOriginalValue(style, shorthand).trim();
  return SIMPLE_VAR_PATTERN.test(shorthandRaw) ? shorthandRaw : "";
}

/**
 * Matches CSS interaction pseudo-classes that are only ever true for the
 * fleeting moment a user is actually hovering/focusing/activating an
 * element — never during an ordinary render pass. `document.querySelector`
 * happily accepts a selector containing one of these (it's valid CSS), but
 * it can only ever return a match if that transient state is true *right
 * now*, at the exact microtask a render happens to run. In practice that
 * essentially never coincides, so a rule like
 * `a:hover, a:focus { background-color: var(--x); }` — confirmed for real
 * on npmjs.com's account menu, gating `var(--color-bg-inset)` — almost
 * never resolves, leaving the hover/focus highlight at the page's original
 * (light) color sitting inside an otherwise dark-recolored menu. Stripped
 * out as a fallback match target below, since a custom property's value
 * essentially never differs based on whether *this* rule's own pseudo-class
 * is active — it's a design token defined once elsewhere, just referenced
 * here for one particular state.
 *
 * `:visited` is included for a different reason, not transience: browsers
 * deliberately lie about it to scripts as a history-sniffing defense
 * (confirmed — `document.querySelector("a:visited")` returns null even for
 * an actually-visited link), so it has the identical "never matches via
 * querySelector regardless of real state" failure shape as the interaction
 * pseudo-classes above, just for a privacy reason instead of a timing one.
 * Deliberately excludes state pseudo-classes that genuinely do reflect
 * queryable DOM state with no such restriction — `:checked`, `:disabled`,
 * `:required`, `:invalid`, `:target`, etc. — since for those, the ordinary
 * (non-stripped) selector already matches correctly whenever the state is
 * true, so stripping them would only reduce specificity for no benefit.
 */
const INTERACTION_PSEUDO_CLASS_PATTERN = /:(?:hover|focus(?:-visible|-within)?|active|visited)\b/g;

/**
 * Memoized per-root `selectorText -> matched element's computed style`
 * lookup, used only to resolve `var()` references (see
 * resolveVarBackedValue) for stylesheet rules — inline styles already have
 * their own concrete element, so they skip this entirely.
 *
 * Persisted *across* renders (owned by apply-theme.ts, same lifecycle as
 * OriginalValueCache/ImageAnalysisCache) rather than recreated fresh on
 * every computeTheme() call, which is load-bearing for performance, not
 * just a nice-to-have: on a content-heavy page (confirmed via a real-
 * Chromium repro simulating an infinite-scroll job-listing SPA), every
 * mutation-triggered render used to re-run `querySelector` +
 * `getComputedStyle` — a forced synchronous layout — for *every*
 * `var()`-backed rule in the stylesheet, every single time, even though
 * the overwhelming majority of those selectors and their resolved custom-
 * property values hadn't changed at all since the previous render (a page
 * loading more list items doesn't change what `--card-bg` resolves to).
 * That scaled with total page size per render, compounding into real,
 * measured jank (hundreds of milliseconds of forced-layout work across a
 * short scroll session) — see PLAN-darkframe.md.
 *
 * Safe to persist because `getComputedStyle()`'s return value is *live* —
 * confirmed empirically, not assumed: reading a property on a
 * previously-obtained `CSSStyleDeclaration` reference reflects the
 * *current* value, even if the underlying custom property changed after
 * the reference was obtained (e.g. a page toggling its own
 * `[data-theme]` attribute). So caching the reference across renders never
 * risks a stale *value* the way caching a resolved string would. The one
 * real risk is the matched element itself being removed from the DOM
 * (list virtualization is the realistic case) — `resolve()` checks
 * `isConnected` and re-queries when the cached element is gone, so a
 * detached reference (whose computed style silently reverts to initial
 * values once disconnected) never gets reused. Scoped *per root* (not
 * globally) since the same selector text can exist in unrelated shadow
 * roots matching different elements with different resolved
 * custom-property values.
 */
export class VarResolutionCache {
  private byRoot = new WeakMap<Document | ShadowRoot, Map<string, { element: Element; style: CSSStyleDeclaration }>>();

  resolve(root: Document | ShadowRoot, selectorText: string, fallbackWindow: Window | null): CSSStyleDeclaration | null {
    let forRoot = this.byRoot.get(root);
    if (!forRoot) {
      forRoot = new Map();
      this.byRoot.set(root, forRoot);
    }

    // Only a *positive* match (still connected) is safe to reuse. A
    // "nothing matched" result must NOT be cached — confirmed as a real
    // bug found while verifying this fix: content-heavy pages routinely
    // define a class's CSS before that class's element ever exists in the
    // DOM (e.g. a shared stylesheet loaded once, content streamed in via
    // infinite scroll), so a selector that matches nothing on the *first*
    // render may very well match something on a later one. Caching "no
    // match" as permanent would silently and permanently break theming for
    // any such selector the instant it was first checked too early —
    // reproduced directly: a var()-backed class whose defining rule existed
    // before its element did stayed unthemed forever once this cache
    // treated the initial "nothing matched yet" as a settled answer.
    const cached = forRoot.get(selectorText);
    if (cached && cached.element.isConnected) {
      return cached.style;
    }

    let entry: { element: Element; style: CSSStyleDeclaration } | null = null;
    const win = ("defaultView" in root ? root.defaultView : root.ownerDocument?.defaultView) ?? fallbackWindow;
    if (win) {
      try {
        let matched = root.querySelector(selectorText);
        if (!matched) {
          const resting = selectorText.replace(INTERACTION_PSEUDO_CLASS_PATTERN, "");
          if (resting !== selectorText && resting.trim()) matched = root.querySelector(resting);
        }
        if (matched) {
          entry = { element: matched, style: win.getComputedStyle(matched) };
        }
      } catch {
        // Invalid/unsupported selector syntax (rare — e.g. a vendor-
        // specific pseudo-element) — leave unresolved, same as before this
        // class existed.
      }
    }
    // Retrying `querySelector` on every render for a selector that never
    // matches anything (a real cost on a huge shared CSS bundle where many
    // classes genuinely don't apply to the current page) is still far
    // cheaper than the `getComputedStyle` call this cache exists to avoid:
    // selector matching is a structural DOM-tree query with no dependency
    // on computed style/layout, unlike `getComputedStyle`, which forces a
    // synchronous style recalculation. So only caching positive matches
    // keeps the actually-expensive part of this bounded, without ever
    // risking a selector getting silently and permanently stuck unthemed.
    if (entry) forRoot.set(selectorText, entry);
    return entry?.style ?? null;
  }
}

/**
 * Computes the full theme for a document: native-dark detection first
 * (short-circuiting to no overrides at all if the page already ships its
 * own dark theme), then a pass over every discovered stylesheet's rules,
 * and a separate pass over every element's inline `style` attribute,
 * recoloring `color`/`background-color`/border/outline declarations in
 * both. Pure *output* (the DOM is never mutated by this function itself;
 * see dom/layer-injector.ts and dom/mutation-tree.ts for that) but not a
 * pure function of the DOM snapshot alone when a `resolveOriginalValue`
 * is supplied — see {@link OriginalValueResolver}.
 */
export function computeTheme(
  doc: Document,
  settings: ThemeSettings = DEFAULT_THEME_SETTINGS,
  resolveOriginalValue: OriginalValueResolver = defaultResolveOriginalValue,
  varResolutionCache: VarResolutionCache = new VarResolutionCache(),
): ThemeResult {
  const nativeDark = detectNativeDark(doc);
  if (nativeDark.isNativeDark) {
    return { isNativeDark: true, overridesByRoot: new Map(), directRewrites: [], inlineRewrites: [] };
  }

  const fallbackWindow = doc.defaultView;

  // A representative neutral dark background, used only as the contrast
  // backstop's comparison point (see ensureForegroundContrast) — not as
  // the sole basis for recoloring, which always uses each rule's own
  // actual declared color. Adjustments are applied here too, since the
  // backstop must guarantee contrast against the background the user will
  // actually see (post-adjustment), not the pre-adjustment tone.
  const assumedBackgroundRgb = applyAdjustments(
    oklchToSrgbGamutMapped({ l: settings.backgroundPoles.high, c: 0, h: 0 }),
    settings.adjustments,
  );

  const overridesByRoot = new Map<Document | ShadowRoot, SelectorOverride[]>();
  const directRewrites: DirectRewriteInstruction[] = [];
  const inlineRewrites: DirectRewriteInstruction[] = [];

  for (const discovered of discoverStylesheets(doc)) {
    // A same-origin/accessible sheet's rules can be mutated in place (the
    // CSSOM-fallback path); a cross-origin sheet resolved via the
    // background-fetch cache is a *detached* parsed copy — its rules are
    // real for selector-text-based `@layer` overrides, but mutating them
    // directly would touch nothing visible, so those never feed directRewrites.
    const isLiveSheet = discovered.sheet !== null;
    const sheet = discovered.sheet ?? (discovered.href ? getCachedCrossOriginSheet(discovered.href) : undefined);
    if (!sheet) continue;

    const selectorOverrides: SelectorOverride[] = [];

    walkStyleRules(sheet.cssRules, (rule) => {
      const properties: PropertyOverride[] = [];

      for (const property of ALL_THEMED_PROPERTIES) {
        let raw = resolveOriginalValue(rule.style, property);
        if (!raw) raw = resolveShorthandVarFallback(resolveOriginalValue, rule.style, property);
        if (!raw) continue;
        if (raw.includes("var(")) {
          const computed = varResolutionCache.resolve(discovered.root, rule.selectorText, fallbackWindow);
          raw = resolveVarBackedValue(raw, computed);
        }

        const value = computeRecoloredValue(raw, property, settings, assumedBackgroundRgb);
        if (!value) continue;

        properties.push({ property, value });
        if (isLiveSheet) {
          directRewrites.push({ style: rule.style, property, value });
        }
      }

      if (properties.length > 0) {
        selectorOverrides.push({ selectorText: rule.selectorText, properties });
      }
    });

    if (selectorOverrides.length > 0) {
      const existing = overridesByRoot.get(discovered.root) ?? [];
      overridesByRoot.set(discovered.root, [...existing, ...selectorOverrides]);
    }
  }

  for (const el of findInlineStyledElements(doc)) {
    // An inline style already has its own concrete element — no selector
    // lookup needed, unlike the stylesheet-rule pass above.
    const elWindow = el.ownerDocument.defaultView ?? doc.defaultView;
    for (const property of ALL_THEMED_PROPERTIES) {
      let raw = resolveOriginalValue(el.style, property);
      if (!raw) raw = resolveShorthandVarFallback(resolveOriginalValue, el.style, property);
      if (!raw) continue;
      if (raw.includes("var(") && elWindow) {
        raw = resolveVarBackedValue(raw, elWindow.getComputedStyle(el));
      }

      const value = computeRecoloredValue(raw, property, settings, assumedBackgroundRgb);
      if (!value) continue;

      inlineRewrites.push({ style: el.style, property, value });
    }
  }

  return { isNativeDark: false, overridesByRoot, directRewrites, inlineRewrites };
}
