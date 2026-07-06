export type InlineRewriteInstruction = { style: CSSStyleDeclaration; property: string; value: string };

type TrackedProperty = { originalValue: string; originalPriority: string; currentValue: string };

/**
 * Applies recolored inline-`style` declarations idempotently: a DOM write
 * (`setProperty`/`removeProperty`) only happens for a (style, property)
 * pair whose *value* actually changed since the last call, or that is new,
 * or that needs reverting because it's no longer wanted.
 *
 * This matters for a reason that is easy to miss: unlike a stylesheet
 * rule's `CSSStyleRule.style` (invisible to `MutationObserver`, since
 * that only watches DOM tree/attribute/text changes), an element's inline
 * `style` *is* the `style` attribute — mutating it fires a real attribute
 * mutation record. `dom/mutation-tree.ts` watches `style` specifically
 * (to react to a page's own script changing an element's colors). Without
 * this idempotency check, every re-render would unconditionally
 * `setProperty` every tracked inline style again (even to the exact same
 * value), which would re-trigger the mutation observer, which would
 * schedule another re-render, forever. Reapplying identical values is
 * intentionally treated as a no-op write, breaking that loop at the root
 * rather than trying to filter it out after the fact.
 */
export class InlineRewriteTracker {
  private applied = new Map<CSSStyleDeclaration, Map<string, TrackedProperty>>();

  /** Reconciles the live DOM with `wanted`, writing only what changed. */
  sync(wanted: InlineRewriteInstruction[]): void {
    const wantedByStyle = new Map<CSSStyleDeclaration, Map<string, string>>();
    for (const r of wanted) {
      if (!wantedByStyle.has(r.style)) wantedByStyle.set(r.style, new Map());
      wantedByStyle.get(r.style)!.set(r.property, r.value);
    }

    // Revert/update properties we're already tracking.
    for (const [style, tracked] of this.applied) {
      const wantedProps = wantedByStyle.get(style);
      for (const [property, record] of [...tracked]) {
        const wantedValue = wantedProps?.get(property);
        if (wantedValue === undefined) {
          if (record.originalValue) {
            style.setProperty(property, record.originalValue, record.originalPriority);
          } else {
            style.removeProperty(property);
          }
          tracked.delete(property);
        } else if (wantedValue !== record.currentValue) {
          style.setProperty(property, wantedValue, "important");
          record.currentValue = wantedValue;
        }
        // else: identical value already applied — deliberately no DOM write.
      }
      if (tracked.size === 0) this.applied.delete(style);
    }

    // Apply properties that are newly wanted (new style declaration, or a
    // new property on an already-tracked one).
    for (const [style, props] of wantedByStyle) {
      let tracked = this.applied.get(style);
      for (const [property, value] of props) {
        if (tracked?.has(property)) continue; // handled in the pass above
        const originalValue = style.getPropertyValue(property);
        const originalPriority = style.getPropertyPriority(property);
        style.setProperty(property, value, "important");
        if (!tracked) {
          tracked = new Map();
          this.applied.set(style, tracked);
        }
        tracked.set(property, { originalValue, originalPriority, currentValue: value });
      }
    }
  }

  /** Reverts every currently-tracked property to its original value. */
  revertAll(): void {
    for (const [style, tracked] of this.applied) {
      for (const [property, record] of tracked) {
        if (record.originalValue) {
          style.setProperty(property, record.originalValue, record.originalPriority);
        } else {
          style.removeProperty(property);
        }
      }
    }
    this.applied.clear();
  }
}
