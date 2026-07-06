import { describe, expect, it } from "vitest";
import { CORE_VERSION } from "./index.js";

describe("core package scaffold", () => {
  it("exposes a version string", () => {
    expect(CORE_VERSION).toBe("0.1.0");
  });
});
