import { describe, expect, it } from "vitest";
import { isProtectedMediaElement } from "./media-guard.js";

describe("isProtectedMediaElement", () => {
  it("protects video, canvas, and audio elements", () => {
    expect(isProtectedMediaElement(document.createElement("video"))).toBe(true);
    expect(isProtectedMediaElement(document.createElement("canvas"))).toBe(true);
    expect(isProtectedMediaElement(document.createElement("audio"))).toBe(true);
  });

  it("does not protect ordinary elements, including img", () => {
    expect(isProtectedMediaElement(document.createElement("img"))).toBe(false);
    expect(isProtectedMediaElement(document.createElement("div"))).toBe(false);
    expect(isProtectedMediaElement(document.createElement("picture"))).toBe(false);
  });
});
