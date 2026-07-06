import { beforeEach, describe, expect, it, vi } from "vitest";
import { MANAGED_STYLE_ID } from "./layer-injector.js";
import { observeMutations } from "./mutation-tree.js";

function flushMicrotasks(): Promise<void> {
  // happy-dom delivers MutationObserver callbacks on a macrotask rather than
  // a true microtask (unlike real browsers), so tests must wait past a
  // setTimeout(0), not just queueMicrotask, before asserting.
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("observeMutations", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });

  it("collapses a synchronous burst of 50 new elements into exactly one callback", async () => {
    const onChange = vi.fn();
    const dispose = observeMutations(document, onChange);

    for (let i = 0; i < 50; i++) {
      const style = document.createElement("style");
      style.textContent = `.gen-${i} { color: red; }`;
      document.head.appendChild(style);
    }

    await flushMicrotasks();
    expect(onChange).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("ignores mutations that are solely Umbra's own managed style element", async () => {
    const onChange = vi.fn();
    const dispose = observeMutations(document, onChange);

    const managed = document.createElement("style");
    managed.id = MANAGED_STYLE_ID;
    managed.setAttribute("data-umbra-managed", "true");
    document.head.appendChild(managed);
    managed.textContent = "@layer umbra { a { color: red !important; } }";

    await flushMicrotasks();
    expect(onChange).not.toHaveBeenCalled();
    dispose();
  });

  it("still fires when a real page mutation happens alongside a managed-element mutation", async () => {
    const onChange = vi.fn();
    const dispose = observeMutations(document, onChange);

    const managed = document.createElement("style");
    managed.id = MANAGED_STYLE_ID;
    document.head.appendChild(managed);

    const pageStyle = document.createElement("style");
    pageStyle.textContent = "a { color: blue; }";
    document.head.appendChild(pageStyle);

    await flushMicrotasks();
    expect(onChange).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("detects and observes a shadow root created after observation started", async () => {
    const onChange = vi.fn();
    const dispose = observeMutations(document, onChange);

    const host = document.createElement("div");
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    await flushMicrotasks();
    onChange.mockClear();

    const shadowStyle = document.createElement("style");
    shadowStyle.textContent = ".y { color: green; }";
    shadow.appendChild(shadowStyle);

    await flushMicrotasks();
    expect(onChange).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("stops calling back after dispose", async () => {
    const onChange = vi.fn();
    const dispose = observeMutations(document, onChange);
    dispose();

    const style = document.createElement("style");
    document.head.appendChild(style);
    await flushMicrotasks();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("REGRESSION: a callback already scheduled by a mutation must not fire if dispose() runs before it delivers", async () => {
    // disconnect() stops *future* MutationObserver deliveries, but does not
    // cancel a callback the browser has already scheduled for a mutation
    // batch it saw before disconnecting. Without an internal disposed
    // guard, that stale callback still fires — which, in apply-theme.ts,
    // meant a just-disposed theme instance's render() could run once more
    // after a fresh instance had already started (e.g. on a settings-
    // change restart), clobbering the new instance's correct output with
    // stale (old-settings) values.
    const onChange = vi.fn();
    const dispose = observeMutations(document, onChange);

    const style = document.createElement("style");
    document.head.appendChild(style); // schedules the observer callback

    dispose(); // must prevent that already-scheduled callback from firing
    await flushMicrotasks();

    expect(onChange).not.toHaveBeenCalled();
  });
});
