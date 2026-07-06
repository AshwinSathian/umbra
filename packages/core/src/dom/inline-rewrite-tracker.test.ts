import { beforeEach, describe, expect, it, vi } from "vitest";
import { InlineRewriteTracker } from "./inline-rewrite-tracker.js";

describe("InlineRewriteTracker", () => {
  let el: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    el = document.createElement("div");
    el.setAttribute("style", "color: red; background-color: blue;");
    document.body.appendChild(el);
  });

  it("applies a new property with !important and records the true original for revert", () => {
    const tracker = new InlineRewriteTracker();
    tracker.sync([{ style: el.style, property: "color", value: "rgb(240, 240, 240)" }]);

    expect(el.style.getPropertyValue("color").replace(/\s/g, "")).toBe("rgb(240,240,240)");
    expect(el.style.getPropertyPriority("color")).toBe("important");

    tracker.revertAll();
    expect(el.style.getPropertyValue("color")).toBe("red");
  });

  it("does not write to the DOM again when called with the exact same wanted value (idempotency)", () => {
    const tracker = new InlineRewriteTracker();
    tracker.sync([{ style: el.style, property: "color", value: "rgb(1, 2, 3)" }]);

    const setPropertySpy = vi.spyOn(el.style, "setProperty");
    tracker.sync([{ style: el.style, property: "color", value: "rgb(1, 2, 3)" }]);

    expect(setPropertySpy).not.toHaveBeenCalled();
    setPropertySpy.mockRestore();
  });

  it("writes only the changed property when the wanted value changes", () => {
    const tracker = new InlineRewriteTracker();
    tracker.sync([{ style: el.style, property: "color", value: "rgb(1, 2, 3)" }]);
    tracker.sync([{ style: el.style, property: "color", value: "rgb(9, 9, 9)" }]);

    expect(el.style.getPropertyValue("color").replace(/\s/g, "")).toBe("rgb(9,9,9)");
  });

  it("reverts a property that is no longer in the wanted set", () => {
    const tracker = new InlineRewriteTracker();
    tracker.sync([{ style: el.style, property: "color", value: "rgb(1, 2, 3)" }]);
    tracker.sync([]); // color no longer themed (e.g. native-dark detected on a later pass)

    expect(el.style.getPropertyValue("color")).toBe("red");
  });

  it("reverts everything on revertAll and leaves nothing tracked", () => {
    const tracker = new InlineRewriteTracker();
    tracker.sync([
      { style: el.style, property: "color", value: "rgb(1, 2, 3)" },
      { style: el.style, property: "background-color", value: "rgb(4, 5, 6)" },
    ]);
    tracker.revertAll();

    expect(el.style.getPropertyValue("color")).toBe("red");
    expect(el.style.getPropertyValue("background-color")).toBe("blue");
  });
});
