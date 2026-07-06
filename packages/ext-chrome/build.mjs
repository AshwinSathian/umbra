import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(dir, "dist");

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

const shared = {
  outdir: distDir,
  bundle: true,
  target: "chrome99",
  minify: false,
  sourcemap: true,
  logLevel: "info",
};

// Content scripts and the popup are loaded as plain classic scripts (MV3
// does not support `"type": "module"` for content_scripts), so they must be
// self-contained IIFEs with no top-level import/export syntax.
await build({
  ...shared,
  entryPoints: {
    content: path.join(dir, "src/content/content-script.ts"),
    popup: path.join(dir, "src/popup/popup.ts"),
    options: path.join(dir, "src/options/options.ts"),
  },
  format: "iife",
});

// The background service worker is declared with `"type": "module"` in the
// manifest, so it can use ESM (and therefore top-level dynamic import, if
// ever needed).
await build({
  ...shared,
  entryPoints: { background: path.join(dir, "src/background/service-worker.ts") },
  format: "esm",
});

cpSync(path.join(dir, "manifest.json"), path.join(distDir, "manifest.json"));
cpSync(path.join(dir, "src/popup/popup.html"), path.join(distDir, "popup.html"));
cpSync(path.join(dir, "src/options/options.html"), path.join(distDir, "options.html"));
cpSync(path.join(dir, "icons"), path.join(distDir, "icons"), { recursive: true });

console.log("Built extension to", distDir);
