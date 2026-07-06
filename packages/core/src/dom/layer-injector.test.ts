import { beforeEach, describe, expect, it } from "vitest";
import {
  MANAGED_STYLE_ID,
  applyDirectRewrite,
  applyLayerTheme,
  buildLayerStylesheetText,
  revertDirectRewrites,
} from "./layer-injector.js";

describe("buildLayerStylesheetText", () => {
  it("wraps overrides in an @layer block with !important on every declaration", () => {
    const css = buildLayerStylesheetText([
      { selectorText: "body", properties: [{ property: "background-color", value: "rgb(10, 10, 10)" }] },
      { selectorText: ".card", properties: [{ property: "color", value: "rgb(240, 240, 240)" }] },
    ]);

    expect(css).toMatch(/^@layer umbra \{/);
    expect(css).toContain("background-color: rgb(10, 10, 10) !important;");
    expect(css).toContain("color: rgb(240, 240, 240) !important;");
  });
});

describe("applyLayerTheme", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });

  it("injects exactly one managed <style> element and leaves original stylesheets untouched", () => {
    const originalStyle = document.createElement("style");
    originalStyle.textContent = "a { color: red; }";
    document.head.appendChild(originalStyle);
    const originalCssTextBefore = originalStyle.sheet?.cssRules[0]?.cssText;

    const dispose = applyLayerTheme(document, buildLayerStylesheetText([]));

    const managedElements = document.querySelectorAll(`#${MANAGED_STYLE_ID}`);
    expect(managedElements.length).toBe(1);
    expect(originalStyle.sheet?.cssRules[0]?.cssText).toBe(originalCssTextBefore);

    dispose();
    expect(document.querySelectorAll(`#${MANAGED_STYLE_ID}`).length).toBe(0);
  });

  it("replaces its own content on repeated calls instead of stacking duplicate style elements", () => {
    applyLayerTheme(document, buildLayerStylesheetText([{ selectorText: "a", properties: [{ property: "color", value: "red" }] }]));
    applyLayerTheme(document, buildLayerStylesheetText([{ selectorText: "b", properties: [{ property: "color", value: "blue" }] }]));

    const managed = document.querySelectorAll(`#${MANAGED_STYLE_ID}`);
    expect(managed.length).toBe(1);
    expect(managed[0]?.textContent).toContain("\nb {");
    expect(managed[0]?.textContent).not.toContain("\na {");
  });

  it("injects into a shadow root directly (not into the document) since shadow styling is encapsulated", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });

    applyLayerTheme(shadow, buildLayerStylesheetText([]));

    expect(shadow.querySelectorAll(`#${MANAGED_STYLE_ID}`).length).toBe(1);
    expect(document.querySelectorAll(`#${MANAGED_STYLE_ID}`).length).toBe(0);
  });
});

describe("applyDirectRewrite / revertDirectRewrites (CSSOM fallback path)", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
  });

  it("mutates the rule in place and restores the exact original value on revert", () => {
    const style = document.createElement("style");
    style.textContent = "a { color: red; }";
    document.head.appendChild(style);
    const rule = style.sheet!.cssRules[0] as CSSStyleRule;

    const entry = applyDirectRewrite(rule.style, "color", "rgb(240, 240, 240)");
    expect(rule.style.getPropertyValue("color").replace(/\s/g, "")).toBe("rgb(240,240,240)");
    expect(rule.style.getPropertyPriority("color")).toBe("important");

    revertDirectRewrites([entry]);
    expect(rule.style.getPropertyValue("color")).toBe("red");
  });

  it("removes the property entirely on revert if it was not originally set", () => {
    const style = document.createElement("style");
    style.textContent = "a { background-color: transparent; }";
    document.head.appendChild(style);
    const rule = style.sheet!.cssRules[0] as CSSStyleRule;
    rule.style.removeProperty("background-color");

    const entry = applyDirectRewrite(rule.style, "background-color", "rgb(0, 0, 0)");
    revertDirectRewrites([entry]);
    expect(rule.style.getPropertyValue("background-color")).toBe("");
  });

  it("works identically on an element's inline style (also a CSSStyleDeclaration), not just a stylesheet rule", () => {
    const el = document.createElement("div");
    el.setAttribute("style", "color: red;");
    document.body.appendChild(el);

    const entry = applyDirectRewrite(el.style, "color", "rgb(240, 240, 240)");
    expect(el.style.getPropertyPriority("color")).toBe("important");

    revertDirectRewrites([entry]);
    expect(el.style.getPropertyValue("color")).toBe("red");
    document.body.removeChild(el);
  });
});
