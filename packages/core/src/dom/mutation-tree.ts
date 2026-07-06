import { MANAGED_STYLE_ID } from "./layer-injector.js";
import { walkShadowRoots } from "./style-discovery.js";

export type DisposeFn = () => void;

/**
 * Returns true if every mutation record in this batch is solely about
 * Umbra's own managed style element(s) — i.e. this callback fired only
 * because Umbra itself just wrote a theme, not because the page changed.
 * Without this guard, applying a theme would re-trigger the very observer
 * watching for page changes, causing an infinite recompute loop.
 */
function isSelfInflicted(records: MutationRecord[]): boolean {
  return records.every((record) => {
    const target = record.target as Element | null;
    if (target?.id === MANAGED_STYLE_ID) return true;
    const addedOrRemoved = [...record.addedNodes, ...record.removedNodes];
    return (
      addedOrRemoved.length > 0 &&
      addedOrRemoved.every((n) => n instanceof Element && n.id === MANAGED_STYLE_ID)
    );
  });
}

/**
 * Watches `root` (and, transitively, every shadow root discovered within
 * it, including ones that appear later) for DOM/style changes relevant to
 * theming — including `src`/`srcset` attribute swaps, so an image whose
 * source changes after the initial pass (lazy loading, carousels, SPA
 * navigation reusing an `<img>` tag) gets re-classified rather than keeping
 * a stale filter decision — and calls `onChange` at most once per
 * microtask batch. Native
 * `MutationObserver` callbacks already batch every synchronous mutation in
 * a tick into a single call with multiple records — this wrapper adds two
 * things on top of that: (1) it ignores batches that are entirely
 * self-inflicted (see {@link isSelfInflicted}), and (2) it re-scans for
 * newly-created shadow roots after every batch and starts observing them
 * too, so dynamically-inserted web components get themed without polling.
 */
export function observeMutations(doc: Document, onChange: () => void): DisposeFn {
  const trackedRoots = new WeakSet<ShadowRoot>();
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

  const observer = new MutationObserver((records) => {
    if (isSelfInflicted(records)) return;
    scheduleChange();
  });

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

  observeRoot(doc);
  rescan();

  return () => {
    disposed = true;
    observer.disconnect();
  };
}
