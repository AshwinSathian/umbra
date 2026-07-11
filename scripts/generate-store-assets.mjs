// Generates Chrome Web Store screenshots and promo tiles from the real,
// running extension — not mockups. Loads the actual built
// packages/ext-chrome/dist into a real Chromium instance via Playwright
// (the same proven pattern as tests/e2e/verify-extension.mjs), drives a
// realistic demo page through it, and captures genuine before/after,
// popup, and options screenshots. Compositing (side-by-side layouts,
// captions, promo tiles) is done via a real browser <canvas>, the same
// "no external design tool, everything regenerable from source"
// philosophy as scripts/generate-icons.mjs.
//
// Captured screenshots are saved to disk and re-served over the local HTTP
// server as plain image URLs (rather than passed as base64 through
// page.evaluate() arguments) — passing multi-megabyte base64 strings as
// evaluate() *arguments* (not return values, which are fine) was found to
// reliably destabilize the CDP session on a page with an active content
// script mid-re-render, surfacing as a misleading "Execution context was
// destroyed" error. Loading via <img src="http://..."> avoids that
// argument-serialization path entirely.
//
// Run manually: `node scripts/generate-store-assets.mjs`. Requires a real
// display (or Xvfb on Linux) — same headless limitation as
// tests/e2e/verify-extension.mjs (extensions don't load under legacy
// `headless: true`).
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dir, "..");
const extensionPath = path.join(repoRoot, "packages/ext-chrome/dist");
const screenshotsDir = path.join(repoRoot, "store/chrome/screenshots");
const promoDir = path.join(repoRoot, "store/chrome/promo");
mkdirSync(screenshotsDir, { recursive: true });
mkdirSync(promoDir, { recursive: true });
const assetsDir = mkdtempSync(path.join(tmpdir(), "darkframe-store-assets-"));

if (!existsSync(path.join(extensionPath, "manifest.json"))) {
  console.log("Building packages/ext-chrome first...");
  execFileSync("node", [path.join(repoRoot, "packages/ext-chrome/build.mjs")], { stdio: "inherit" });
}

const BRAND_BG = "#120e1f";
const BRAND_ACCENT = "#a78bfa";

