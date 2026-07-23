// Gets Darkframe running in a real Chrome and/or Safari on this machine
// without either store submission — builds from source and drives as much
// of the "Load unpacked" / "run from Xcode" path as the browsers allow a
// script to automate. Neither browser exposes a way to script the actual
// install click (Chrome's "Load unpacked" and Safari's extension-enable
// toggle are deliberately human-gated UI, to stop something like this
// script from silently installing an unpacked extension on someone's
// behalf) — that one click per browser is an intentional security
// boundary, not a gap in this script. Everything before and around it is
// automated: dependency install, build, structural validation of the
// build output, locating an installed Chromium-family browser and opening
// it straight to chrome://extensions, copying the exact folder to paste
// into its file picker, and for Safari, running xcodebuild and opening the
// resulting .app.
//
// Usage: node scripts/install-local.mjs [--chrome] [--safari] [--all]
//                                        [--no-open] [--verify] [--skip-install]
//   (no target flag)  build+set up whatever this OS supports (default)
//   --chrome           Chrome/Chromium-family only
//   --safari           Safari only (macOS + Xcode required; hard error off-macOS)
//   --all              force both, even if a flag would otherwise narrow it
//   --no-open          build and verify only; don't launch any app
//   --verify           also run the real-browser Playwright check
//                       (tests/e2e/verify-extension.mjs) after building Chrome
//   --skip-install     skip `pnpm install` (assume node_modules is current)
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dir, "..");
const platform = os.platform();
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);

if (flag("--help") || flag("-h")) {
  printHelp();
  process.exit(0);
}

const explicitChrome = flag("--chrome");
const explicitSafari = flag("--safari");
const explicitAll = flag("--all");
const noTargetFlag = !explicitChrome && !explicitSafari && !explicitAll;
const doChrome = explicitChrome || explicitAll || noTargetFlag;
const wantSafari = explicitSafari || explicitAll || noTargetFlag;
const openApps = !flag("--no-open");
const runDeepVerify = flag("--verify");
const skipInstall = flag("--skip-install");

if (explicitSafari && platform !== "darwin") {
  fail("--safari was requested, but Safari extensions can only be built on macOS (Xcode is macOS-only).");
}
// wantSafari but not explicit: silently narrow to what this OS can do,
// rather than failing a plain default run on Linux/Windows.
const doSafari = wantSafari && platform === "darwin";

section("Darkframe local install");
console.log(
  `Targets: ${[doChrome && "Chrome", doSafari && "Safari"].filter(Boolean).join(" + ") || "(none)"}` +
    (wantSafari && !doSafari ? "  (Safari skipped — not macOS)" : ""),
);

if (!doChrome && !doSafari) {
  fail("Nothing to do: Safari was requested but this isn't macOS, and Chrome wasn't requested.");
}

ensureNodeVersion();
const pnpm = ensurePnpm();

if (!skipInstall) {
  section("Installing workspace dependencies");
  run(pnpm, ["install"]);
} else {
  console.log("Skipping `pnpm install` (--skip-install).");
}

if (doChrome || doSafari) {
  // Both targets consume this build — Safari's sync step copies it in, so
  // building it once up front keeps it from going stale on either path.
  section("Building the Chrome/Web-Extension bundle");
  run(pnpm, ["--filter", "@darkframe/ext-chrome", "build"]);
}

let chromeReady = false;
if (doChrome) {
  chromeReady = verifyChromeDist();
}

let safariAppPath = null;
if (doSafari) {
  safariAppPath = buildAndLocateSafariApp();
}

if (doChrome && chromeReady && runDeepVerify) {
  section("Running real-browser verification (tests/e2e/verify-extension.mjs)");
  try {
    run("node", ["tests/e2e/verify-extension.mjs"]);
  } catch {
    console.log(
      "\nDeep verification failed or couldn't run (it needs a real display — Xvfb on headless " +
        "Linux). The build itself is still structurally valid; see output above for details.",
    );
  }
}

if (doChrome && chromeReady && openApps) {
  openChromeExtensionsPage();
}

if (doSafari && safariAppPath && openApps) {
  openSafariApp(safariAppPath);
}

printSummary({ chromeReady, safariAppPath });

// ---------------------------------------------------------------------------

