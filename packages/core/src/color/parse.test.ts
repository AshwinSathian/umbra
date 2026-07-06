import { describe, expect, it } from "vitest";
import { parseCssColor } from "./parse.js";
import { formatCssColor } from "./format.js";

function expectClose(actual: number, expected: number, precision = 2) {
  expect(actual).toBeCloseTo(expected, precision);
}

describe("parseCssColor", () => {
  it("parses 3, 6, and 8 digit hex", () => {
    expectClose(parseCssColor("#fff")!.r, 1);
    expectClose(parseCssColor("#000")!.r, 0);
    const red = parseCssColor("#ff0000")!;
    expectClose(red.r, 1);
    expectClose(red.g, 0);
    expectClose(red.b, 0);
    expectClose(red.a, 1);
    const halfAlpha = parseCssColor("#ff000080")!;
    expectClose(halfAlpha.a, 0.502, 2);
  });

  it("parses legacy comma rgb()/rgba()", () => {
    const c = parseCssColor("rgba(10, 20, 30, 0.5)")!;
    expectClose(c.r, 10 / 255);
    expectClose(c.g, 20 / 255);
    expectClose(c.b, 30 / 255);
    expectClose(c.a, 0.5);
  });

  it("parses modern space/slash rgb()", () => {
    const c = parseCssColor("rgb(10 20 30 / 50%)")!;
    expectClose(c.r, 10 / 255);
    expectClose(c.a, 0.5);
  });

  it("parses percentage rgb channels", () => {
    const c = parseCssColor("rgb(100%, 0%, 0%)")!;
    expectClose(c.r, 1);
    expectClose(c.g, 0);
  });

  it("parses hsl()/hsla()", () => {
    const red = parseCssColor("hsl(0, 100%, 50%)")!;
    expectClose(red.r, 1);
    expectClose(red.g, 0);
    expectClose(red.b, 0);

    const semiTransparentBlue = parseCssColor("hsla(240, 100%, 50%, 0.25)")!;
    expectClose(semiTransparentBlue.b, 1);
    expectClose(semiTransparentBlue.a, 0.25);
  });

  it("parses named colors", () => {
    const c = parseCssColor("cornflowerblue")!;
    expectClose(c.r, 100 / 255);
    expectClose(c.g, 149 / 255);
    expectClose(c.b, 237 / 255);
  });

  it("treats transparent as alpha 0", () => {
    expect(parseCssColor("transparent")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it("returns null for values requiring resolution context", () => {
    expect(parseCssColor("currentcolor")).toBeNull();
    expect(parseCssColor("inherit")).toBeNull();
    expect(parseCssColor("")).toBeNull();
  });

  it("returns null for unrecognized input rather than guessing", () => {
    expect(parseCssColor("not-a-color")).toBeNull();
  });
});

describe("formatCssColor round-trip", () => {
  it("round-trips through parse -> format -> parse within rounding error", () => {
    const original = parseCssColor("#3366cc")!;
    const reparsed = parseCssColor(formatCssColor(original))!;
    expectClose(reparsed.r, original.r, 2);
    expectClose(reparsed.g, original.g, 2);
    expectClose(reparsed.b, original.b, 2);
  });
});
