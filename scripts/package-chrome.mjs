// Builds packages/ext-chrome fresh and zips its dist/ contents into a
// Chrome Web Store-ready upload package at store/chrome/build/. The zip
// contains the *contents* of dist/ at its root (manifest.json at the top
// level), which is what the Chrome Web Store dashboard's upload expects —
// zipping the dist/ directory itself (nesting everything one level deep)
// is a common submission mistake this script avoids by construction.
//
// Source maps (*.js.map) are intentionally excluded from the shipped zip:
// they're not needed for Chrome's review (the unminified, unbundled source
// is already public in this repo) and only bloat the artifact users
// download from the store listing page's "view source" affordance.
//
// Run manually: `node scripts/package-chrome.mjs`.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dir, "..");
const extChromeDir = path.join(repoRoot, "packages/ext-chrome");
const distDir = path.join(extChromeDir, "dist");
const outDir = path.join(repoRoot, "store/chrome/build");

console.log("Building packages/ext-chrome...");
execFileSync("node", [path.join(extChromeDir, "build.mjs")], { stdio: "inherit", cwd: extChromeDir });

const manifest = JSON.parse(readFileSync(path.join(distDir, "manifest.json"), "utf8"));
const version = manifest.version;
if (!version) throw new Error("manifest.json has no version field");

mkdirSync(outDir, { recursive: true });
const zipPath = path.join(outDir, `darkframe-chrome-v${version}.zip`);
if (existsSync(zipPath)) rmSync(zipPath);

execFileSync("zip", ["-r", "-X", zipPath, ".", "-x", "*.map"], { cwd: distDir, stdio: "inherit" });

console.log(`\nWrote ${path.relative(repoRoot, zipPath)} — ready to upload to the Chrome Web Store Developer Dashboard.`);
