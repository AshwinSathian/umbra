import { walkShadowRoots } from "./style-discovery.js";

export type DisposeFn = () => void;

export type MutationWatcher = {
  dispose: DisposeFn;
  /**
   * Runs `fn` (expected to synchronously write Darkframe's own managed DOM/
   * style nodes) with the observer fully disconnected, then reconnects it
   * to every previously-tracked root (plus any newly-discovered shadow
   * root) immediately afterward. A disconnected `MutationObserver` never
   * queues records for changes made while it's disconnected, so this is
   * the only reliable way to distinguish "Darkframe just wrote this" from
   * "something else touched what Darkframe previously wrote" — see the
   * module doc comment for why matching on the touched node's identity
   * (the previous approach) cannot make that distinction.
   */
  withoutObserving: (fn: () => void) => void;
};

/**
 * Watches `root` (and, transitively, every shadow root discovered within
 * it, including ones that appear later) for DOM/style changes relevant to
 * theming — including `src`/`srcset` attribute swaps, so an image whose
 * source changes after the initial pass (lazy loading, carousels, SPA
 * navigation reusing an `<img>` tag) gets re-classified rather than keeping
 * a stale filter decision — and calls `onChange` at most once per microtask
 * batch. Native `MutationObserver` callbacks already batch every synchronous
 * mutation in a tick into a single call with multiple records — this
 * wrapper adds two things on top of that: (1) it re-scans for newly-created
 * shadow roots after every batch and starts observing them too, so
 * dynamically-inserted web components get themed without polling, and (2)
 * it exposes {@link MutationWatcher.withoutObserving} so a caller's own
 * writes to the DOM never produce a mutation record in the first place.
 *
 * That second point used to be handled by a heuristic instead: skip any
 * batch whose mutation records *only* touched a node carrying Darkframe's
 * own managed-style id, on the theory that such a batch could only have
 * been caused by Darkframe's own write. That assumption is false the
 * instant a third party — confirmed in practice with the Grammarly browser
 * extension, whose injected UI (`<grammarly-extension>`, `<grammarly-
 * popups>`, etc.) lives in its own open shadow root that Darkframe, by
 * design, also themes — removes or replaces that same node as an incidental
 * side effect of *its own*, entirely unrelated re-render. A reactive
 * shadow-DOM widget that fully owns and re-renders its subtree (the normal
 * way these are built) will discard any child it doesn't recognize,
 * including Darkframe's managed `<style>`, the moment it next reconciles —
 * which for Grammarly's UI happens on nearly every keystroke. Matched
 * purely on node identity, that removal looked indistinguishable from
 * Darkframe's own write and was silently swallowed, so Darkframe never
 * learned its style had been erased and never re-applied it — for the
 * *whole page*, not just that shadow root, whenever the exact same failure
 * hit the top-level managed stylesheet with no other page mutation
 * following to accidentally trigger recovery. Bracketing Darkframe's own
 * writes with disconnect/reconnect instead removes the ambiguity entirely:
 * a third party's removal is a real, observed mutation once again, so it
 * triggers a re-render that simply re-creates the missing managed element.
 */
export function observeMutations(doc: Document, onChange: () => void): MutationWatcher {
  const trackedRoots = new Set<ShadowRoot>();
  let scheduled = false;
  let disposed = false;

  const scheduleChange = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      // A disconnected MutationObserver stops *future* callback
      // invocations, but does not cancel a microtask already queued by a
      // batch it saw before disconnecting — without this guard, a stale
      // instance's onChange (closing over its own now-torn-down settings/
      // state) could still fire once after dispose(), briefly clobbering
      // whatever a *newer* instance (e.g. one started right after this
      // one was disposed, such as on a settings-change restart) had just
      // correctly rendered.
      if (disposed) return;
      onChange();
      rescan();
    });
  };

  const observer = new MutationObserver(() => scheduleChange());

  const observeRoot = (root: Document | ShadowRoot) => {
    const target = root instanceof Document ? (root.documentElement ?? root) : root;
    observer.observe(target as Node, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "class", "src", "srcset"],
    });
  };

  function rescan() {
    const startNode: Node = doc.documentElement ?? doc;
    for (const shadowRoot of walkShadowRoots(startNode)) {
      if (!trackedRoots.has(shadowRoot)) {
        trackedRoots.add(shadowRoot);
        observeRoot(shadowRoot);
      }
    }
  }

  function withoutObserving(fn: () => void): void {
    observer.disconnect();
    try {
      fn();
    } finally {
      if (!disposed) {
        observeRoot(doc);
        for (const root of trackedRoots) observeRoot(root);
        rescan();
      }
    }
  }

  observeRoot(doc);
  rescan();

  return {
    dispose: () => {
      disposed = true;
      observer.disconnect();
    },
    withoutObserving,
  };
}
