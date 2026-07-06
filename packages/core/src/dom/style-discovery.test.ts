import { beforeEach, describe, expect, it } from "vitest";
import { MANAGED_STYLE_ID, MANAGED_STYLE_MARKER_ATTR } from "./layer-injector.js";
import { discoverStylesheets, getAllStyleRoots, walkShadowRoots } from "./style-discovery.js";

describe("walkShadowRoots / getAllStyleRoots", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });

  it("finds shadow roots nested inside other shadow roots", () => {
    const outerHost = document.createElement("div");
    document.body.appendChild(outerHost);
    const outerRoot = outerHost.attachShadow({ mode: "open" });

    const innerHost = document.createElement("div");
    outerRoot.appendChild(innerHost);
    const innerRoot = innerHost.attachShadow({ mode: "open" });

    const found = walkShadowRoots(document.documentElement);
    expect(found).toContain(outerRoot);
    expect(found).toContain(innerRoot);
  });

  it("includes the document itself plus every shadow root", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });

    const roots = getAllStyleRoots(document);
    expect(roots).toContain(document);
    expect(roots).toContain(shadow);
  });
});

describe("discoverStylesheets", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });

  it("discovers a <style> element in the main document", () => {
    const style = document.createElement("style");
    style.textContent = "a { color: red; }";
    document.head.appendChild(style);

    const found = discoverStylesheets(document);
    const styleEntry = found.find((f) => f.source === "style-element" && f.root === document);
    expect(styleEntry).toBeDefined();
    expect(styleEntry?.corsBlocked).toBe(false);
  });

  it("discovers a <style> element inside a shadow root, attributed to that root", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = ".x { color: blue; }";
    shadow.appendChild(style);

    const found = discoverStylesheets(document);
    const shadowEntry = found.find((f) => f.root === shadow);
    expect(shadowEntry).toBeDefined();
    expect(shadowEntry?.source).toBe("style-element");
  });

  it("marks an unfetched cross-document <link> stylesheet as needing fallback resolution", () => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://example.com/styles.css";
    document.head.appendChild(link);

    const found = discoverStylesheets(document);
    const linkEntry = found.find((f) => f.source === "link-element");
    expect(linkEntry).toBeDefined();
    expect(linkEntry?.href).toBe("https://example.com/styles.css");
    // happy-dom never resolves this cross-origin <link> to a live sheet —
    // structurally identical to a real CORS block, and both must be routed
    // through the network-fetch fallback rather than silently skipped.
    expect(linkEntry?.sheet).toBeNull();
    expect(linkEntry?.corsBlocked).toBe(true);
  });

  it("REGRESSION: never discovers Umbra's own managed stylesheet as page content", () => {
    // Without this exclusion, a second theme render would find its own
    // previously-injected @layer stylesheet, walk into its rules (an
    // @layer block has .cssRules like any grouping rule), and recolor its
    // own prior output as if it were a fresh, page-authored rule —
    // producing a duplicate, further-recolored "body {...}" rule that then
    // won the cascade over the correct one. This was a real, observed bug
    // (see theme-engine.ts / style-discovery.ts for the full account).
    const managed = document.createElement("style");
    managed.id = MANAGED_STYLE_ID;
    managed.setAttribute(MANAGED_STYLE_MARKER_ATTR, "true");
    managed.textContent = "@layer umbra { body { background-color: rgba(72, 72, 72, 1) !important; } }";
    document.head.appendChild(managed);

    const found = discoverStylesheets(document);
    expect(found.some((f) => f.sheet?.ownerNode === managed)).toBe(false);
  });
});
