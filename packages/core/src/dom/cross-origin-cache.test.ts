import { beforeEach, describe, expect, it } from "vitest";
import {
  clearCrossOriginSheetCache,
  getCachedCrossOriginSheet,
  warmCrossOriginSheetCache,
} from "./cross-origin-cache.js";

describe("warmCrossOriginSheetCache", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    clearCrossOriginSheetCache();
  });

  it("fetches and caches a cors-blocked link stylesheet's CSS text", async () => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://cdn.example.com/styles.css";
    document.head.appendChild(link);

    const changed = await warmCrossOriginSheetCache(document, async (url) =>
      url === "https://cdn.example.com/styles.css" ? "a { color: red; }" : null,
    );

    expect(changed).toBe(true);
    const cached = getCachedCrossOriginSheet("https://cdn.example.com/styles.css");
    expect(cached).toBeDefined();
    expect(cached!.cssRules[0]!.cssText).toContain("color: red");
  });

  it("does not refetch a URL already in the cache", async () => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://cdn.example.com/cached.css";
    document.head.appendChild(link);

    let fetchCount = 0;
    const fetchCss = async () => {
      fetchCount++;
      return "a { color: blue; }";
    };

    await warmCrossOriginSheetCache(document, fetchCss);
    const secondChanged = await warmCrossOriginSheetCache(document, fetchCss);

    expect(fetchCount).toBe(1);
    expect(secondChanged).toBe(false);
  });

  it("leaves a URL uncached (not assumed empty) when the fetch fails", async () => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://cdn.example.com/broken.css";
    document.head.appendChild(link);

    const changed = await warmCrossOriginSheetCache(document, async () => null);
    expect(changed).toBe(false);
    expect(getCachedCrossOriginSheet("https://cdn.example.com/broken.css")).toBeUndefined();
  });

  it("caps distinct hosts fetched per page at the documented limit", async () => {
    for (let i = 0; i < 20; i++) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = `https://host${i}.example.com/styles.css`;
      document.head.appendChild(link);
    }

    let fetchCount = 0;
    await warmCrossOriginSheetCache(document, async () => {
      fetchCount++;
      return "a { color: green; }";
    });

    expect(fetchCount).toBeLessThanOrEqual(16);
  });
});
