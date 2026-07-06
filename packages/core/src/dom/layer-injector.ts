export type PropertyOverride = { property: string; value: string };
export type SelectorOverride = { selectorText: string; properties: PropertyOverride[] };

export const MANAGED_STYLE_ID = "umbra-theme-layer";
export const MANAGED_STYLE_MARKER_ATTR = "data-umbra-managed";
const LAYER_NAME = "umbra";

/**
 * Generates the CSS text for a single additive `@layer umbra { ... }`
 * stylesheet from a set of per-selector property overrides.
 *
 * Every declaration is marked `!important`. This is required, not
 * decorative: per the CSS cascade spec, an unlayered author rule always
 * beats a layered author rule at normal importance regardless of
 * specificity, so a plain (non-important) `@layer` block would silently
 * lose to the page's own (unlayered) CSS. `!important` inverts that
 * precedence in our favor for the common case, while the override still
 * lives in exactly one additive stylesheet — original stylesheets are
 * never mutated on this path.
 */
export function buildLayerStylesheetText(overrides: SelectorOverride[]): string {
  const body = overrides
    .map((o) => {
      const decls = o.properties.map((p) => `  ${p.property}: ${p.value} !important;`).join("\n");
      return `${o.selectorText} {\n${decls}\n}`;
    })
    .join("\n");
  return `@layer ${LAYER_NAME} {\n${body}\n}`;
}

/**
 * Feature-detects real Cascade Layer support by constructing a stylesheet
 * and checking the parsed rule's type, rather than trusting `CSS.supports`
 * (which has no reliable one-shot query for at-rule support). Returns
 * false — triggering the CSSOM-rewrite fallback — on any engine where this
 * throws or produces an unexpected rule type.
 */
export function supportsCascadeLayers(win: Window): boolean {
  try {
    const CSSStyleSheetCtor = (win as unknown as { CSSStyleSheet?: typeof CSSStyleSheet }).CSSStyleSheet;
    const LayerBlockRuleCtor = (win as unknown as { CSSLayerBlockRule?: unknown }).CSSLayerBlockRule;
    if (!CSSStyleSheetCtor || !LayerBlockRuleCtor) return false;

    const sheet = new CSSStyleSheetCtor();
    sheet.insertRule(`@layer ${LAYER_NAME}-feature-test { }`);
    return sheet.cssRules[0] instanceof (LayerBlockRuleCtor as new () => unknown);
  } catch {
    return false;
  }
}

function getInsertionParent(root: Document | ShadowRoot): Element | ShadowRoot {
  if ("head" in root) {
    return (root as Document).head ?? (root as Document).documentElement;
  }
  return root;
}

/**
 * Injects (or replaces) exactly one managed `<style>` element into `root`
 * containing `cssText`. Works identically for a `Document` (inserted into
 * `<head>`) and a `ShadowRoot` (inserted directly into the root) — shadow
 * DOM styling is encapsulated, so a document-level stylesheet never reaches
 * elements inside a shadow root, and each root with themeable content needs
 * its own managed style element. Returns a disposer that fully removes it.
 */
export function applyLayerTheme(root: Document | ShadowRoot, cssText: string): () => void {
  const ownerDoc = "ownerDocument" in root && root.ownerDocument ? root.ownerDocument : (root as Document);
  const existing = (root as ParentNode).querySelector(`#${MANAGED_STYLE_ID}`) as HTMLStyleElement | null;
  const styleEl = existing ?? ownerDoc.createElement("style");

  if (!existing) {
    styleEl.id = MANAGED_STYLE_ID;
    styleEl.setAttribute(MANAGED_STYLE_MARKER_ATTR, "true");
    getInsertionParent(root).appendChild(styleEl);
  }
  styleEl.textContent = cssText;

  return () => {
    styleEl.remove();
  };
}

export type DirectRewriteEntry = {
  style: CSSStyleDeclaration;
  property: string;
  originalValue: string;
  originalPriority: string;
};

/**
 * CSSOM-rewrite-in-place fallback for engines without Cascade Layer
 * support: mutates a live `CSSStyleDeclaration` directly (the same
 * strategy Dark Reader uses everywhere) and returns enough information to
 * revert it exactly. Takes a bare `CSSStyleDeclaration` rather than a
 * `CSSStyleRule` specifically so the exact same function handles both
 * stylesheet rules (`rule.style`) and an element's inline `style`
 * attribute (`element.style`) — both are `CSSStyleDeclaration` objects
 * with an identical API. Used unconditionally for inline styles (which
 * have no selector to hang an `@layer` override off) and used for
 * stylesheet rules only when {@link supportsCascadeLayers} is false.
 */
export function applyDirectRewrite(
  style: CSSStyleDeclaration,
  property: string,
  newValue: string,
): DirectRewriteEntry {
  const originalValue = style.getPropertyValue(property);
  const originalPriority = style.getPropertyPriority(property);
  style.setProperty(property, newValue, "important");
  return { style, property, originalValue, originalPriority };
}

export function revertDirectRewrites(entries: DirectRewriteEntry[]): void {
  for (const entry of entries) {
    if (entry.originalValue) {
      entry.style.setProperty(entry.property, entry.originalValue, entry.originalPriority);
    } else {
      entry.style.removeProperty(entry.property);
    }
  }
}
