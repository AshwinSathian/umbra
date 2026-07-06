import { describe, expect, it, vi } from "vitest";
import { detectNativeDark } from "./native-dark.js";

describe("detectNativeDark", () => {
  it("flags a page with <meta name=color-scheme content=dark> as native-dark via the cheap meta check", () => {
    document.head.innerHTML = '<meta name="color-scheme" content="dark light">'.replace(
      " light",
      "",
    );
    document.head.innerHTML = '<meta name="color-scheme" content="dark">';

    const getComputedStyleSpy = vi.spyOn(window, "getComputedStyle");
    const result = detectNativeDark(document, window);

    expect(result).toEqual({ isNativeDark: true, method: "color-scheme-meta" });
    // The meta check must short-circuit before any computed-style sampling.
    expect(getComputedStyleSpy).not.toHaveBeenCalled();
    getComputedStyleSpy.mockRestore();
  });

  it("does not flag a page with no color-scheme signal as native-dark", () => {
    document.head.innerHTML = "";
    document.documentElement.style.removeProperty("color-scheme");

    const result = detectNativeDark(document, window);
    expect(result.isNativeDark).toBe(false);
  });

  it("flags a page whose root computed style declares color-scheme: dark", () => {
    document.head.innerHTML = "";
    const style = document.createElement("style");
    style.textContent = ":root { color-scheme: dark; }";
    document.head.appendChild(style);

    const result = detectNativeDark(document, window);
    expect(result).toEqual({ isNativeDark: true, method: "color-scheme-style" });

    document.head.innerHTML = "";
  });
});
