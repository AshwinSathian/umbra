import type { DisposeFn } from "./mutation-tree.js";

/**
 * Patches `CSSStyleSheet.prototype.insertRule`/`deleteRule` — which every
 * grouping rule type (`CSSMediaRule`, `CSSSupportsRule`, `CSSLayerBlockRule`)
 * inherits, so this single patch point also covers rules inserted inside an
 * `@media`/`@supports`/`@layer` block — to call `onChange` whenever a
 * same-realm script adds or removes a rule this way, batched to at most
 * once per microtask.
 *
 * **Known, significant limitation, found after this shipped**: in a real
 * Chrome/Safari extension, this content script runs in an *isolated world*
 * — a separate JS realm that shares the page's DOM/CSSOM state but does
 * *not* share built-in prototype objects like `CSSStyleSheet.prototype`
 * with the page's own ("main world") JavaScript. Patching the isolated
 * world's copy of `CSSStyleSheet.prototype` has **no effect whatsoever on
 * insertRule/deleteRule calls made by the page's own scripts** — confirmed
 * directly (not assumed): from the main world, `CSSStyleSheet.prototype
 * .insertRule.toString()` still reports unmodified native code after this
 * patch runs, and a real page-authored `sheet.insertRule(...)` call never
 * triggers `onChange` here. Since Darkframe itself never calls either
 * method on a real page stylesheet either (only on a throwaway detached
 * sheet for feature detection — see layer-injector.ts's
 * supportsCascadeLayers), this function currently has **no real-world
 * effect for its stated purpose** — it is not a bug in the sense of doing
 * the wrong thing, it simply never fires. The original design intent (and
 * what the doc comment here used to claim as verified) — catching
 * production-mode CSS-in-JS "speedy" `insertRule` writes (Emotion,
 * styled-components) that are invisible to `MutationObserver` — needs a
 * *main-world* script to actually intercept page code, bridged back to
 * this isolated-world listener via a DOM `CustomEvent` (events, unlike
 * prototypes, do cross the isolated/main-world boundary). That requires
 * either `chrome.scripting.registerContentScripts(..., { world: "MAIN" })`
 * (Chrome; static manifest `"world": "MAIN"` has a longstanding Chrome bug
 * and doesn't reliably work) or Safari's equivalent (supported since Safari
 * 16.4) — both need a new `scripting` permission and a new build target,
 * which is a real permission-surface change deserving its own dedicated
 * pass with its own store-listing justification update, not a silent
 * addition here. Tracked as a known gap in CHANGELOG.md rather than
 * silently left overclaimed. Left in place (rather than deleted) because
 * it's harmless — it only ever fires for same-realm calls, which in
 * practice means only this module's own unit tests exercise it, at zero
 * cost to a real page — and it's the correct foundation to wire the
 * main-world bridge into once that follow-up work happens.
 *
 * Deliberately does NOT patch `CSSStyleDeclaration.prototype.setProperty`/
 * `removeProperty` — that API is shared by every stylesheet rule's `.style`
 * *and* every element's inline `.style`, including the theme engine's own
 * inline-style and CSSOM-direct-rewrite-fallback writes (see
 * dom/layer-injector.ts), so patching it would need reentrancy-guarding
 * against retriggering on our own output, on a far hotter call path (every
 * inline style write on the page, not just new-rule insertion) than the
 * value justifies, on top of the cross-world limitation above.
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
