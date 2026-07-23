# Changelog

All notable changes to this project are documented in this file. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project intends to follow
[Semantic Versioning](https://semver.org/) once a first tagged release ships.

## [Unreleased]

### Added

- Core engine (`packages/core`): OKLCH-native perceptual recoloring, a WCAG 2.1 contrast
  solver, brightness/contrast/sepia/grayscale adjustments, non-destructive CSS Cascade
  Layers injection with a CSSOM-direct-rewrite fallback, inline-`style` attribute support,
  cross-origin stylesheet resolution via a background-fetch bridge, and an image/media
  classifier (color-diversity + edge-density signals) that never alters photos or video.
- Chrome MV3 extension (`packages/ext-chrome`): background service worker, content script,
  popup, and options page (background/text lightness, contrast target, brightness/contrast/
  sepia/grayscale, conservative-image-mode).
- Safari Web Extension (`packages/ext-safari`): a real, buildable macOS Xcode project.
- End-to-end verification (`tests/e2e/verify-extension.mjs`) driving the real built
  extension in a real Chromium instance via Playwright.
- `PLAN-darkframe.md`: the project's architecture RFC and running design/bug log.
- `scripts/install-local.mjs` (`pnpm install:local`): builds Darkframe from source and sets
  it up in a real Chrome and/or Safari on this machine, ahead of either store listing going
  live — structurally validates the build output, detects and opens an installed
  Chromium-family browser straight to `chrome://extensions` with the unpacked-extension path
  copied to the clipboard, and on macOS builds the Safari Xcode project and launches the
  resulting app.

### Changed

- Renamed the project from "Umbra" to "Darkframe" (npm scope, extension name, internal
  message/storage-key prefixes, injected CSS layer name, Safari Xcode project) after
  discovering an existing, active, same-category Chrome extension called "Umbra Dark Mode"
  during shipping-readiness review. See PLAN-darkframe.md's Appendix C.
- Chrome: dropped the `tabs` permission — `host_permissions` (`http://*/*`, `https://*/*`)
  already grants `chrome.tabs.query()` access to `tab.url`/`title`/`favIconUrl`, so the
  separate permission was pure surface area with no functional benefit. Verified via
  `tests/e2e/verify-extension.mjs` that popup tab-origin resolution and background-to-tab
  messaging are unaffected.
- Chrome content script: merged the two sequential `chrome.storage.local.get` calls on
  initial page load (enabled-state check, then theme settings) into one, halving the
  storage round-trip latency before first themed paint.

### Fixed

- CSS injection via unescaped control characters in a generated image-selector attribute
  value (High severity — see PLAN-darkframe.md's Security Hardening section).
- Unrestricted background fetch for cross-origin CSS, reachable by any visited page to probe
  internal/loopback/private-network addresses (Medium severity — see PLAN-darkframe.md).
- Image classifier re-decoding every image on every mutation-triggered re-render with no
  cache (real, unbounded performance cost on image-heavy pages).
- A disconnected `MutationObserver` not cancelling an already-scheduled callback, which could
  let a just-disposed theme instance's stale render fire once after a newer instance started.
- The engine rediscovering and recursively recoloring its own previously-injected stylesheet.
- Non-hermetic unit tests silently making real DNS/network calls via happy-dom's default
  external-stylesheet loading.
- CSS custom property (`var(--token)`) references in a `color`/`background-color`/border/
  outline declaration were never resolved, so any element themed via a design token (as
  `leafygreen-ui`, Tailwind, Material, Bootstrap 5, and most modern component libraries do)
  was left untouched — reported live on MongoDB Atlas's Clusters page, where cluster cards
  stayed solid white; root-caused to `.css-1y5u6ib { background-color: var(--mdb-white); }`,
  an Emotion-injected rule. Now resolved via the referenced custom property's own computed
  value (not the target property's, which would have fed the engine's own prior output back
  into itself as a "recolor this again" input — see PLAN-darkframe.md for the feedback-loop
  bug this distinction avoids).
- CSS-in-JS libraries' production "speedy" rule insertion (`CSSStyleSheet.insertRule`/
  `deleteRule`, used by Emotion and styled-components) was invisible to the engine's
  `MutationObserver`-based change detection, so a class defined this way after a page's
  initial load — common on long-lived SPA sessions — was never themed. Now also observed via
  `dom/stylesheet-mutation-watch.ts`.

### Known gaps (tracked, not silently dropped)

- No FOUC (flash of unstyled content) mitigation yet on first paint (the initial
  `chrome.storage.local` round-trip was halved — see Changed — but the flash itself isn't
  eliminated). Designed but deliberately not implemented in this pass: a synchronous
  "optimistic curtain" using the page's own `localStorage` (readable synchronously by an
  isolated-world content script at `document_start`, unlike `chrome.storage`) as a
  same-origin cache of "this origin was dark last visit," painting an unlayered
  `!important` `html,body{background;color}` rule immediately, which is automatically
  superseded once the real `@layer darkframe {...} !important` theme applies (per the CSS
  Cascading spec, layered-important beats unlayered-important). Scoped out of this pass
  because it (a) writes a small marker key into the *page's* own `localStorage`, a real
  though minor expansion of the footprint PRIVACY.md currently describes, which would need
  a docs update to stay accurate, and (b) its actual paint-timing benefit needs verification
  against real browser paint events, not just post-load DOM assertions — the existing E2E
  harness doesn't cover that. Follow-up work, not abandoned.
- No 20-site regression corpus yet (`tests/corpus/`) — real-browser E2E coverage exists but
  is narrower in breadth than the full corpus PLAN-darkframe.md calls for.
- Background-image CSS (`background-image: url(...)`) is not recolored — only `<img>`
  elements are, since a `filter` on an element with a background-image would also incorrectly
  recolor its rendered children/text.
- Chrome Web Store listing and a decided Safari distribution path (signed/notarized vs.
  build-from-source-only) are not yet in place.
