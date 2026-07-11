import { MANAGED_STYLE_MARKER_ATTR } from "./layer-injector.js";

export type StyleSource = "style-element" | "link-element" | "adopted";

export type DiscoveredSheet = {
  root: Document | ShadowRoot;
  source: StyleSource;
  /** The live CSSStyleSheet, or null when its rules can't be read (cross-origin `<link>`
   * blocked by CORS, or a `<link>` whose stylesheet hasn't loaded yet in this DOM). */
  sheet: CSSStyleSheet | null;
  href: string | null;
  corsBlocked: boolean;
};

/** Recursively collects every open shadow root under (and including) `node`. */
export function walkShadowRoots(node: Node, found: ShadowRoot[] = []): ShadowRoot[] {
  if (node instanceof Element && node.shadowRoot) {
    found.push(node.shadowRoot);
    walkShadowRoots(node.shadowRoot, found);
  }
  const children = node.childNodes;
  for (let i = 0; i < children.length; i++) {
    walkShadowRoots(children[i]!, found);
  }
  return found;
}

export function getAllStyleRoots(doc: Document): (Document | ShadowRoot)[] {
  const startNode: Node = doc.documentElement ?? doc;
  return [doc, ...walkShadowRoots(startNode)];
}

function canReadCssRules(sheet: CSSStyleSheet): boolean {
  try {
    // Accessing .cssRules on a cross-origin stylesheet without CORS headers
    // throws a SecurityError in real browsers; this is the only reliable
    // way to detect that case (there is no separate "isAccessible" flag).
    void sheet.cssRules;
    return true;
  } catch {
    return false;
  }
}

/**
 * Enumerates every stylesheet reachable from `doc`: same-document `<style>`/
 * `<link>` sheets, every open shadow root's own sheets, and every root's
 * `adoptedStyleSheets`. Cross-origin `<link>` sheets that can't be read are
 * still returned (with `sheet: null`, `corsBlocked: true`) so callers can
 * route them through a network-fetch fallback instead of silently skipping.
 *
 * Deliberately reads `<style>`/`<link>` elements directly (via
 * `element.sheet`) rather than `root.styleSheets` — `ShadowRoot.styleSheets`
 * is not implemented everywhere (including in this project's own
 * happy-dom-based unit test environment), while `element.sheet` is a
 * standard, universally-supported property on both element types in every
 * target browser (Chrome, Safari) and works identically inside shadow
 * roots. `querySelectorAll` scoped to a root never pierces into nested
 * shadow roots, so this cannot double-count a nested root's sheets — those
 * are already enumerated separately via `getAllStyleRoots`.
 *
 * Explicitly skips Darkframe's own managed style element (marked with
 * MANAGED_STYLE_MARKER_ATTR). Without this exclusion, a later discovery
 * pass would find our own injected @layer stylesheet, walk into its rules
 * (an @layer block has .cssRules like any other grouping rule — see
 * walkStyleRules), and recolor the theme's own previous output as if it
 * were fresh page content. This was a real, observed bug: it produced a
 * second, later-declared "body {...}" rule inside the same layer with a
 * further-recolored value that then won the cascade over the correct one
 * (same selector/specificity/importance, later source order wins within a
 * layer), silently overriding correct settings-driven updates with a
 * stale, doubly-recolored color.
 */
export function discoverStylesheets(doc: Document): DiscoveredSheet[] {
  const results: DiscoveredSheet[] = [];

  for (const root of getAllStyleRoots(doc)) {
    const elements = root.querySelectorAll<HTMLStyleElement | HTMLLinkElement>(
      'style, link[rel~="stylesheet"]',
    );

    for (const el of elements) {
      if (el.hasAttribute(MANAGED_STYLE_MARKER_ATTR)) continue;
      const isLink = el.tagName === "LINK";
      const sheet = el.sheet;
      const accessible = sheet !== null && canReadCssRules(sheet);

      results.push({
        root,
        source: isLink ? "link-element" : "style-element",
        sheet: accessible ? sheet : null,
        href: isLink ? (el as HTMLLinkElement).href : null,
        corsBlocked: isLink && !accessible,
      });
    }

    const adopted = root.adoptedStyleSheets;
    if (adopted) {
      for (const sheet of adopted) {
        results.push({ root, source: "adopted", sheet, href: null, corsBlocked: false });
      }
    }
  }

  return results;
}

/**
 * Recursively walks a rule list, descending into any grouping rule that has
 * its own `.cssRules` (e.g. `@media`, `@supports`, `@layer`), so nested
 * color declarations under a media query are found too.
 */
export function walkStyleRules(rules: CSSRuleList, visit: (rule: CSSStyleRule) => void): void {
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i]!;
    if ("style" in rule && "selectorText" in rule) {
      visit(rule as CSSStyleRule);
    }
    const nested = (rule as unknown as { cssRules?: CSSRuleList }).cssRules;
    if (nested) {
      walkStyleRules(nested, visit);
    }
  }
}
