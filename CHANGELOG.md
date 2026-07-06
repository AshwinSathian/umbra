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
- `PLAN-umbra.md`: the project's architecture RFC and running design/bug log.

### Fixed

- CSS injection via unescaped control characters in a generated image-selector attribute
  value (High severity — see PLAN-umbra.md's Security Hardening section).
- Unrestricted background fetch for cross-origin CSS, reachable by any visited page to probe
  internal/loopback/private-network addresses (Medium severity — see PLAN-umbra.md).
- Image classifier re-decoding every image on every mutation-triggered re-render with no
  cache (real, unbounded performance cost on image-heavy pages).
- A disconnected `MutationObserver` not cancelling an already-scheduled callback, which could
  let a just-disposed theme instance's stale render fire once after a newer instance started.
- The engine rediscovering and recursively recoloring its own previously-injected stylesheet.
- Non-hermetic unit tests silently making real DNS/network calls via happy-dom's default
  external-stylesheet loading.

### Known gaps (tracked, not silently dropped)

- No FOUC (flash of unstyled content) mitigation yet on first paint.
- No 20-site regression corpus yet (`tests/corpus/`) — real-browser E2E coverage exists but
  is narrower in breadth than the full corpus PLAN-umbra.md calls for.
- Background-image CSS (`background-image: url(...)`) is not recolored — only `<img>`
  elements are, since a `filter` on an element with a background-image would also incorrectly
  recolor its rendered children/text.
- Chrome Web Store listing and a decided Safari distribution path (signed/notarized vs.
  build-from-source-only) are not yet in place.
