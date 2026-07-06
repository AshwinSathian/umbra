import { beforeEach, describe, expect, it, vi } from "vitest";
import { MANAGED_STYLE_ID } from "../dom/layer-injector.js";
import { applyTheme } from "./apply-theme.js";

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("applyTheme (CSSOM-direct-rewrite path — the path this test env's engine actually supports)", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
    document.documentElement.style.removeProperty("color-scheme");
  });

  it("recolors matching rules immediately on apply", () => {
    const style = document.createElement("style");
    style.textContent = "body { background-color: #ffffff; }";
    document.head.appendChild(style);
    const rule = style.sheet!.cssRules[0] as CSSStyleRule;

    const dispose = applyTheme(document, window, { forceLayerSupport: false });

    expect(rule.style.getPropertyValue("background-color")).not.toBe("");
    expect(rule.style.getPropertyValue("background-color")).not.toMatch(/255,\s*255,\s*255/);

    dispose();
  });

  it("reverts every rewritten rule to its exact original value on dispose", () => {
    const style = document.createElement("style");
    style.textContent = "p { color: #000000; }";
    document.head.appendChild(style);
    const rule = style.sheet!.cssRules[0] as CSSStyleRule;

    const dispose = applyTheme(document, window, { forceLayerSupport: false });
    dispose();

    expect(rule.style.getPropertyValue("color")).toBe("#000000");
  });

  it("re-renders when a new stylesheet is added to the page after the initial pass", async () => {
    const dispose = applyTheme(document, window, { forceLayerSupport: false });

    const style = document.createElement("style");
    style.textContent = "h1 { background-color: #ffffff; }";
    document.head.appendChild(style);
    await tick();

    const rule = style.sheet!.cssRules[0] as CSSStyleRule;
    expect(rule.style.getPropertyValue("background-color")).not.toMatch(/255,\s*255,\s*255/);

    dispose();
  });

  it("applies nothing (and reverts any prior state) when the page declares native dark support", () => {
    const meta = document.createElement("meta");
    meta.name = "color-scheme";
    meta.content = "dark";
    document.head.appendChild(meta);

    const style = document.createElement("style");
    style.textContent = "body { background-color: #ffffff; }";
    document.head.appendChild(style);
    const rule = style.sheet!.cssRules[0] as CSSStyleRule;

    const dispose = applyTheme(document, window, { forceLayerSupport: false });
    expect(rule.style.getPropertyValue("background-color")).toBe("#ffffff");
    dispose();
  });
});

describe("applyTheme (@layer path, forced on to verify the additive/non-mutating strategy)", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });

  it("injects exactly one managed stylesheet and never mutates the original rule", () => {
    const style = document.createElement("style");
    style.textContent = "body { background-color: #ffffff; }";
    document.head.appendChild(style);
    const rule = style.sheet!.cssRules[0] as CSSStyleRule;
    const originalCssText = rule.cssText;

    const dispose = applyTheme(document, window, { forceLayerSupport: true });

    expect(rule.cssText).toBe(originalCssText);
    expect(document.querySelectorAll(`#${MANAGED_STYLE_ID}`).length).toBe(1);
    expect(document.getElementById(MANAGED_STYLE_ID)?.textContent).toContain("!important");

    dispose();
    expect(document.querySelectorAll(`#${MANAGED_STYLE_ID}`).length).toBe(0);
  });

  it("merges in image overrides from an async sampler once the scan resolves, without blocking the initial color render", async () => {
    const img = document.createElement("img");
    img.src = "https://example.com/icon.png";
    document.body.appendChild(img);

    const solidGridData = new Uint8ClampedArray(32 * 32 * 4);
    for (let i = 0; i < 32 * 32; i++) {
      solidGridData[i * 4] = 40;
      solidGridData[i * 4 + 1] = 90;
      solidGridData[i * 4 + 2] = 200;
      solidGridData[i * 4 + 3] = 255;
    }

    const dispose = applyTheme(document, window, {
      forceLayerSupport: true,
      imageSampler: async () => ({ width: 32, height: 32, data: solidGridData }),
    });

    // Immediately after the synchronous call, the async image scan hasn't
    // resolved yet — the color theme is already live, but not the image one.
    expect(document.getElementById(MANAGED_STYLE_ID)?.textContent ?? "").not.toContain("img[src=");

    await tick();
    await tick();

    expect(document.getElementById(MANAGED_STYLE_ID)?.textContent).toContain('img[src="https://example.com/icon.png"]');
    expect(document.getElementById(MANAGED_STYLE_ID)?.textContent).toContain("invert(1) hue-rotate(180deg)");

    dispose();
  });

  it("removes the managed stylesheet from a shadow root once it no longer has overrides", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    const shadowStyle = document.createElement("style");
    shadowStyle.textContent = ".card { background-color: white; }";
    shadow.appendChild(shadowStyle);

    const dispose = applyTheme(document, window, { forceLayerSupport: true });
    await tick();
    expect(shadow.querySelectorAll(`#${MANAGED_STYLE_ID}`).length).toBe(1);

    shadowStyle.textContent = "";
    await tick();
    expect(shadow.querySelectorAll(`#${MANAGED_STYLE_ID}`).length).toBe(0);

    dispose();
  });

  it("recolors an inline style attribute, not just stylesheet rules", async () => {
    const el = document.createElement("div");
    el.setAttribute("style", "background-color: #ffffff;");
    document.body.appendChild(el);

    const dispose = applyTheme(document, window, { forceLayerSupport: true });
    await tick();

    expect(el.style.getPropertyValue("background-color")).not.toMatch(/255,\s*255,\s*255/);
    expect(el.style.getPropertyPriority("background-color")).toBe("important");

    dispose();
  });

  it("settles instead of looping forever when an inline style is themed (mutating element.style triggers the mutation observer, unlike a stylesheet rule)", async () => {
    const el = document.createElement("div");
    el.setAttribute("style", "background-color: #ffffff;");
    document.body.appendChild(el);

    const setPropertySpy = vi.spyOn(el.style, "setProperty");
    const dispose = applyTheme(document, window, { forceLayerSupport: true });

    // Give the mutation-triggered re-render (caused by the first inline
    // style write) several ticks to resolve. If this were looping, the
    // call count would keep climbing without bound; it must settle at a
    // small constant instead.
    await tick();
    await tick();
    await tick();
    const callsAfterSettling = setPropertySpy.mock.calls.length;

    await tick();
    await tick();
    expect(setPropertySpy.mock.calls.length).toBe(callsAfterSettling);
    expect(callsAfterSettling).toBeLessThan(5);

    setPropertySpy.mockRestore();
    dispose();
  });
});
