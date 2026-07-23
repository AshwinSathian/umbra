import { beforeEach, describe, expect, it, vi } from "vitest";
import { observeStylesheetMutations } from "./stylesheet-mutation-watch.js";

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(() => resolve()));
}

describe("observeStylesheetMutations", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });

  // Uses `new window.CSSStyleSheet()` rather than a `<style>` element's
  // `.sheet` — a real, spec-legal way to obtain a CSSStyleSheet (also used
  // for adoptedStyleSheets, and by layer-injector.ts's own
  // supportsCascadeLayers feature test) — because happy-dom's `.sheet` on
  // an attached `<style>` element is, confirmed experimentally, backed by a
  // different internal class than the one `window.CSSStyleSheet` points
  // at, so patching `window.CSSStyleSheet.prototype` (the only
  // spec-correct target — real browsers have no such split) wouldn't
  // intercept calls made through it. Real Chrome/Safari have no such split;
  // this only affects how the test constructs its sheet, not what's
  // exercised (the same insertRule/deleteRule patch on the same prototype).

  it("fires onChange when a rule is inserted via insertRule() with no accompanying DOM mutation", async () => {
    const sheet = new window.CSSStyleSheet();

    const onChange = vi.fn();
    const dispose = observeStylesheetMutations(window, onChange);

    sheet.insertRule(".foo { color: red; }", 0);
    await flushMicrotasks();

    expect(onChange).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("fires onChange when a rule is removed via deleteRule()", async () => {
    const sheet = new window.CSSStyleSheet();
    sheet.insertRule(".foo { color: red; }", 0);

    const onChange = vi.fn();
    const dispose = observeStylesheetMutations(window, onChange);

    sheet.deleteRule(0);
    await flushMicrotasks();

    expect(onChange).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("collapses a synchronous burst of insertRule() calls into exactly one callback", async () => {
    const sheet = new window.CSSStyleSheet();

    const onChange = vi.fn();
    const dispose = observeStylesheetMutations(window, onChange);

    for (let i = 0; i < 20; i++) {
      sheet.insertRule(`.gen-${i} { color: red; }`, 0);
    }
    await flushMicrotasks();

    expect(onChange).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("stops calling back and restores the original methods after dispose", async () => {
    const originalInsertRule = window.CSSStyleSheet.prototype.insertRule;

    const onChange = vi.fn();
    const dispose = observeStylesheetMutations(window, onChange);
    expect(window.CSSStyleSheet.prototype.insertRule).not.toBe(originalInsertRule);

    dispose();
    expect(window.CSSStyleSheet.prototype.insertRule).toBe(originalInsertRule);

    const sheet = new window.CSSStyleSheet();
    sheet.insertRule(".foo { color: red; }", 0);
    await flushMicrotasks();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("REGRESSION: a callback already scheduled by insertRule must not fire if dispose() runs before it delivers", async () => {
    const sheet = new window.CSSStyleSheet();

    const onChange = vi.fn();
    const dispose = observeStylesheetMutations(window, onChange);

    sheet.insertRule(".foo { color: red; }", 0); // schedules the callback
    dispose(); // must prevent that already-scheduled callback from firing

    await flushMicrotasks();
    expect(onChange).not.toHaveBeenCalled();
  });
});
