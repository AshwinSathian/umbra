import type { DisposeFn } from "./mutation-tree.js";

/**
 * Patches `CSSStyleSheet.prototype.insertRule`/`deleteRule` — which every
 * grouping rule type (`CSSMediaRule`, `CSSSupportsRule`, `CSSLayerBlockRule`)
 * inherits, so this single patch point also covers rules inserted inside an
 * `@media`/`@supports`/`@layer` block — to call `onChange` whenever a
 * same-realm script adds or removes a rule this way, batched to at most
 * once per microtask.
 *
 * This exists because `MutationObserver` — the theme engine's only other
 * change-detection mechanism (see mutation-tree.ts) — observes DOM tree and
 * attribute changes, never CSSOM rule-list mutations. Production-mode
 * CSS-in-JS ("speedy" Emotion, styled-components) writes new rules exactly
 * this way, specifically because it's faster than the DOM-visible
 * alternative (a new `<style>` element per class, or rewriting a `<style>`
 * element's `textContent`) — so without this, any class defined through one
 * of those libraries after a page's initial load was invisible to the
 * theme engine, with no DOM signal of any kind marking the moment it became
 * themeable. Previously the only thing that ever incidentally re-rendered
 * after such a change was the one-shot image-scan/cross-origin-CSS-warm
 * completion callback in apply-theme.ts — real, but a coincidence of timing
 * that stops covering anything once those two one-time scans finish early
 * in a page's life; a long-lived SPA session (e.g. MongoDB Atlas, whose
 * `leafygreen-ui` design system is Emotion-based) can keep inserting new
 * rules this way for as long as the tab stays open.
 *
 * Deliberately does NOT patch `CSSStyleDeclaration.prototype.setProperty`/
 * `removeProperty` — that API is shared by every stylesheet rule's `.style`
 * *and* every element's inline `.style`, including the theme engine's own
 * inline-style and CSSOM-direct-rewrite-fallback writes (see
 * dom/layer-injector.ts), so patching it would need reentrancy-guarding
 * against retriggering on our own output, on a far hotter call path (every
 * inline style write on the page, not just new-rule insertion) than the
 * value justifies. `insertRule`/`deleteRule` alone covers the real-world
 * CSS-in-JS pattern (new class -> new rule) without that risk: Darkframe
 * itself never calls either on a real page stylesheet, only on a throwaway
 * detached sheet for feature detection (see layer-injector.ts's
 * supportsCascadeLayers), so there is no self-triggering loop to guard
 * against here.
 */
export function observeStylesheetMutations(win: Window, onChange: () => void): DisposeFn {
  const ctor = (win as unknown as { CSSStyleSheet?: typeof CSSStyleSheet }).CSSStyleSheet;
  if (!ctor?.prototype.insertRule || !ctor.prototype.deleteRule) return () => {};

  let scheduled = false;
  let disposed = false;
  const scheduleChange = () => {
    if (scheduled || disposed) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (disposed) return;
      onChange();
    });
  };

  const proto = ctor.prototype;
  const originalInsertRule = proto.insertRule;
  const originalDeleteRule = proto.deleteRule;

  proto.insertRule = function (this: CSSStyleSheet, ...args: Parameters<CSSStyleSheet["insertRule"]>) {
    const result = originalInsertRule.apply(this, args);
    scheduleChange();
    return result;
  };
  proto.deleteRule = function (this: CSSStyleSheet, ...args: Parameters<CSSStyleSheet["deleteRule"]>) {
    const result = originalDeleteRule.apply(this, args);
    scheduleChange();
    return result;
  };

  return () => {
    disposed = true;
    proto.insertRule = originalInsertRule;
    proto.deleteRule = originalDeleteRule;
  };
}