const demoPageHtml = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  body { margin: 0; background: #ffffff; color: #16151a; font-family: -apple-system, "Segoe UI", sans-serif; }
  header { display: flex; align-items: center; justify-content: space-between; padding: 20px 48px; border-bottom: 1px solid #e6e6ea; }
  .wordmark { font-size: 20px; font-weight: 700; letter-spacing: -0.02em; }
  nav { display: flex; gap: 20px; }
  .navicon { width: 22px; height: 22px; border-radius: 6px; }
  main { padding: 40px 48px; display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 40px; align-items: center; }
  h1 { font-size: 34px; line-height: 1.15; margin: 0 0 14px; letter-spacing: -0.02em; }
  p { font-size: 15px; line-height: 1.6; color: #4a4a55; max-width: 46ch; margin: 0 0 22px; }
  .btn { display: inline-block; padding: 10px 18px; border-radius: 8px; background: #6d28d9; color: white; font-size: 14px; font-weight: 600; text-decoration: none; }
  .hero-photo { width: 100%; border-radius: 14px; display: block; }
  .cards { padding: 0 48px 40px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
  .card { border: 1px solid #e6e6ea; border-radius: 12px; padding: 18px; }
  .card .navicon { margin-bottom: 10px; }
  .card h3 { font-size: 14px; margin: 0 0 6px; }
  .card p { font-size: 13px; margin: 0; max-width: none; }
</style>
</head>
<body>
  <header>
    <div class="wordmark">Everyday News</div>
    <nav>
      <img class="navicon" id="nav1" alt="">
      <img class="navicon" id="nav2" alt="">
      <img class="navicon" id="nav3" alt="">
    </nav>
  </header>
  <main>
    <div>
      <h1>Cities are quietly rebuilding their skylines for heat, not height</h1>
      <p>A look at the materials and shading strategies architects are betting on as summers
      get longer — and why the most interesting ideas are showing up in mid-size buildings,
      not landmark towers.</p>
      <a class="btn" href="#">Read the full story</a>
    </div>
    <img class="hero-photo" id="hero" alt="">
  </main>
  <section class="cards">
    <div class="card"><img class="navicon" id="c1" alt=""><h3>Materials</h3><p>Why clay and cork are back on architects' shortlists.</p></div>
    <div class="card"><img class="navicon" id="c2" alt=""><h3>Case study</h3><p>One block in Lyon cut peak indoor heat by 6°C.</p></div>
    <div class="card"><img class="navicon" id="c3" alt=""><h3>Opinion</h3><p>Height limits were never really about height.</p></div>
  </section>
</body>
</html>`;

setTimeout(() => {
  console.error("WATCHDOG: script did not finish within 90s.");
  process.exit(2);
}, 90000);

async function main() {
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith("/assets/")) {
      const file = path.join(assetsDir, path.basename(req.url.slice("/assets/".length)));
      if (existsSync(file)) {
        res.setHeader("Content-Type", "image/png");
        res.end(readFileSync(file));
        return;
      }
      res.statusCode = 404;
      res.end();
      return;
    }
    if (req.url === "/blank") {
      res.setHeader("Content-Type", "text/html");
      res.end("<!doctype html><title>compose</title>");
      return;
    }
    res.setHeader("Content-Type", "text/html");
    res.end(demoPageHtml);
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/`;
  const assetUrl = (name) => `http://127.0.0.1:${port}/assets/${name}`;

  const context = await chromium.launchPersistentContext("", {
    headless: false,
    viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, "--no-first-run"],
  });

  try {
    const page = await context.newPage();
    await page.goto(url);

    // Generate a genuinely photographic hero (gradient + shapes + film-grain
    // noise, so it reads as a photo to both the eye and the classifier —
    // high variance/edge-density, not a flat fill) and flat brand-colored
    // icons, all via the real browser canvas — same technique proven in
    // tests/e2e/verify-extension.mjs to round-trip byte-identical through
    // the "never touch photos" guarantee. Returned as evaluate() *return
    // values* (fine, even when large) rather than arguments.
    const images = await page.evaluate(() => {
      function toDataUrl(w, h, paint) {
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const ctx = c.getContext("2d");
        paint(ctx, w, h);
        return c.toDataURL("image/png");
      }
      const heroDataUrl = toDataUrl(560, 420, (ctx, w, h) => {
        const sky = ctx.createLinearGradient(0, 0, 0, h);
        sky.addColorStop(0, "#ff9d6c");
        sky.addColorStop(0.55, "#f97b6a");
        sky.addColorStop(1, "#8f5ab8");
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "rgba(255,214,140,0.9)";
        ctx.beginPath();
        ctx.arc(w * 0.72, h * 0.32, 46, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#2a2140";
        ctx.beginPath();
        ctx.moveTo(0, h * 0.62);
        for (let x = 0; x <= w; x += 20) {
          ctx.lineTo(x, h * 0.62 - Math.sin(x * 0.02) * 24 - (x % 140 < 70 ? 40 : 0));
        }
        ctx.lineTo(w, h);
        ctx.lineTo(0, h);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#171126";
        ctx.beginPath();
        ctx.moveTo(0, h * 0.8);
        for (let x = 0; x <= w; x += 16) {
          ctx.lineTo(x, h * 0.8 - Math.sin(x * 0.035 + 2) * 16 - (x % 90 < 40 ? 28 : 0));
        }
        ctx.lineTo(w, h);
        ctx.lineTo(0, h);
        ctx.closePath();
        ctx.fill();
        // Film grain: real per-pixel variance, not just a smooth gradient,
        // so the classifier's edge/variance signals read "photo" robustly.
        const imgData = ctx.getImageData(0, 0, w, h);
        let seed = 42;
        const rand = () => {
          seed = (seed * 1103515245 + 12345) & 0x7fffffff;
          return (seed % 1000) / 1000;
        };
        for (let i = 0; i < imgData.data.length; i += 4) {
          const n = (rand() - 0.5) * 26;
          imgData.data[i] = Math.max(0, Math.min(255, imgData.data[i] + n));
          imgData.data[i + 1] = Math.max(0, Math.min(255, imgData.data[i + 1] + n));
          imgData.data[i + 2] = Math.max(0, Math.min(255, imgData.data[i + 2] + n));
        }
        ctx.putImageData(imgData, 0, 0);
      });
      function flatIcon(color) {
        return toDataUrl(48, 48, (ctx, w, h) => {
          ctx.fillStyle = color;
          const r = 10;
          ctx.beginPath();
          ctx.moveTo(r, 0);
          ctx.arcTo(w, 0, w, h, r);
          ctx.arcTo(w, h, 0, h, r);
          ctx.arcTo(0, h, 0, 0, r);
          ctx.arcTo(0, 0, w, 0, r);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = "#ffffff";
          ctx.beginPath();
          ctx.arc(w / 2, h / 2, w * 0.22, 0, Math.PI * 2);
          ctx.fill();
        });
      }
      return {
        heroDataUrl,
        navIcons: [flatIcon("#6d28d9"), flatIcon("#2563eb"), flatIcon("#16a34a")],
        cardIcons: [flatIcon("#ea580c"), flatIcon("#0891b2"), flatIcon("#db2777")],
      };
    });

    // Assigning these back onto <img> elements is a *small* per-element
    // argument each (one string per call), not one giant combined payload,
    // which keeps this well clear of the instability described above.
    await page.evaluate((v) => (document.getElementById("hero").src = v), images.heroDataUrl);
    await page.evaluate((v) => (document.getElementById("nav1").src = v), images.navIcons[0]);
    await page.evaluate((v) => (document.getElementById("nav2").src = v), images.navIcons[1]);
    await page.evaluate((v) => (document.getElementById("nav3").src = v), images.navIcons[2]);
    await page.evaluate((v) => (document.getElementById("c1").src = v), images.cardIcons[0]);
    await page.evaluate((v) => (document.getElementById("c2").src = v), images.cardIcons[1]);
    await page.evaluate((v) => (document.getElementById("c3").src = v), images.cardIcons[2]);
    await page.waitForTimeout(1500);

    // --- Screenshot 1: the themed page, full-bleed (Google's own
    // recommended style: "square corners, no padding"). ---
    await page.screenshot({ path: path.join(screenshotsDir, "01-themed-page.png") });
    console.log("Wrote 01-themed-page.png");

    await page.screenshot({ path: path.join(assetsDir, "dark.png") });

    // --- Toggle off (same real message-contract technique as the E2E
    // suite) to capture the true "before" state for a before/after. ---
    const serviceWorker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    const pageOrigin = new URL(url).origin;
    async function setEnabled(enabled) {
      return serviceWorker.evaluate(
        async ({ origin, enabled }) => {
          await chrome.storage.local.set({ [`darkframe:site:${origin}`]: enabled ? "force-on" : "force-off" });
          const tabs = await chrome.tabs.query({});
          for (const tab of tabs) {
            if (tab.id === undefined) continue;
            try {
              await chrome.tabs.sendMessage(tab.id, { type: "darkframe:toggle", origin, enabled });
            } catch {
              // no content script in this tab — expected
            }
          }
        },
        { origin: pageOrigin, enabled },
      );
    }
    await setEnabled(false);
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(assetsDir, "light.png") });
    await setEnabled(true);
    await page.waitForTimeout(500);

    const extensionId = serviceWorker.url().split("/")[2];

    const popupPage = await context.newPage();
    await popupPage.setViewportSize({ width: 340, height: 460 });
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
    await popupPage.waitForTimeout(300);
    await popupPage.screenshot({ path: path.join(assetsDir, "popup.png") });
    await popupPage.close();

    const optionsPage = await context.newPage();
    await optionsPage.setViewportSize({ width: 480, height: 760 });
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);
    await optionsPage.waitForTimeout(300);
    await optionsPage.screenshot({ path: path.join(assetsDir, "options.png") });
    await optionsPage.close();

    // From here on, all compositing happens on a *fresh* tab with no
    // content script attached at all (about:blank never matches
    // http(s)://* content_scripts), fully isolated from the extension's
    // own toggle/re-render activity above.
    const composePage = await context.newPage();
    await composePage.goto(`${url}blank`);

    // --- Screenshot 2: before/after composite, built in a real <canvas>,
    // loading each source image via a plain (small) URL argument. ---
    async function composeBeforeAfter(lightUrl, darkUrl, outFile) {
      const dataUrl = await composePage.evaluate(
        ({ lightUrl, darkUrl }) => {
          const c = document.createElement("canvas");
          c.width = 1280;
          c.height = 800;
          const ctx = c.getContext("2d");
          return new Promise((resolve, reject) => {
            const imgLight = new Image();
            const imgDark = new Image();
            let loaded = 0;
            const onLoad = () => {
              loaded++;
              if (loaded < 2) return;
              const halfW = 640;
              ctx.drawImage(imgLight, 0, 0, 1280, 800, 0, 0, halfW, 800);
              ctx.drawImage(imgDark, 0, 0, 1280, 800, halfW, 0, halfW, 800);
              ctx.strokeStyle = "#a78bfa";
              ctx.lineWidth = 4;
              ctx.beginPath();
              ctx.moveTo(halfW, 0);
              ctx.lineTo(halfW, 800);
              ctx.stroke();
              function pill(text, x) {
                ctx.font = "600 15px -apple-system, sans-serif";
                const textW = ctx.measureText(text).width;
                const padX = 14;
                const pillW = textW + padX * 2;
                const pillH = 32;
                const y = 24;
                ctx.fillStyle = "rgba(18,14,31,0.85)";
                ctx.beginPath();
                ctx.roundRect(x, y, pillW, pillH, 16);
                ctx.fill();
                ctx.fillStyle = "#ffffff";
                ctx.fillText(text, x + padX, y + 21);
              }
              pill("Before — Darkframe off", 20);
              pill("After — Darkframe on, photo untouched", halfW + 20);
              resolve(c.toDataURL("image/png"));
            };
            imgLight.onload = onLoad;
            imgDark.onload = onLoad;
            imgLight.onerror = () => reject(new Error("failed to load light image"));
            imgDark.onerror = () => reject(new Error("failed to load dark image"));
            imgLight.src = lightUrl;
            imgDark.src = darkUrl;
          });
        },
        { lightUrl, darkUrl },
      );
      writeFileSync(path.join(screenshotsDir, outFile), Buffer.from(dataUrl.split(",")[1], "base64"));
      console.log("Wrote", outFile);
    }
    await composeBeforeAfter(assetUrl("light.png"), assetUrl("dark.png"), "02-before-after.png");

    // --- Screenshots 3/4: popup and options, composed onto the dark page
    // as a realistic backdrop rather than bare white-background captures. ---
    async function composePanel(backdropUrl, panelUrl, panelW, panelH, caption, outFile) {
      const dataUrl = await composePage.evaluate(
        ({ backdropUrl, panelUrl, panelW, panelH, caption }) => {
          const c = document.createElement("canvas");
          c.width = 1280;
          c.height = 800;
          const ctx = c.getContext("2d");
          return new Promise((resolve, reject) => {
            const backdrop = new Image();
            const panel = new Image();
            let loaded = 0;
            const onLoad = () => {
              loaded++;
              if (loaded < 2) return;
              ctx.drawImage(backdrop, 0, 0, 1280, 800, 0, 0, 1280, 800);
              ctx.fillStyle = "rgba(10,8,18,0.82)";
              ctx.fillRect(0, 0, 1280, 800);
              const scale = Math.min(1, 560 / panelW, 620 / panelH);
              const w = panelW * scale;
              const h = panelH * scale;
              const x = 1280 - w - 90;
              const y = (800 - h) / 2;
              ctx.shadowColor = "rgba(0,0,0,0.5)";
              ctx.shadowBlur = 40;
              ctx.fillStyle = "#ffffff";
              ctx.beginPath();
              ctx.roundRect(x - 2, y - 2, w + 4, h + 4, 14);
              ctx.fill();
              ctx.shadowBlur = 0;
              ctx.save();
              ctx.beginPath();
              ctx.roundRect(x, y, w, h, 12);
              ctx.clip();
              ctx.drawImage(panel, x, y, w, h);
              ctx.restore();
              ctx.fillStyle = "#ffffff";
              ctx.font = "700 34px -apple-system, sans-serif";
              caption.split("\n").forEach((line, i) => ctx.fillText(line, 90, 320 + i * 44, 640));
              resolve(c.toDataURL("image/png"));
            };
            backdrop.onload = onLoad;
            panel.onload = onLoad;
            backdrop.onerror = () => reject(new Error("failed to load backdrop image"));
            panel.onerror = () => reject(new Error("failed to load panel image"));
            backdrop.src = backdropUrl;
            panel.src = panelUrl;
          });
        },
        { backdropUrl, panelUrl, panelW, panelH, caption },
      );
      writeFileSync(path.join(screenshotsDir, outFile), Buffer.from(dataUrl.split(",")[1], "base64"));
      console.log("Wrote", outFile);
    }
    await composePanel(assetUrl("dark.png"), assetUrl("popup.png"), 340, 460, "One click,\nany site.", "03-popup.png");
    await composePanel(assetUrl("dark.png"), assetUrl("options.png"), 480, 760, "Tune it your way.", "04-options.png");

    // --- Screenshot 5: a plain feature-highlight card, canvas-drawn. ---
    const featuresDataUrl = await composePage.evaluate(
      ({ bg, accent }) => {
        const c = document.createElement("canvas");
        c.width = 1280;
        c.height = 800;
        const ctx = c.getContext("2d");
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, 1280, 800);
        ctx.fillStyle = accent;
        ctx.font = "700 46px -apple-system, sans-serif";
        ctx.fillText("Built around one rule:", 90, 170);
        ctx.fillStyle = "#ffffff";
        ctx.fillText("photos are never altered.", 90, 226);
        const items = [
          "Variance + edge-density image classifier, not a global brightness average",
          "OKLCH perceptual color remap — hues stay correct, no muddy inversions",
          "WCAG 2.1 contrast-solved text on every recolor",
          "Zero telemetry. Zero analytics. Zero paid tier — on Chrome or Safari.",
        ];
        ctx.font = "400 22px -apple-system, sans-serif";
        items.forEach((text, i) => {
          const y = 320 + i * 64;
          ctx.fillStyle = accent;
          ctx.beginPath();
          ctx.arc(100, y - 8, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#e8e6f0";
          ctx.fillText(text, 124, y, 1050);
        });
        return c.toDataURL("image/png");
      },
      { bg: BRAND_BG, accent: BRAND_ACCENT },
    );
    writeFileSync(path.join(screenshotsDir, "05-features.png"), Buffer.from(featuresDataUrl.split(",")[1], "base64"));
    console.log("Wrote 05-features.png");

    // --- Promo tiles: brand mark only, minimal text (Google's own advice
    // is to avoid text on promo tiles). ---
    async function makePromoTile(w, h, outFile, iconSize) {
      const dataUrl = await composePage.evaluate(
        ({ w, h, bg, accent, iconSize }) => {
          const c = document.createElement("canvas");
          c.width = w;
          c.height = h;
          const ctx = c.getContext("2d");
          ctx.fillStyle = bg;
          ctx.fillRect(0, 0, w, h);
          const cx = w / 2;
          const cy = h / 2;
          ctx.fillStyle = accent;
          ctx.beginPath();
          ctx.arc(cx, cy, iconSize * 0.36, 0, Math.PI * 2);
          ctx.fill();
          // Unlike the toolbar icon (generate-icons.mjs), this tile must be
          // fully opaque — it's embedded on an unpredictable store-page
          // background, not composited by the browser chrome. So the
          // crescent "bite" is painted with the actual bg color, not cut
          // out via destination-out (which would leave a transparent hole
          // that only coincidentally looks right on a white page).
          ctx.fillStyle = bg;
          ctx.beginPath();
          ctx.arc(cx + iconSize * 0.16, cy - iconSize * 0.12, iconSize * 0.3, 0, Math.PI * 2);
          ctx.fill();
          return c.toDataURL("image/png");
        },
        { w, h, bg: BRAND_BG, accent: BRAND_ACCENT, iconSize },
      );
      writeFileSync(path.join(promoDir, outFile), Buffer.from(dataUrl.split(",")[1], "base64"));
      console.log("Wrote", outFile);
    }
    await makePromoTile(440, 280, "small-tile-440x280.png", 220);
    await makePromoTile(1400, 560, "marquee-1400x560.png", 380);

    await context.close();
    server.close();
    rmSync(assetsDir, { recursive: true, force: true });
    console.log("\nAll store assets generated.");
    process.exit(0);
  } catch (err) {
    console.error(err);
    await context.close();
    server.close();
    rmSync(assetsDir, { recursive: true, force: true });
    process.exit(1);
  }
}

main();
