import { beforeEach, describe, expect, it } from "vitest";
import { findInlineStyledElements } from "./inline-style-scan.js";

describe("findInlineStyledElements", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("finds elements with an inline style attribute", () => {
    const div = document.createElement("div");
    div.setAttribute("style", "color: red;");
    document.body.appendChild(div);

    const found = findInlineStyledElements(document);
    expect(found).toContain(div);
  });

  it("does not find elements with no style attribute", () => {
    const div = document.createElement("div");
    document.body.appendChild(div);

    const found = findInlineStyledElements(document);
    expect(found).not.toContain(div);
  });

  it("does not find elements with an empty style attribute", () => {
    const div = document.createElement("div");
    div.setAttribute("style", "");
    document.body.appendChild(div);

    const found = findInlineStyledElements(document);
    expect(found).not.toContain(div);
  });

  it("finds inline-styled elements inside a shadow root", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    const inner = document.createElement("span");
    inner.setAttribute("style", "background-color: white;");
    shadow.appendChild(inner);

    const found = findInlineStyledElements(document);
    expect(found).toContain(inner);
  });
});
