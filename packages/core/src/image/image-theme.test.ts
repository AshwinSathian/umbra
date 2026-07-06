import { beforeEach, describe, expect, it } from "vitest";
import { planImageOverrides } from "./image-theme.js";
import type { PixelGrid } from "./types.js";

function solidGrid(): PixelGrid {
  const data = new Uint8ClampedArray(32 * 32 * 4);
  for (let i = 0; i < 32 * 32; i++) {
    data[i * 4] = 40;
    data[i * 4 + 1] = 90;
    data[i * 4 + 2] = 200;
    data[i * 4 + 3] = 255;
  }
  return { width: 32, height: 32, data };
}

function noisePixelGrid(): PixelGrid {
  let seed = 7;
  const rand = () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const data = new Uint8ClampedArray(32 * 32 * 4);
  for (let i = 0; i < 32 * 32; i++) {
    data[i * 4] = Math.round(rand() * 255);
    data[i * 4 + 1] = Math.round(rand() * 255);
    data[i * 4 + 2] = Math.round(rand() * 255);
    data[i * 4 + 3] = 255;
  }
  return { width: 32, height: 32, data };
}

describe("planImageOverrides", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("produces a filter override for a flat icon, selected by its own src attribute", async () => {
    const img = document.createElement("img");
    img.src = "https://example.com/icon.png";
    document.body.appendChild(img);

    const overrides = await planImageOverrides(document, async (url) =>
      url === "https://example.com/icon.png" ? solidGrid() : null,
    );

    expect(overrides).toHaveLength(1);
    expect(overrides[0]!.selectorText).toBe('img[src="https://example.com/icon.png"]');
    expect(overrides[0]!.properties).toEqual([{ property: "filter", value: "invert(1) hue-rotate(180deg)" }]);
  });

  it("never produces an override for an image classified as a photo", async () => {
    const img = document.createElement("img");
    img.src = "https://example.com/photo.jpg";
    document.body.appendChild(img);

    const overrides = await planImageOverrides(document, async () => noisePixelGrid());
    expect(overrides).toHaveLength(0);
  });

  it("never produces an override when the image fails to load/sample", async () => {
    const img = document.createElement("img");
    img.src = "https://example.com/broken.png";
    document.body.appendChild(img);

    const overrides = await planImageOverrides(document, async () => null);
    expect(overrides).toHaveLength(0);
  });

  it("deduplicates two <img> elements pointing at the exact same src into one override", async () => {
    const img1 = document.createElement("img");
    img1.src = "https://example.com/icon.png";
    const img2 = document.createElement("img");
    img2.src = "https://example.com/icon.png";
    document.body.append(img1, img2);

    const overrides = await planImageOverrides(document, async () => solidGrid());
    expect(overrides).toHaveLength(1);
  });

  it("escapes any double quote that reaches the selector builder, so a malformed value can never break out of the attribute string", async () => {
    // Real `src` values are parsed as URLs, which percent-encode a literal
    // `"` before it ever reaches us — this test exercises the escaping
    // function directly against a value containing a raw quote, since a
    // future non-URL-sourced caller (or a browser with different URL
    // parsing behavior) must not be able to break out of the generated
    // `[src="..."]` selector.
    const img = document.createElement("img");
    img.setAttribute("src", "https://example.com/icon.png");
    // Force a value containing a literal quote past the URL-parsing getter.
    Object.defineProperty(img, "currentSrc", { value: 'https://example.com/a"b.png' });
    document.body.appendChild(img);

    const overrides = await planImageOverrides(document, async () => solidGrid());
    expect(overrides[0]!.selectorText).toBe('img[src="https://example.com/a\\"b.png"]');
  });

  it("skips <img> elements with no resolvable src", async () => {
    const img = document.createElement("img");
    document.body.appendChild(img);

    const overrides = await planImageOverrides(document, async () => solidGrid());
    expect(overrides).toHaveLength(0);
  });
});