function printHelp() {
  console.log(`Usage: node scripts/install-local.mjs [options]

Builds Darkframe from source and sets it up for local use in Chrome and/or
Safari — no Chrome Web Store or Mac App Store submission required.

Options:
  --chrome         Chrome/Chromium-family only
  --safari         Safari only (macOS + Xcode required)
  --all            force both targets
  --no-open        build and verify only, don't launch any app
  --verify         also run the real-browser Playwright e2e check
  --skip-install   skip \`pnpm install\`
  -h, --help       show this help

With no target flag, builds everything this OS supports (Safari is
automatically skipped outside macOS, not treated as an error).`);
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

function fail(message) {
  console.error(`\nError: ${message}`);
  process.exit(1);
}

function run(cmd, cmdArgs, opts = {}) {
  execFileSync(cmd, cmdArgs, { stdio: "inherit", cwd: repoRoot, ...opts });
}

function commandExists(cmd) {
  try {
    execFileSync(platform === "win32" ? "where" : "which", [cmd], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function ensureNodeVersion() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 20) {
    fail(
      `Node ${process.versions.node} detected — Darkframe requires Node >= 20. Install a newer ` +
        "Node (nvm/fnm/asdf, or https://nodejs.org) and re-run this script.",
    );
  }
}

function ensurePnpm() {
  if (commandExists("pnpm")) return "pnpm";
  const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  const pinned = pkg.packageManager; // e.g. "pnpm@10.19.0"
  console.log(`pnpm not found on PATH — enabling ${pinned} via Corepack (ships with Node >= 16.9)...`);
  try {
    execFileSync("corepack", ["enable"], { stdio: "inherit" });
    if (pinned) execFileSync("corepack", ["prepare", pinned, "--activate"], { stdio: "inherit" });
    if (commandExists("pnpm")) return "pnpm";
  } catch {
    // fall through to the hard failure below
  }
  fail(
    "pnpm is required and could not be enabled automatically via Corepack.\n" +
      "Install it yourself (see https://pnpm.io/installation) and re-run this script.",
  );
}

// Doesn't need a real browser or display: parses the built manifest.json
// and confirms every file it references actually landed in dist/. This is
// the difference between "esbuild exited 0" and "this is actually loadable
// by Chrome" — a truncated build (e.g. a mid-build crash after only some
// entry points finished) would exit 0 on the steps that did run but leave
// dist/ missing files the manifest still points at.
function verifyChromeDist() {
  section("Verifying the Chrome build");
  const distDir = path.join(repoRoot, "packages/ext-chrome/dist");
  const manifestPath = path.join(distDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    console.error(`Missing ${path.relative(repoRoot, manifestPath)} — build did not produce output.`);
    return false;
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (err) {
    console.error(`manifest.json is not valid JSON: ${err.message}`);
    return false;
  }

  const referenced = new Set();
  for (const size of Object.values(manifest.icons ?? {})) referenced.add(size);
  for (const size of Object.values(manifest.action?.default_icon ?? {})) referenced.add(size);
  if (manifest.action?.default_popup) referenced.add(manifest.action.default_popup);
  if (manifest.options_page) referenced.add(manifest.options_page);
  if (manifest.background?.service_worker) referenced.add(manifest.background.service_worker);
  for (const entry of manifest.content_scripts ?? []) {
    for (const js of entry.js ?? []) referenced.add(js);
    for (const css of entry.css ?? []) referenced.add(css);
  }

  const missing = [...referenced].filter((rel) => !existsSync(path.join(distDir, rel)));
  if (missing.length > 0) {
    console.error(`manifest.json references files that are missing from dist/:\n  ${missing.join("\n  ")}`);
    return false;
  }

  console.log(
    `OK — manifest.json valid, all ${referenced.size} referenced files present in ` +
      `${path.relative(repoRoot, distDir)}/.`,
  );
  return true;
}

function buildAndLocateSafariApp() {
  section("Building the Safari Xcode project");
  if (!commandExists("xcodebuild")) {
    console.error(
      "xcodebuild not found — install Xcode from the Mac App Store (free), then re-run with --safari.",
    );
    return null;
  }

  const xcodeprojDir = path.join(repoRoot, "packages/ext-safari/Darkframe");
  if (!existsSync(path.join(xcodeprojDir, "Darkframe.xcodeproj"))) {
    console.error(
      "No Xcode project at packages/ext-safari/Darkframe/Darkframe.xcodeproj — see " +
        "packages/ext-safari/build.mjs for the one-time `safari-web-extension-converter` " +
        "command that generates it.",
    );
    return null;
  }

  try {
    run(pnpm, ["--filter", "@darkframe/ext-safari", "build:xcode"]);
  } catch {
    console.error(
      "\nxcodebuild failed — see output above. This is usually a signing issue on first run; " +
        "open the project in Xcode once (open packages/ext-safari/Darkframe/Darkframe.xcodeproj), " +
        "let it provision the free ad-hoc \"Sign to Run Locally\" identity for both the " +
        "\"Darkframe\" and \"Darkframe Extension\" targets, then re-run this script.",
    );
    return null;
  }

  // Ask xcodebuild itself where the .app landed rather than guessing a
  // DerivedData path — that path includes a build-specific hash suffix
  // that isn't predictable from the project alone.
  let builtProductsDir;
  try {
    const settings = execFileSync(
      "xcodebuild",
      ["-project", "Darkframe.xcodeproj", "-scheme", "Darkframe", "-configuration", "Debug", "-showBuildSettings"],
      { cwd: xcodeprojDir, encoding: "utf8" },
    );
    const match = settings.match(/^\s*BUILT_PRODUCTS_DIR\s*=\s*(.+)$/m);
    builtProductsDir = match?.[1]?.trim();
  } catch (err) {
    console.error(`Built, but couldn't resolve the output path via xcodebuild -showBuildSettings: ${err.message}`);
    return null;
  }

  if (!builtProductsDir) {
    console.error("Built, but BUILT_PRODUCTS_DIR wasn't found in xcodebuild's settings output.");
    return null;
  }

  const appPath = path.join(builtProductsDir, "Darkframe.app");
  if (!existsSync(appPath)) {
    console.error(`Built, but expected app bundle not found at ${appPath}`);
    return null;
  }

  console.log(`OK — Darkframe.app built at ${appPath}`);
  return appPath;
}

// Chromium-family browsers all understand chrome://extensions and all
// support "Load unpacked" the same way, so any of these work — checking
// beyond just Google Chrome means this doesn't come up empty on a machine
// where the user's daily driver is Brave/Edge/Chromium instead.
function findChromiumBrowser() {
  const candidates =
    platform === "darwin"
      ? [
          { name: "Google Chrome", appPath: "/Applications/Google Chrome.app" },
          { name: "Chromium", appPath: "/Applications/Chromium.app" },
          { name: "Brave Browser", appPath: "/Applications/Brave Browser.app" },
          { name: "Microsoft Edge", appPath: "/Applications/Microsoft Edge.app" },
          { name: "Arc", appPath: "/Applications/Arc.app" },
        ]
      : platform === "win32"
        ? [
            { name: "Google Chrome", bin: "chrome" },
            { name: "Microsoft Edge", bin: "msedge" },
            { name: "Brave Browser", bin: "brave" },
          ]
        : [
            { name: "Google Chrome", bin: "google-chrome-stable" },
            { name: "Google Chrome", bin: "google-chrome" },
            { name: "Chromium", bin: "chromium-browser" },
            { name: "Chromium", bin: "chromium" },
            { name: "Brave Browser", bin: "brave-browser" },
            { name: "Microsoft Edge", bin: "microsoft-edge" },
          ];

  for (const c of candidates) {
    if (c.appPath && existsSync(c.appPath)) return c;
    if (c.bin && commandExists(c.bin)) return c;
  }
  return null;
}

function copyToClipboard(text) {
  try {
    if (platform === "darwin") {
      execFileSync("pbcopy", { input: text });
    } else if (platform === "win32") {
      execFileSync("clip", { input: text });
    } else if (commandExists("xclip")) {
      execFileSync("xclip", ["-selection", "clipboard"], { input: text });
    } else if (commandExists("wl-copy")) {
      execFileSync("wl-copy", { input: text });
    } else if (commandExists("xsel")) {
      execFileSync("xsel", ["--clipboard", "--input"], { input: text });
    } else {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function openChromeExtensionsPage() {
  section("Opening Chrome extensions page");
  const distDir = path.join(repoRoot, "packages/ext-chrome/dist");
  const copied = copyToClipboard(distDir);
  console.log(
    copied
      ? `Copied to clipboard — paste this into the "Load unpacked" folder picker:\n  ${distDir}`
      : `Folder to select in the "Load unpacked" picker:\n  ${distDir}`,
  );

  const browser = findChromiumBrowser();
  if (!browser) {
    console.log(
      "\nNo Chromium-family browser (Chrome/Chromium/Brave/Edge/Arc) was detected automatically — " +
        "install one, or open its extensions page manually and navigate to chrome://extensions.",
    );
    return;
  }

  try {
    if (platform === "darwin") {
      spawn("open", ["-a", browser.appPath, "chrome://extensions"], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn(browser.bin, ["chrome://extensions"], { detached: true, stdio: "ignore" }).unref();
    }
    console.log(`Opened chrome://extensions in ${browser.name}.`);
  } catch (err) {
    console.log(`Detected ${browser.name} but couldn't launch it automatically (${err.message}).`);
  }
}

function openSafariApp(appPath) {
  section("Opening Darkframe.app");
  try {
    spawn("open", [appPath], { detached: true, stdio: "ignore" }).unref();
    spawn("open", ["-a", "Safari"], { detached: true, stdio: "ignore" }).unref();
    console.log("Launched Darkframe.app and Safari.");
  } catch (err) {
    console.log(`Built successfully but couldn't launch automatically (${err.message}). Open it from Finder: ${appPath}`);
  }
}

function printSummary({ chromeReady, safariAppPath }) {
  section("Summary");
  if (doChrome) {
    console.log(
      chromeReady
        ? "Chrome: built + verified. In the extensions page: enable \"Developer mode\" (top " +
            "right), click \"Load unpacked\", and select packages/ext-chrome/dist (already on " +
            "your clipboard if this ran with clipboard support)."
        : "Chrome: build/verification failed — see errors above.",
    );
  }
  if (doSafari) {
    console.log(
      safariAppPath
        ? `Safari: built at ${safariAppPath}. With Darkframe.app running, enable the extension in ` +
            "Safari > Settings > Extensions (you may also need System Settings > Privacy & " +
            "Security > Extensions, and on some macOS versions, allowing unsigned extensions for " +
            "local dev builds — see README.md)."
        : "Safari: build failed — see errors above.",
    );
  }
  console.log("\nRe-run this script any time (e.g. after pulling new changes) — it's safe and idempotent.");
}
