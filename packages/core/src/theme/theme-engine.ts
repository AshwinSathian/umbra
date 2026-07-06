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
): ThemeResult {
  const nativeDark = detectNativeDark(doc);
  if (nativeDark.isNativeDark) {
    return { isNativeDark: true, overridesByRoot: new Map(), directRewrites: [], inlineRewrites: [] };
  }

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
        const raw = resolveOriginalValue(rule.style, property);
        if (!raw) continue;

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
    for (const property of ALL_THEMED_PROPERTIES) {
      const raw = resolveOriginalValue(el.style, property);
      if (!raw) continue;

      const value = computeRecoloredValue(raw, property, settings, assumedBackgroundRgb);
      if (!value) continue;

      inlineRewrites.push({ style: el.style, property, value });
    }
  }

  return { isNativeDark: false, overridesByRoot, directRewrites, inlineRewrites };
}
