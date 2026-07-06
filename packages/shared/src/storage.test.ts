import { describe, expect, it } from "vitest";
import { GLOBAL_ENABLED_KEY, resolveEnabled, siteOverrideKey } from "./storage.js";

describe("siteOverrideKey", () => {
  it("namespaces the key by origin", () => {
    expect(siteOverrideKey("https://example.com")).toBe("umbra:site:https://example.com");
  });

  it("produces distinct keys for distinct origins", () => {
    expect(siteOverrideKey("https://a.com")).not.toBe(siteOverrideKey("https://b.com"));
  });
});

describe("resolveEnabled", () => {
  it("force-on wins even when globally disabled", () => {
    expect(resolveEnabled(false, "force-on")).toBe(true);
  });

  it("force-off wins even when globally enabled", () => {
    expect(resolveEnabled(true, "force-off")).toBe(false);
  });

  it("falls through to the global setting when override is 'default'", () => {
    expect(resolveEnabled(true, "default")).toBe(true);
    expect(resolveEnabled(false, "default")).toBe(false);
  });

  it("falls through to the global setting when override is undefined (no stored override yet)", () => {
    expect(resolveEnabled(true, undefined)).toBe(true);
    expect(resolveEnabled(false, undefined)).toBe(false);
  });
});

describe("GLOBAL_ENABLED_KEY", () => {
  it("is a stable, namespaced storage key", () => {
    expect(GLOBAL_ENABLED_KEY).toBe("umbra:enabledGlobally");
  });
});
