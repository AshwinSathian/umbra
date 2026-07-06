import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "happy-dom",
    // Without this, happy-dom auto-fetches any <link rel=stylesheet href>
    // a test appends to the DOM as a real side effect (real DNS lookups /
    // outbound requests to whatever example.com-style hosts tests use for
    // cross-origin fixtures — see dom/cross-origin-cache.test.ts). The code
    // under test never depends on this (it always uses its own injected
    // fetchCss callback, never window.fetch), so this was pure test-suite
    // non-determinism: real network/DNS behavior the suite doesn't control,
    // with no bearing on what's actually being tested.
    environmentOptions: {
      happyDOM: {
        settings: {
          disableCSSFileLoading: true,
          disableJavaScriptFileLoading: true,
        },
      },
    },
    include: ["packages/**/*.test.ts", "tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["packages/core/src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/*.d.ts"],
    },
  },
});
