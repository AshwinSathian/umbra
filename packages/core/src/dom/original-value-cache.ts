/**
 * Caches the first-observed ("true original") value of each
 * `(CSSStyleDeclaration, property)` pair the first time it's read, and
 * returns that cached value on every subsequent read — even once the live
 * DOM value has since changed (typically because *we* changed it).
 *
 * This exists to fix a real bug: `theme-engine.ts`'s `computeTheme` reads
 * each rule/element's current declared color to recolor it. For a
 * directly-mutated `CSSStyleDeclaration` (the CSSOM-direct-rewrite
 * fallback path, and inline `style=""` attributes on *every* path — see
 * their docs), a second render's live read returns our own previous
 * output, not the page's authored value. Recoloring that "input" again is
 * not a no-op: the pole-based remap is a contraction toward a fixed
 * point, not idempotent, so each re-render nudged the color a little
 * further, and floating-point/rounding noise meant two consecutive
 * renders almost never landed on the exact same value — so
 * dom/inline-rewrite-tracker.ts's idempotency check never saw "nothing
 * changed" and kept writing, which (for inline styles specifically, since
 * mutating `element.style` fires a real attribute-mutation record our own
 * observer watches) pinned a live tab's CPU in an infinite render loop.
 * Unit tests using happy-dom didn't catch it because they don't chain
 * enough real-render iterations against genuine floating-point rounding
 * to expose the drift. Resolving through this cache instead means every
 * render recolors from the *same* true original, producing the exact
 * same output every time — a real no-op the second time onward.
 */
export class OriginalValueCache {
  private cache = new WeakMap<CSSStyleDeclaration, Map<string, string>>();

  resolve(style: CSSStyleDeclaration, property: string): string {
    let props = this.cache.get(style);
    if (!props) {
      props = new Map();
      this.cache.set(style, props);
    }
    let value = props.get(property);
    if (value === undefined) {
      value = style.getPropertyValue(property);
      props.set(property, value);
    }
    return value;
  }
}
