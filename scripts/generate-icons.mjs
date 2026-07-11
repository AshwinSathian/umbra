// Generates Darkframe's extension icons (a crescent-moon "shadow" mark) at every
// size Chrome/Safari need, using a real browser canvas via Playwright rather
// than a design tool — self-contained, no binary assets checked in as
// "source", regenerable any time from this script.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const chromeIconsDir = path.join(dir, "../packages/ext-chrome/icons");
const appIconSetDir = path.join(
  dir,
  "../packages/ext-safari/Darkframe/Darkframe/Assets.xcassets/AppIcon.appiconset",
);
const largeIconSetDir = path.join(
  dir,
  "../packages/ext-safari/Darkframe/Darkframe/Assets.xcassets/LargeIcon.imageset",
);
mkdirSync(chromeIconsDir, { recursive: true });
mkdirSync(appIconSetDir, { recursive: true });
mkdirSync(largeIconSetDir, { recursive: true });

const CHROME_SIZES = [16, 32, 48, 128];
// macOS AppIcon.appiconset needs every (size, scale) pixel dimension Xcode's
// Contents.json declares: 16/32/32/64/128/256/256/512/512/1024.
const MAC_APP_ICON_SIZES = [16, 32, 64, 128, 256, 512, 1024];
// LargeIcon.imageset (Safari's extension-list icon) has no fixed size in
// its Contents.json; 128/256/384 (1x/2x/3x of 128pt) is a reasonable,
// commonly-used choice for this context.
const LARGE_ICON_SIZES = [128, 256, 384];

const ALL_SIZES = [...new Set([...CHROME_SIZES, ...MAC_APP_ICON_SIZES, ...LARGE_ICON_SIZES])];

function paintIcon(ctx, size) {
  const r = size / 2;
  // Background: solid dark rounded square — a gradient here turns to mud
  // at 16px, so flat color is deliberate, not a missed opportunity.
  const radius = size * 0.22;
  ctx.fillStyle = "#120e1f";
  ctx.beginPath();
  ctx.moveTo(radius, 0);
  ctx.arcTo(size, 0, size, size, radius);
  ctx.arcTo(size, size, 0, size, radius);
  ctx.arcTo(0, size, 0, 0, radius);
  ctx.arcTo(0, 0, size, 0, radius);
  ctx.closePath();
  ctx.fill();

  // Crescent: a bright solid disc with a second, offset dark disc cut out
  // of it (classic crescent-moon construction) — a shadow/dark-mode motif,
  // independent of the exact product name. Sized generously and kept a
  // single flat bright color so it stays legible down to 16px.
  ctx.fillStyle = "#a78bfa";
  ctx.beginPath();
  ctx.arc(r, r, size * 0.36, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.arc(r + size * 0.16, r - size * 0.12, size * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const pngBySize = new Map();

  for (const size of ALL_SIZES) {
    const dataUrl = await page.evaluate(
      ({ size, paintIconSrc }) => {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        const paintIcon = eval(`(${paintIconSrc})`);
        paintIcon(ctx, size);
        return canvas.toDataURL("image/png");
      },
      { size, paintIconSrc: paintIcon.toString() },
    );
    pngBySize.set(size, Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ""), "base64"));
  }

  await browser.close();

  for (const size of CHROME_SIZES) {
    const filePath = path.join(chromeIconsDir, `icon-${size}.png`);
    writeFileSync(filePath, pngBySize.get(size));
    console.log("Wrote", filePath);
  }

  const macIconFiles = [
    ["16x16", "1x", 16, "icon_16x16.png"],
    ["16x16", "2x", 32, "icon_16x16@2x.png"],
    ["32x32", "1x", 32, "icon_32x32.png"],
    ["32x32", "2x", 64, "icon_32x32@2x.png"],
    ["128x128", "1x", 128, "icon_128x128.png"],
    ["128x128", "2x", 256, "icon_128x128@2x.png"],
    ["256x256", "1x", 256, "icon_256x256.png"],
    ["256x256", "2x", 512, "icon_256x256@2x.png"],
    ["512x512", "1x", 512, "icon_512x512.png"],
    ["512x512", "2x", 1024, "icon_512x512@2x.png"],
  ];
  for (const [, , pixelSize, filename] of macIconFiles) {
    const filePath = path.join(appIconSetDir, filename);
    writeFileSync(filePath, pngBySize.get(pixelSize));
    console.log("Wrote", filePath);
  }
  writeFileSync(
    path.join(appIconSetDir, "Contents.json"),
    JSON.stringify(
      {
        images: macIconFiles.map(([size, scale, , filename]) => ({
          idiom: "mac",
          scale,
          size,
          filename,
        })),
        info: { author: "xcode", version: 1 },
      },
      null,
      2,
    ),
  );

  const largeIconFiles = [
    ["1x", 128, "large-icon.png"],
    ["2x", 256, "large-icon@2x.png"],
    ["3x", 384, "large-icon@3x.png"],
  ];
  for (const [, pixelSize, filename] of largeIconFiles) {
    const filePath = path.join(largeIconSetDir, filename);
    writeFileSync(filePath, pngBySize.get(pixelSize));
    console.log("Wrote", filePath);
  }
  writeFileSync(
    path.join(largeIconSetDir, "Contents.json"),
    JSON.stringify(
      {
        images: largeIconFiles.map(([scale, , filename]) => ({
          idiom: "universal",
          scale,
          filename,
        })),
        info: { author: "xcode", version: 1 },
      },
      null,
      2,
    ),
  );

  console.log("Done.");
}

main();
