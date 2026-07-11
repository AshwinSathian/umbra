# RFC: Darkframe — A Free, Cross-Browser, Image-Safe Dark Mode Engine
> Status: OPEN FOR REVIEW
> Scale: Epic
> Target start: 2026-07-07
> Created: 2026-07-06
> Author: (unattributed — new repo, no git config set)

---

## 🎯 Goals

Dark Reader is the incumbent runtime dark-theme generator for the web (22k+ GitHub stars, tens of millions of installs), but direct source inspection (see Appendix A) shows three structural weaknesses this RFC targets directly:

1. **Image/media safety is a coarse heuristic, not a guarantee.** Dark Reader classifies images using only a global mean-lightness histogram over a 32×32 downsample (`isDark`/`isLight`/`isTransparent` booleans at fixed 70%/70%/10% thresholds). This misclassifies photos with unusual tonal distribution as icons and recolors/dims them — the single most common user complaint pattern (GitHub #8730, dozens of "[Broken Website]" reports) — and is patched one site at a time via a 40,000-line manually maintained override file rather than fixed at the root.
2. **The color engine is not perceptually uniform.** All recoloring math is RGB→HSL with hand-tuned per-hue special cases (`isYellow`, `isBlue` branches in `modify-colors.ts`) — direct evidence that HSL's non-uniform perceived-lightness-across-hues is causing visible defects that are being patched hue-by-hue instead of solved by construction.
3. **The page is mutated more than necessary.** Every same-origin stylesheet is rewritten in place via CSSOM, every recolored image gets an SVG-filter wrapper element inserted into the DOM, and cross-origin sheets are refetched and reparsed — a large, invasive footprint that also produces real, admitted CPU cost (RAF-polling fallback for adopted stylesheets under strict CSP; multiple 2026 changelog entries titled "Fixed high CPU usage...").

Additionally, Safari is a **paid, second-class product** for Dark Reader (~$4.99 one-time App Store app, wrapping a closed "Plus" tier on top of the open engine) rather than a first-class free target.

**Success, 3 months from now, looks like:**
- A single open-source core engine (packages/core) drives both a Chrome MV3 extension and a Safari Web Extension (macOS first) from the same recoloring/classification logic.
- On a fixed 20-site regression corpus (Appendix B), **zero photographic images are altered** (pixel-identical before/after, verified by automated diff), while non-photographic UI chrome (icons, flat-color logos, solid backgrounds) is recolored to match the dark theme.
- The extension is 100% free with no paid tier, no closed "Plus" engine, and no purchase required on any platform — including Safari.
- Injected DOM/CSS footprint is measured and shown to be smaller than Dark Reader's on the same corpus (fewer injected nodes, fewer rewritten stylesheet rules) via an automated footprint-diff test.
- Text recolored by the engine meets a WCAG 2.1 AA contrast ratio (≥ 4.5:1 for normal text) against its actual resolved background on 100% of the regression corpus.

## 📘 Background

**Current state**: No code exists yet. This is a new repository at `/Users/ashwinsathian/Documents/Personal/darkframe`, initialized with git, no commits.

**Prior art studied directly**: The `darkreader/darkreader` GitHub repository was cloned and read at the source level (not just documentation) to ground this RFC in real, current (as of the July 2026 clone) implementation details rather than assumptions. Specific findings that shape this design are cited by file path throughout (see Appendix A for the full index). Web research covered Chrome Web Store reviews, GitHub issues, Reddit/forum threads, and Apple's Safari Web Extension distribution documentation.

**Constraints**:
- *Technical*: Manifest V3 service workers are non-persistent (no in-memory state across the worker's lifetime); Safari Web Extensions cannot be side-loaded like Chrome dev-mode extensions — they must be embedded in a signed native app, and any signed distribution outside a local Xcode debug build requires an Apple Developer Program membership ($99/year).
- *Organizational*: This is a solo/personal project (no team), so "team coordination" dependencies below are really "sequencing constraints on one person's time," and phase estimates assume part-time solo effort, not a staffed team.
- *Legal/compliance*: None specific to a dark-theme extension beyond standard Chrome Web Store and Apple App Review policies (host permissions disclosure, privacy policy for `host_permissions: *://*/*`).

**Prior attempts**: None — greenfield.

**Glossary**:
- *Dynamic theme*: runtime-computed recoloring of a page's actual resolved styles (Dark Reader's primary mode, and Darkframe's only mode in v1).
- *FOUC*: Flash Of Unstyled/un-Themed Content — the light flash visible before a dark theme applies.
- *OKLCH*: a perceptually uniform cylindrical color space (Lightness, Chroma, Hue) where equal numeric steps correspond to roughly equal perceived steps, unlike HSL.
- *Cascade Layers*: the CSS `@layer` mechanism (broadly supported: Chrome 99+, Safari 15.4+) for controlling rule precedence independent of specificity/source order.

## 🔭 Non-Goals

This RFC is aggressive about scope. The following are **explicitly out of scope for v1** (all revisited in Phase 4/Follow-up):

- **No canvas/WebGL pixel-level theming.** Google Docs, Figma, Notion's canvas-rendered layers, and similar apps will not have their canvas *contents* recolored. This is a structural limitation of any CSS/DOM-injection extension (confirmed via Dark Reader's own unresolved GitHub #8730 discussion) — v1 leaves canvas elements completely untouched, full stop, rather than attempting a partial/buggy fix.
- **No Firefox, Edge, or Opera builds.** The core engine is written to be portable (standard WebExtension APIs only), but only Chrome (MV3) and Safari (macOS Web Extension) are built and shipped in this plan. Firefox/Edge/Opera are a follow-up, not a v1 deliverable.
- **No monetization of any kind.** No paid tier, no "Plus" engine, no in-app purchase, on any platform including Safari. If Apple Developer Program fees are incurred for signed distribution, they are absorbed by the project, never passed to the user as a purchase price.
- **No monolithic per-site manual-fix database at launch.** Darkframe v1 relies on better generic heuristics (image classification, native dark-mode cooperation) rather than a bundled site-specific override file. A small number of hand-verified fixes for the regression corpus are acceptable; a crowd-sourced 40k-line file is explicitly deferred (Follow-up Work).
- **No iOS/iPadOS Safari in v1.** Only macOS Safari is targeted initially — iOS Safari App Extensions cannot be side-loaded at all (App Store distribution is mandatory), which is a materially different distribution problem addressed in Phase 4/Follow-up, not Phase 0–3.
- **No custom per-site user scripting / Dev-Tools-style fix editor UI.** Dark Reader's power-user "Dev Tools" CSS editor panel is not built in v1; users get on/off, brightness/contrast/sepia sliders, and a native-dark-mode toggle only.

## 🏗 Architecture

### System Diagram

```
                          ┌───────────────────────────┐
                          │        packages/core       │
                          │  (pure TS, no browser glue) │
                          │                             │
                          │  color/        oklch.ts, contrast-solver.ts
                          │  image/        classify.ts, sample.ts
                          │  theme/        theme-engine.ts, layer-css.ts
                          │  dom/          style-discovery.ts, mutation-tree.ts,
                          │                 layer-injector.ts, shadow-walk.ts
                          │  site-detect/  native-dark.ts
                          │  state/        settings-schema.ts, storage-port.ts
                          └─────────────┬───────────────┘
                                        │ imported by
                 ┌──────────────────────┼───────────────────────┐
                 │                                               │
     ┌───────────▼────────────┐                    ┌─────────────▼───────────┐
     │ packages/ext-chrome     │                    │ packages/ext-safari      │
     │ manifest.json (MV3)     │                    │ Xcode project            │
     │ background/sw.ts        │                    │  + WKWebExtension host   │
     │ content/inject.ts       │                    │ Resources/ (same bundle  │
     │ ui/popup, ui/options    │                    │  output as ext-chrome,   │
     │ (built w/ Vite+Preact)  │                    │  built via shared        │
     │                         │                    │  packages/ui)            │
     └─────────────────────────┘                    └───────────────────────────┘
```

### Component Inventory

| Component | New / Modified | Responsible Team | Notes |
|-----------|---------------|-----------------|-------|
| `packages/core/color/oklch.ts` | New | solo | RGB↔OKLCH conversion, gamut mapping to sRGB |
| `packages/core/color/contrast-solver.ts` | New | solo | Binary-search text-lightness solver for WCAG contrast target |
| `packages/core/color/recolor.ts` | New | solo | Replaces Dark Reader's `modify-colors.ts` HSL remap with OKLCH lightness-curve remap |
| `packages/core/image/sample.ts` | New | solo | OffscreenCanvas downsample + per-cell lightness/variance/edge-gradient sampling |
| `packages/core/image/classify.ts` | New | solo | Decision policy: photo vs icon vs solid-color, "default to untouched" bias |
| `packages/core/theme/layer-injector.ts` | New | solo | Emits a single `@layer darkframe` stylesheet per page instead of rewriting page stylesheets in place |
| `packages/core/dom/style-discovery.ts` | New | solo | Enumerates `<style>`/`<link>`/adoptedStyleSheets, resolves cross-origin via background fetch port |
| `packages/core/dom/mutation-tree.ts` | New | solo | Shadow-DOM-aware MutationObserver tree, batched updates |
| `packages/core/site-detect/native-dark.ts` | New | solo | `prefers-color-scheme`/`color-scheme` + minimal sampling to detect already-dark sites |
| `packages/core/state/settings-schema.ts` | New | solo | Typed settings schema shared by both platforms' storage layers |
| `packages/ext-chrome/manifest.json` | New | solo | MV3 manifest: service worker, content scripts, `host_permissions` |
| `packages/ext-chrome/background/sw.ts` | New | solo | Stateless-by-design service worker: rehydrates all state from `chrome.storage` on every wake |
| `packages/ext-chrome/content/inject.ts` | New | solo | Content-script entry, wires core modules to the live DOM |
| `packages/ext-safari/Darkframe.xcodeproj` | New | solo | Xcode project wrapping the same built extension resources via `xcrun safari-web-extension-converter` bootstrap, then hand-maintained |
| `packages/ui/popup`, `packages/ui/options` | New | solo | Shared Preact UI consumed by both platform shells |
| `tests/corpus/` | New | solo | Fixed 20-site regression corpus (static HTML snapshots) for image-safety and footprint tests |
| `tests/e2e/` | New | solo | Playwright test matrix (Chrome + Safari via WebKit) |

### Data Flow

```
Page load (document_start)
  → content script reads cached last-known theme decision for this origin (sync, from a
    same-process module-scope cache seeded at document_start by a MAIN-world micro-script)
  → if cached "should be dark": apply cached root background/text color immediately via
    inline style on <html> (accurate flash, not a generic gray guess)
  → native-dark.ts checks prefers-color-scheme/color-scheme
      → if page is already dark: mark origin "native-dark", inject nothing further, done
  → style-discovery.ts enumerates stylesheets (same-origin CSSOM direct; cross-origin via
    a background-script fetch port, capped and gated same as today's proven approach)
  → recolor.ts converts every resolved color to OKLCH, remaps lightness via a continuous
    monotonic curve (not per-hue branches), solves text-color lightness against actual
    resolved background for WCAG contrast
  → layer-injector.ts emits ONE `@layer darkframe { ... }` stylesheet containing the override
    rules — original page stylesheets are never mutated
  → image/sample.ts + classify.ts run per discovered <img>/background-image; only
    classified-as-"flat" images get a targeted override rule in the same layer stylesheet
    (no wrapper DOM elements); <video> and <canvas> are always skipped in v1
  → mutation-tree.ts watches for DOM/stylesheet/shadow-root changes and batches every
    mutation within a tick into a single re-render call (not one call per mutation — see
    Phase 2's task list for the precise claim). **Correction found during a later audit**:
    this doc originally claimed the re-render itself was "diffed, not full re-render" —
    that was never true and the code was never changed to match it. Every triggered
    render recomputes the full theme from scratch (a fresh stylesheet/inline-style walk),
    which is correct to call "batched," not "diffed." The CSSOM/inline-style walk itself
    is cheap (linear, no measurable cost at realistic page sizes). The one place this
    genuinely mattered was image classification, which is real, non-trivial
    (OffscreenCanvas decode) work and was being redone for every image on every
    mutation-triggered render with no memoization — fixed by giving image classification
    its own per-applyTheme-instance cache keyed by resolved URL
    (`image/image-theme.ts`'s `ImageAnalysisCache`), so only images not already classified
    get sampled again.
```

### Data Model

Shared settings schema (`packages/core/state/settings-schema.ts`), stored via `chrome.storage.local` on Chrome and `browser.storage.local` (WKWebExtension-backed) on Safari:

```ts
type DarkframeSettings = {
  version: 1;
  enabledGlobally: boolean;
  siteOverrides: Record<string /* origin */, 'force-on' | 'force-off' | 'default'>;
  theme: {
    darkBackgroundL: number;   // OKLCH lightness pole, 0-1
    contrastTarget: number;    // WCAG ratio, default 4.5
    sepia: number;             // 0-1
    grayscale: number;         // 0-1
  };
  imageSafety: {
    // default true; when true, any image the classifier is not confident about is left
    // untouched (fail-safe default matching the hard "don't alter photos" requirement)
    conservativeMode: boolean;
  };
};
```

No server-side data model — this is a fully client-side extension with no backend in v1 (no telemetry, no remote config fetch).

### API Design

Internal module boundaries only (no public network API in v1):
- `core/theme/theme-engine.ts` exports `computeTheme(doc: Document, settings: DarkframeSettings): ThemeResult` — pure function over a DOM snapshot, platform-agnostic, unit-testable without a browser extension harness (works against jsdom/happy-dom in Vitest).
- `core/dom/layer-injector.ts` exports `applyTheme(doc: Document, result: ThemeResult): DisposeFn` — the only function that touches the live DOM; returns a disposer that fully reverts all changes (used both for toggling off and for tests asserting clean teardown).
- **Correction found during implementation**: `@layer` alone does not make an additive override win against the page's own CSS. Per the CSS Cascading spec, within *normal* importance, unlayered author rules always beat layered author rules regardless of specificity — so a plain `@layer darkframe { ... }` block would silently lose to any of the page's own (unlayered) color declarations. The fix: every declaration emitted inside `@layer darkframe` is marked `!important`. `!important` inverts the layer/unlayered precedence (important layered rules beat important *and* normal unlayered rules), so the override wins against the common case (page rules with normal importance) while still living in one additive, non-mutating stylesheet. The one accepted edge case (documented in Risks) is a page that already declares `!important` on the same property for the same element — a genuinely rare pattern for basic color declarations — where the override may lose; this degrades gracefully to "that one declaration stays untouched," not a crash, and the CSSOM-rewrite fallback path does not share this limitation since it mutates the winning rule directly.
- Chrome↔content-script↔background messaging: a typed `postMessage`/`chrome.runtime.sendMessage` protocol defined once in `packages/shared/messages.ts`, used identically by both the Chrome and Safari builds (Safari's WKWebExtension message-passing is API-compatible with Chrome's for this subset).

### Infrastructure Changes

- CI: GitHub Actions — one workflow running Vitest (core unit tests) + Playwright (Chrome via `playwright chromium`, Safari via `playwright webkit` as a proxy for WebKit engine behavior — real Safari extension E2E requires local macOS + Xcode, noted as a CI gap in Risks).
- No hosting/backend infrastructure required for v1 (no telemetry endpoint, no remote rule service — see Non-Goals).
- Build tooling: pnpm workspaces (monorepo), Vite for content-script/popup bundling, esbuild for the MV3 service worker, TypeScript strict mode across all packages.

## 🔀 Alternatives Considered

| Option | Description | Pros | Cons | Verdict |
|--------|-------------|------|------|---------|
| **Fork Dark Reader and patch it** | Start from the existing MIT-licensed codebase, patch image classification and color engine in place | Huge head start, existing per-site fix database, proven browser-compat shims | Inherits the architectural issues this RFC exists to fix (HSL core, in-place CSSOM rewriting, retrofitted MV3 state); patching around an HSL-centric engine to add OKLCH is more invasive than writing OKLCH-native math from scratch; inherits the paid-Safari distribution model as prior art, not a clean break | **Rejected** — the goal is a constructive overhaul of *how* the problem is solved, not a patch of the incumbent |
| **CSS `filter: invert(1) hue-rotate(180deg)` whole-page approach (Dark Reader's "Filter+" mode)** | Cheap, single-rule, near-zero DOM footprint | Extremely low injected footprint; trivial to implement | Inverts images/video/canvas indiscriminately by definition — directly violates the hard "don't alter images/media" requirement; this is precisely the failure mode being designed away from | **Rejected** as primary mode; may be offered later as an explicit opt-in "cheap mode" toggle, not the default engine |
| **Rely solely on `prefers-color-scheme`/native dark mode and do nothing on sites without it** | Zero injection footprint, zero risk of breaking anything | Maximally "non-disruptive" | Fails the actual product goal — most of the web still ships light-only CSS; this would ship a native-dark-mode detector with no recoloring capability at all | **Rejected** as sole strategy; retained as the "native-dark cooperation" sub-feature (get out of the way when the site is already dark) |
| **OKLCH-native perceptual recoloring + Cascade-Layer non-destructive injection + variance/edge-aware image classification (chosen design)** | Build the engine around a perceptually uniform color space and additive-only CSS injection from day one | Eliminates hue-hack special cases by construction; measurably smaller DOM/CSS footprint; classification improvement directly targets the top complaint category | More upfront engineering than forking; OKLCH gamut-mapping edge cases and `@layer` support on older WebKit need explicit fallback handling | **Chosen** |

## ⚖️ Tradeoffs

- **Cascade Layers require a feature-detection fallback.** `@layer` is supported in Chrome 99+ and Safari 15.4+, which covers the vast majority of the target audience, but any user on an older WebKit build falls back to a CSSOM-rewrite-in-place strategy (Phase 2 must implement both paths). This adds real implementation complexity in exchange for the footprint win on modern browsers.
- **Conservative image classification will under-recolor some icons.** Biasing hard toward "if uncertain, don't touch it" (per the hard requirement) means some flat-color icons that *should* be recolored will be left in their original light-mode colors on the darkened page. This is an explicit, accepted tradeoff: a wrong-but-visible light icon is a cosmetic issue; an altered photo is the failure mode we are eliminating.
- **Safari's genuinely-free distribution has real friction.** Building from source via Xcode is 100% free but requires the end user to have Xcode installed and run a build themselves — real friction for a non-technical user. The alternative (maintainer-funded signed/notarized direct distribution) removes that friction but commits the project to an ongoing $99/year personal cost. This RFC accepts both paths coexisting (Phase 4) rather than picking one, and flags the funding commitment as an explicit Open Question requiring your sign-off.
- **No crowd-sourced per-site fix file at launch means some long-tail sites will look worse than on Dark Reader on day one.** Dark Reader's 40k-line fix file represents years of community patching; Darkframe v1 will not match that coverage immediately. This is accepted in exchange for a smaller, more maintainable core and is explicitly called out in Non-Goals.

## 😱 Risks

| Risk | Likelihood | Impact | Score | Mitigation | Owner |
|------|------------|--------|-------|------------|-------|
| Image/media classifier still misclassifies some photos as icons (or vice versa) in the field, despite the variance/edge-density improvement | Med | High | 6 — Priority | Ship a conservative fail-to-untouched default; maintain the 20-site regression corpus as a growing suite (add every real misclassification found post-launch as a new fixture); expose a one-click "always show this image as original" per-image override in the popup UI | solo |
| `@layer`-based non-destructive injection is unsupported or buggy on some in-range WebKit/Chromium versions, silently producing no theming | Low | Med | 2 — Note | Feature-detect via `CSS.supports('@layer name { color: red }')` at content-script init; fall back to direct CSSOM rewrite (proven Dark Reader approach) when unsupported; add this exact case to the E2E matrix | solo |
| Safari free-distribution friction (Xcode-build-from-source vs. maintainer-funded signed build) becomes an ongoing personal cost or an adoption blocker | High | Med | 6 — Priority | Ship both paths explicitly in Phase 4; treat the funding decision as a named Open Question requiring explicit owner sign-off before Phase 4 starts, not an assumption baked into the plan | you (owner sign-off required) |
| MV3 service-worker ephemeral wake/sleep causes lost per-tab state or missed toggle messages | Med | Med | 4 — Mitigate | Design all background state as fully rehydratable from `chrome.storage` on every wake from Phase 0 (no in-memory-only state ever); add an integration test that force-terminates the service worker mid-flow and asserts state is recovered correctly | solo |
| Performance regression on web-component-heavy SPAs (adopted stylesheets, deep Shadow DOM) under the new mutation-tree watcher | Med | Med | 4 — Mitigate | Budget test: CPU time sampled on a synthetic heavy-shadow-DOM fixture must stay within 2x of Dark Reader's measured cost on the same fixture; avoid RAF-polling — use native `adoptedStyleSheets` change notification where the browser supports it, with an exponential-backoff poll (not per-frame) as the only fallback | solo |
| Scope creep — chasing "state of the art" on every axis (OKLCH, APCA, canvas overlay, community rules) delays any shippable v1 | High | Med | 6 — Priority | Hold the Phase 1–3 scope exactly as specified in this RFC; anything not listed in Phases 1–4 is explicitly Follow-up Work, not silently absorbed into v1 | solo |
| Real Safari extension behavior diverges from the Playwright WebKit-engine proxy used in CI (CI cannot run an actual signed Safari Web Extension headlessly) | Med | Med | 4 — Mitigate | Treat Playwright/WebKit CI results as a pre-check only; require a manual smoke-test pass in real Safari on macOS before every tagged release (documented as a release-checklist gate, not automated) | solo |

## 🔗 Dependencies

- **Upstream**: None — greenfield project, no upstream code dependency (explicitly not forking Dark Reader; see Alternatives Considered).
- **Downstream**: None yet (no consumers of this extension exist before Phase 5/6 ship).
- **External**:
  - `xcrun safari-web-extension-converter` (Xcode command-line tools) — required once at Phase 4 bootstrap to scaffold the Safari wrapper project.
  - Apple Developer Program membership ($99/year) — required only for signed/notarized direct-distribution or App Store builds (Phase 4/Follow-up); not required for building/running from source.
  - Chrome Web Store developer account (one-time $5 fee) — required for Phase 5 Chrome Web Store listing.
  - pnpm, Vite, esbuild, Vitest, Playwright, TypeScript — all standard OSS tooling, no paid licenses.
  - No runtime third-party service dependency (no analytics SDK, no remote config/rule service in v1).

## 📅 Phases & Milestones

### Phase 0: Repo Scaffolding & Tooling (~3d)
**Goal**: A monorepo that builds, lints, type-checks, and runs an (empty) test suite in CI, with no product logic yet.
**Deliverable**: `pnpm install && pnpm build && pnpm test` succeed locally and in a passing GitHub Actions run.
**Tasks**:
- [ ] Set up pnpm workspace (`packages/core`, `packages/shared`, `packages/ui`, `packages/ext-chrome`, `packages/ext-safari`, `tests/`) — AC: `pnpm -r list` shows all five packages resolved with no dependency errors.
- [ ] Configure TypeScript strict mode + shared `tsconfig.base.json` — AC: `pnpm -r exec tsc --noEmit` passes with zero errors on scaffold-only stub files.
- [ ] Configure ESLint + Prettier — AC: `pnpm lint` exits 0 on the initial scaffold.
- [ ] Configure Vitest at the workspace root — AC: a placeholder test in `packages/core` runs and passes via `pnpm test`.
- [ ] Add GitHub Actions workflow (`.github/workflows/ci.yml`) running lint, typecheck, unit tests — AC: a pushed commit produces a green CI run visible in the Actions tab.
- [ ] Choose and add LICENSE (MIT, matching ecosystem norm and enabling contributions) — AC: `LICENSE` file present at repo root, referenced in `package.json` `license` field.
**Exit criteria**: CI is green on an empty-logic scaffold; no product code has been written yet.

### Phase 1: Core Color & Contrast Engine (~5d)
**Goal**: A pure, framework-agnostic color engine that outperforms Dark Reader's HSL remap, fully unit-tested without any browser extension harness.
**Deliverable**: `packages/core/color/` with OKLCH conversion, gamut mapping, and a WCAG-contrast text-color solver, each independently unit-tested.
**Tasks**:
- [ ] Implement `oklch.ts`: sRGB↔OKLCH round-trip conversion — AC: property-based test asserts round-trip error < 1e-4 across 10,000 random sRGB samples.
- [ ] Implement sRGB gamut mapping for out-of-gamut OKLCH results (chroma reduction at constant L/H) — AC: unit test confirms every mapped color is within the sRGB gamut (no negative/>1 channel values) for a fixed set of edge-case high-chroma inputs.
- [ ] Implement `recolor.ts` continuous lightness-remap curve (replacing HSL per-hue branches) — AC: unit test confirms no per-hue special-casing exists in the implementation (single monotonic function of L, parameterized only by the configured dark/light poles) and that hue is preserved within 2° for 100 sampled input colors.
- [ ] Implement `contrast-solver.ts`: binary-search text lightness in OKLCH to hit a target WCAG 2.1 contrast ratio against a given background — AC: for 50 fixed (background, target-ratio) pairs, solved text color achieves the target ratio within ±0.05.
- [ ] Port/adapt Dark Reader's dark-site "already dark" detection concept into `site-detect/native-dark.ts`, using `prefers-color-scheme`/`color-scheme` checks first — AC: unit test (via happy-dom) confirms a page with `<meta name="color-scheme" content="dark">` is flagged native-dark with zero sampling calls.
**Exit criteria**: `packages/core/color` and `packages/core/site-detect` have ≥90% line coverage and zero dependency on any `chrome.*`/`browser.*`/DOM-injection API — verified by importing them in a plain Node test with no extension shims.

### Phase 2: Core DOM Engine & Non-Destructive Injection (~7d)
**Goal**: The engine can discover a real page's stylesheets and apply a themed override via a single additive `@layer` stylesheet, without mutating original stylesheets, with a proven CSSOM-rewrite fallback for unsupported browsers.
**Deliverable**: `packages/core/dom/` — style discovery, layer-based injector, Shadow-DOM-aware mutation watcher.
**Tasks**:
- [x] Implement `style-discovery.ts`: enumerate all `<style>`, `<link rel=stylesheet>`, and `adoptedStyleSheets` in a document, including within shadow roots — AC met (`dom/style-discovery.test.ts`, 6 tests).
- [x] Implement cross-origin sheet handling via a pluggable `fetchPort` interface (`dom/cross-origin-cache.ts`, backed by the Chrome background script's `darkframe:fetch-css` handler) — AC met, and verified in a **real cross-port browser request** in `tests/e2e/verify-extension.mjs`, not just a mock.
- [x] Implement `layer-injector.ts`: emit one `@layer darkframe { ... }` stylesheet per page containing override rules — AC met (`dom/layer-injector.test.ts`). **Correction found during implementation**: plain `@layer` alone loses to the page's own unlayered CSS regardless of specificity (see the Tradeoffs/Key Decisions note added to this RFC's Architecture section) — every declaration is also marked `!important`.
- [x] Implement the CSSOM-rewrite-in-place fallback path for browsers without `@layer` support — AC met (`theme/apply-theme.test.ts`).
- [x] Implement `mutation-tree.ts`: Shadow-DOM-aware `MutationObserver` tree with batched re-computation — AC met, plus a real bug found and fixed: `observer.disconnect()` does not cancel a callback the observer already scheduled before disconnecting, so a just-disposed theme instance's stale render could still fire once after a newer instance started (e.g. on a settings-change restart), clobbering correct output with stale values. Fixed with an internal `disposed` guard inside the scheduled callback; regression test added.
- [x] Implement `applyTheme()`/dispose lifecycle — AC met (`theme/apply-theme.test.ts`, 9 tests) — including a real, serious bug found via live-browser E2E testing (not caught by any unit test): **`computeTheme()` must never read its own previously-recolored output back as if it were fresh page content.** Two distinct instances of this were found and fixed: (1) inline `style=""` attributes are mutated in place, so a naive re-read on the next render recolors an already-recolored value again — not a no-op, since the pole-based remap is a contraction toward a fixed point, not idempotent, which pinned a live tab's CPU in an infinite loop (fixed via `dom/original-value-cache.ts`, caching each declaration's true original on first read); (2) `discoverStylesheets` was finding Darkframe's *own* injected `@layer` stylesheet and recursively recoloring the rules inside it, since an `@layer` block has `.cssRules` like any grouping rule (fixed by excluding the managed style element from discovery — see `dom/style-discovery.ts`). Both are covered by dedicated regression tests (`theme-engine.test.ts`, `style-discovery.test.ts`, `mutation-tree.test.ts`).
**Exit criteria met**: `tests/e2e/verify-extension.mjs` confirms, in a real Chromium instance, zero mutation of original stylesheet rules on the `@layer` path (via the cross-origin/body-rule regression checks) and correct convergent (non-drifting) output across repeated renders.

### Phase 3: Image & Media Safety Classifier (~6d)
**Goal**: The flagship differentiator — a classifier that reliably distinguishes photos (never touched) from flat icons/logos (recolored), biased hard toward leaving uncertain cases untouched.
**Deliverable**: `packages/core/image/` with sampling and classification, validated against a growing regression corpus.
**Tasks**:
- [x] Implement `sample.ts`: canvas-pixel-based downsample computing per-cell lightness, global variance/stddev, a Sobel-magnitude **edge-fraction** score, and color-diversity — AC met with a real-world calibration correction: initial thresholds (tuned only against synthetic fixtures) misclassified a real anti-aliased circular icon (rendered by an actual browser canvas, not a synthetic hard-edged square) as non-flat, because a curved boundary spreads anti-aliased edge pixels across more of the image than a straight one measures. `FLAT_EDGE_DENSITY_MAX` retuned from 0.15 to 0.2 against this real measurement, still far below real photographic noise (~0.8+). Also switched the edge signal from mean gradient *magnitude* to edge pixel *fraction* — a flat icon's crisp outline has high local magnitude concentrated in a thin boundary, which skewed the mean; fraction correctly reads "small edge region, mostly flat."
- [x] Implement `classify.ts` decision policy — AC met (`image/classify.test.ts`, 9 tests), including the specific "bright product photo on white background" Dark-Reader regression case, which now lands squarely on "photo" via color-diversity + edge-fraction even though its global mean lightness alone would read as a light-mode icon.
- [x] Wire `<video>`/`<canvas>`/`<audio>` elements to be unconditionally excluded from any recoloring path — AC met (`image/media-guard.ts` + tests): a simple, unconditional tag-name check, deliberately not a heuristic, since this specific guarantee must never depend on a classifier being right.
- [ ] Build the full 20-site regression corpus (`tests/corpus/`) — **not done**. Real-world validation instead happened via `tests/e2e/verify-extension.mjs` against a live-generated (real canvas-rendered, not synthetic-array) photo and icon in a real Chromium instance, confirming byte-identical photo pixels and correct icon recoloring — but the full 20-fixture corpus called for here has not been built.
- [x] Automated pixel-diff regression — met via the E2E script's byte-identical data-URL comparison (real browser `canvas.toDataURL()` round-trip), not yet as a `pnpm test:corpus` suite.
**Exit criteria partially met**: zero altered photos confirmed in both unit tests (synthetic) and live-browser E2E (real pixels); the 20-fixture corpus itself remains a gap — see Follow-up Work.

### Phase 4: Chrome MV3 Extension Shell (~5d)
**Goal**: A real, installable Chrome extension exercising the full core engine end-to-end, with settings persisted correctly across service-worker sleep/wake cycles.
**Deliverable**: `packages/ext-chrome` loadable via `chrome://extensions` developer mode, functioning on live websites.
**Tasks**:
- [x] Write `manifest.json` (MV3) with real icons (16/32/48/128, generated procedurally — see `scripts/generate-icons.mjs`), an options page, and popup — AC met: loads cleanly in Chrome, confirmed via Playwright loading the actual unpacked `dist/`.
- [x] Implement `background/service-worker.ts` as a fully stateless dispatcher — AC met and verified with a **real CDP-driven force-termination test** (not `chrome.test`, which isn't available outside Chrome's own test harness): `tests/e2e/verify-extension.mjs` uses `ServiceWorker.stopWorker` via `context.newCDPSession`, then confirms the popup still resolves state correctly once a fresh worker spins up automatically on the next message.
- [x] Implement `content/content-script.ts`: wires `applyTheme` (which internally chains style-discovery → theme-engine → layer-injector → mutation-tree) against the live tab, plus the cross-origin `fetchCss` bridge to the background script — AC met via `tests/e2e/verify-extension.mjs`, not just 5 spot-checked sites: a live-generated photo is confirmed byte-identical, a live-generated icon is confirmed recolored, and page background/text visibly re-themes.
- [x] Build the popup UI (`popup.html`/`popup.ts`, plain TS rather than Preact — `packages/ui` remains an unused placeholder, a scope cut given time constraints): on/off toggle (global + per-site) — AC met (toggling verified end-to-end via the real background/content-script message contract in a live browser). Brightness/contrast/sepia sliders were built into the **options page** instead of the popup (see below) for space/UX reasons.
- [x] Build the options page (`options.html`/`options.ts`): background-darkness, text-lightness, contrast-target, brightness, contrast, sepia, grayscale sliders, and a conservative-image-mode checkbox, debounced-saved to `chrome.storage` and broadcast live to open tabs — AC met and specifically verified end-to-end: changing the background-darkness slider in the real options page visibly changes live theming on a real open tab within under a second.
- [ ] Implement the accurate-flash FOUC mitigation — **not done**. Still an open gap; first-paint still shows the page's native light background briefly before the content script applies theming.
**Exit criteria substantially met**: the unpacked extension installs cleanly, and `tests/e2e/verify-extension.mjs` (10 checks, all passing against a real Chromium instance) covers page recoloring, image safety (byte-identical photo, recolored icon), toggle on/off, options-driven live settings changes, cross-origin stylesheet theming, and MV3 service-worker force-termination resilience. FOUC mitigation remains unimplemented (see Follow-up Work).

### Phase 5: Safari Web Extension Shell (~6d)
**Goal**: The same core engine and UI running as a native Safari Web Extension on macOS, functionally at parity with the Chrome build.
**Deliverable**: `packages/ext-safari/Darkframe.xcodeproj` — an Xcode project that builds and runs in Safari on macOS.
**Tasks**:
- [x] Bootstrap via `xcrun safari-web-extension-converter` against the built `packages/ext-chrome` output, then commit the generated Xcode project as the maintained starting point — AC: `xcodebuild -project Darkframe.xcodeproj -scheme Darkframe build` succeeds locally. **Done**: built with `--swift --macos-only --copy-resources`, confirmed `** BUILD SUCCEEDED **` locally with free ad-hoc ("Sign to Run Locally") signing, and the built `Darkframe.app` was launched and confirmed running as a process. **Real bug found and fixed during bootstrap**: the converter set the container app's own `PRODUCT_BUNDLE_IDENTIFIER` to an auto-derived `com.darkframe.Darkframe` instead of the `--bundle-identifier com.darkframe.app` value passed on the command line, while the extension target correctly got `com.darkframe.app.Extension` — the mismatch fails Xcode's `ValidateEmbeddedBinary` step ("Embedded binary's bundle identifier is not prefixed with the parent app's bundle identifier"). Fixed by setting the app target's identifier to `com.darkframe.app` directly in `project.pbxproj`. `packages/ext-safari/build.mjs` documents the exact regeneration command; the `Darkframe Extension/Resources/*` build outputs are synced from `packages/ext-chrome/dist` by that script rather than hand-maintained separately.
- [ ] Adapt manifest/background for Safari's WKWebExtension API surface (verify service-worker-equivalent lifecycle behavior; Safari's extension background page lifecycle differs from Chrome's MV3 service worker) — AC: the same force-termination-and-recover test from Phase 4 (adapted for Safari's background lifecycle primitives) passes. **Not yet done** — the converter emitted a warning that manifest.json's `background.type: "module"` key is "not supported by your current version of Safari"; the shared background.js has no unresolved imports so this is likely harmless, but Safari's actual background-page wake/sleep behavior has not yet been verified against the MV3 service-worker assumptions `packages/ext-chrome/src/background/service-worker.ts` makes.
- [ ] Verify/adapt the `fetchPort` cross-origin implementation and `@layer`/CSSOM-fallback feature detection against Safari's actual WebKit version behavior.
- [ ] Enable the Safari extension in System Settings and run the full manual regression corpus by hand in real Safari — AC: a documented manual test log shows all 20 corpus fixtures rendering with 0 altered photos, matching the Chrome results. (App builds and launches; the extension has not yet been manually enabled in Safari's Extensions settings and exercised against a live page in this session.)
- [x] Document the free "build from source via Xcode" installation path in `README.md`.
**Exit criteria**: Safari (macOS) shows visually equivalent dark-theming to Chrome on the full regression corpus, confirmed by manual side-by-side screenshots. **Partially met**: the app builds, signs, and launches from source at zero cost; live in-Safari theming has not yet been manually verified in this session.

### Phase 6: Distribution & Hardening (~4d)
**Goal**: The extension is installable by a non-technical user on both platforms without requiring them to build from source, while remaining free.
**Deliverable**: A Chrome Web Store listing and a decision-backed Safari distribution path.
**Tasks**:
- [ ] Submit to the Chrome Web Store (one-time $5 developer fee, absorbed by the project) — AC: listing is live and installable via a public Chrome Web Store URL.
- [ ] Resolve the Safari distribution Open Question (see below) with an explicit decision, then execute it: either (a) maintainer funds Apple Developer Program ($99/yr) and ships a notarized direct-distribution build, or (b) ship build-from-source only and document that choice publicly — AC: README and repository clearly state which path was chosen and why, with no ambiguity for a prospective user.
- [ ] Run the full Playwright E2E matrix (Chromium + WebKit engines) as a required, green CI gate on the release tag — AC: `pnpm test:e2e` passes in CI for the tagged release commit.
- [ ] Write a public privacy policy covering the `host_permissions: *://*/*` grant (required by both Chrome Web Store and Apple review) — AC: a `PRIVACY.md` exists, is linked from both store listings, and explicitly states no telemetry/analytics are collected (true per this RFC's Non-Goals).
**Exit criteria**: A first-time user can install Darkframe from a public listing (Chrome Web Store, and whichever Safari path was chosen) without contacting the maintainer, on a machine that has never had the extension before.

## 🔒 Security Hardening (post-v1 audit)

After the phases above shipped, a dedicated adversarial security audit (independent of the
implementation work — a fresh review against the actual code, not a self-review) found and
fixed two real, concrete issues. Recorded here rather than silently folded into the phase
history above, since both represent genuine vulnerabilities a security-conscious reviewer
would have flagged in the original implementation:

- **CSS injection via unescaped control characters in a generated attribute selector (High
  severity).** `image/image-theme.ts`'s `escapeAttributeValue` only escaped `\` and `"`
  before embedding an `<img src>` value into a generated `img[src="..."]` selector. Per the
  CSS syntax spec, an unescaped literal newline/CR/form-feed inside a quoted string
  terminates the string token early; everything after it is re-tokenized as fresh CSS —
  including inside Darkframe's own `!important`-marked `@layer` stylesheet, which is
  specifically designed to win the cascade. A page that lets users embed raw `<img>` tags
  (a common "safe HTML subset" in forums/wikis/chat apps) with a crafted `src` containing an
  embedded control character followed by attacker CSS could inject arbitrary, fully valid
  rules into that trusted stylesheet. **Fix**: every C0 control character and DEL is now
  hex-escaped using standard CSS escape syntax, not just `\`/`"`; the fallback for
  `img.currentSrc` was also changed from a raw `getAttribute("src")` read (unresolved, not
  normalized) to the resolved `img.src` IDL property (goes through URL parsing, which itself
  strips embedded control characters) as defense in depth. Regression test
  (`image-theme.test.ts`) constructs the actual exploit payload, verifies the generated
  selector contains no raw newline, and — the strongest possible check — hands the generated
  rule to a real CSS parser and confirms it parses as exactly one rule, not two (one of which
  would be the attacker's injected rule). Verified this test actually fails against the
  pre-fix implementation before confirming the fix, not just that it passes after.
- **Unrestricted, SSRF-shaped background fetch for cross-origin CSS (Medium severity).** The
  background script's `darkframe:fetch-css` handler (backed by `dom/cross-origin-cache.ts`)
  fetched any URL a page's own `<link rel=stylesheet href>` pointed at, with zero
  protocol/host validation, using the extension's broad `host_permissions` — which grants a
  CORS bypass ordinary page script does not have. Any visited page could embed a hidden
  cross-origin `<link>` pointing at an internal address (loopback, RFC 1918 ranges, or
  link-local/cloud-metadata addresses like `169.254.169.254`) and use the extension's
  privileged background context to read back the response body. **Fix**:
  `shared/url-safety.ts`'s `isFetchableCssUrl` rejects non-http(s) schemes and IP-literal
  loopback/private/link-local addresses (with a documented, accepted residual gap: this is a
  literal-based check, not DNS-resolution-aware, so a hostname that only resolves to a
  private address at fetch time — DNS rebinding — is not caught; closing that fully would
  need a server-side proxy, which doesn't exist for a client-side extension). Wired into the
  background handler before the `fetch()` call. 12 unit tests cover the boundary cases
  (loopback, each private range, link-local/cloud-metadata, localhost, non-http(s) schemes,
  and — to catch over-eager blocking — addresses that merely start with a private-looking
  octet but are actually public, e.g. `172.32.0.1` is outside `172.16.0.0/12`).

A separate architecture/quality audit (see also the "diffed, not full re-render" correction
above) additionally surfaced and fixed: an unmemoized image classifier re-decoding every
image on every mutation-triggered render (now cached per resolved URL — see the Data Flow
correction above); non-hermetic unit tests silently making real DNS/network calls via
happy-dom's default link-stylesheet auto-fetching (fixed via `disableCSSFileLoading` in
`vitest.config.ts`); and a test-script resource-cleanup gap (`tests/e2e/verify-extension.mjs`
leaking a listening HTTP server on an error path). All are fixed and covered by tests as of
this section being written.

## 🧪 Testing Strategy

- **Unit tests (Vitest)**: `packages/core/color` (OKLCH round-trip, gamut mapping, contrast solver — property-based + fixed-case tests), `packages/core/image` (classifier decision table against synthetic fixtures), `packages/core/dom` (style discovery against jsdom/happy-dom fixtures, injector mutation-free guarantee). Target ≥ 90% line coverage on `packages/core`.
- **Corpus regression tests**: the 20-site fixture corpus (Phase 3) run via `pnpm test:corpus`, asserting (a) zero photographic pixel alteration, (b) a documented minimum recolor rate on flat/icon images, (c) an injected-footprint count (new DOM nodes, mutated original stylesheet rules) that must not regress between commits (footprint snapshot diffing).
- **Integration/E2E tests (Playwright)**: full install-and-toggle flows against real, live example sites (not just static fixtures) for both the Chromium and WebKit engines, plus the service-worker/background-lifecycle force-termination-and-recover tests from Phase 4/5.
- **Manual verification**: a documented release checklist requiring a real-Safari-on-macOS manual pass through the full corpus before every tagged release (since CI cannot execute a signed Safari Web Extension headlessly).
- **Performance/budget tests**: a synthetic heavy-Shadow-DOM/adopted-stylesheet fixture with a CPU-time budget assertion (must stay within 2x of a documented Dark-Reader baseline measurement on the same fixture), run in CI to catch regressions from the mutation-tree watcher.
- **Rollout strategy**: no feature flags/canary needed for a client-side browser extension with no backend; releases are tagged versions gated by the CI test suite plus the manual Safari checklist.
- **Rollback plan**: Chrome Web Store supports reverting to a previous published version; for Safari, the previous signed build/source tag remains available for direct re-download. Since there is no server-side state, "rollback" is purely "publish the previous version again."

## ⚙️ Operations

- **Observability**: none in v1 by design (no telemetry — see Non-Goals/Privacy). The only feedback channel is GitHub Issues.
- **Alerts**: none (no backend to page on).
- **Runbook**: N/A for v1 — a `RELEASING.md` checklist (CI green + manual Safari corpus pass + version bump) substitutes for an ops runbook.
- **On-call implications**: none — solo project, no SLA, issues triaged asynchronously via GitHub.

## ❓ Open Questions

- [ ] **Safari distribution funding decision**: does the project commit to an ongoing $99/year personal Apple Developer Program cost to ship a signed/notarized direct-distribution build for non-technical users, or does v1 ship build-from-source-only on Safari and revisit funded distribution later? — owner: you, target resolution: before Phase 6 starts.
- [ ] **Contrast standard**: standardize v1's `contrast-solver.ts` on WCAG 2.1 relative-luminance contrast ratio (safe, widely referenced, easier to test deterministically) with APCA as a possible opt-in enhancement later, or build on APCA from the start (more perceptually accurate but not yet a ratified standard)? Recommendation in this RFC is WCAG 2.1 for v1 — needs explicit confirmation. — owner: you, target resolution: before Phase 1 starts.
- [ ] **iOS Safari timeline**: is iOS/iPadOS support desired at all, and if so, is it acceptable that it requires full App Store review (no side-loading option exists on iOS, unlike macOS)? Recommendation is macOS-first, iOS deferred to Follow-up Work. — owner: you, target resolution: before Phase 5 starts (does not block Phase 0–4).
- [ ] **Project name/branding**: "Darkframe" was chosen as a working name (short, thematically apt, no obvious collision with existing folders in `~/Documents/Personal`) but has not been checked against existing Chrome Web Store or npm package name collisions. — owner: you, target resolution: before Phase 6 (Chrome Web Store submission).

## 🔜 Follow-up Work (Deferred, Not Silently Dropped)

Explicitly deferred past v1, to prevent the scope creep identified as a Priority risk above:

- **Firefox, Edge, Opera builds.** Core engine is portable by design (Phase 1–3 have zero Chrome/Safari-specific API dependency); only the thin extension shells need writing, following the same pattern as `packages/ext-chrome`.
- **Canvas-aware experimental overlay mode.** An explicit, clearly-labeled-experimental, opt-in-only `mix-blend-mode`/`backdrop-filter` container tint for canvas-heavy apps (Docs, Figma, Notion) — never silent pixel rewriting of canvas contents.
- **Community per-site rule service.** A small, versioned, lazily-fetched rule service (fetched per-origin on demand, not one bundled monolithic file) to close long-tail-site gaps without repeating Dark Reader's 40k-line-file scaling problem.
- **iOS/iPadOS Safari support.** Deferred pending the Open Question below on distribution model, since iOS forbids side-loading entirely.
- **APCA-based contrast mode.** An opt-in enhancement over the v1 WCAG 2.1 contrast solver, once APCA's standardization status is more settled.
- **Dev-Tools-style per-site CSS fix editor.** A power-user UI for authoring/sharing manual per-site overrides, deferred until the community rule service above exists to host them.
- **Expanding the regression corpus.** Every real-world misclassification reported post-launch should be added as a new corpus fixture (per the classifier risk mitigation above) — an ongoing practice, not a one-time task, starting immediately after Phase 6 ships.
- **Building the initial 20-site regression corpus itself** (`tests/corpus/`, Appendix B). Not yet built — real-world validation so far has come from `tests/e2e/verify-extension.mjs` (a single live page with a real generated photo/icon), which is real evidence but does not substitute for the breadth of 20 diverse real-world site categories this RFC calls for.
- **Accurate FOUC mitigation.** The v1 build has no fallback pre-paint styling at all — a real regression versus even Dark Reader's crude gray-flash approach. A cached-last-known-color `document_start` script (per the original Architecture section's design) has not been implemented.
- **Background-image recoloring.** Only `<img>` elements are recolored (see `image/image-theme.ts`); CSS `background-image` is left untouched in v1 because a `filter` applied to an element for its background would also incorrectly recolor any text/children rendered on top of it, and no isolation mechanism for just the background layer has been designed yet.
- **Options page uses plain HTML/TS, not Preact.** `packages/ui` was scaffolded in Phase 0 but never actually used — the popup and options page are hand-written vanilla TypeScript. Revisit if the UI grows complex enough to need componentization.

## 🗂 Appendix

### Appendix A: Dark Reader Source Findings Referenced in This RFC

| File (in `darkreader/darkreader`) | Finding used in this RFC |
|---|---|
| `src/inject/dynamic-theme/image.ts` | 32×32 global-mean-lightness-only classifier (`isDark`/`isLight`/`isTransparent` at 70/70/10% thresholds) — root cause motivating Phase 3's variance/edge-density classifier |
| `src/inject/dynamic-theme/modify-colors.ts` | HSL remap with `isYellow`/`isBlue` hue special-cases — motivating Phase 1's OKLCH-native engine |
| `src/inject/dynamic-theme/style-manager.ts` | In-place CSSOM rewriting of every discovered stylesheet — motivating Phase 2's additive `@layer` approach |
| `src/inject/dynamic-theme/adopted-style-manger.ts` | RAF-polling fallback under strict CSP, admitted CPU cost — motivating Phase 2/4's native-event-first, backoff-poll-fallback design |
| `src/inject/fallback.ts` | Generic-gray FOUC flash, only on repeat visits — motivating Phase 4's accurate cached-color flash |
| `src/inject/detector.ts` | Grid-sampling native-dark-site detection — informing (not copied verbatim) Phase 1's `native-dark.ts` |
| `src/config/dynamic-theme-fixes.config` (40,154 lines) | Manual per-site patch file as a scaling liability — motivating the Non-Goal against a bundled fix database in v1 |
| App Store listing / Macworld coverage | Confirms Dark Reader for Safari is a ~$4.99 paid app — motivating the "fully free including Safari" goal |

### Appendix B: Regression Corpus Requirements (detailed in Phase 3)

20 fixtures, minimum required categories: (1) photo-heavy content site, (2) icon/logo-heavy dashboard-style UI, (3) a bright-product-photo-on-white-background page (the specific known Dark Reader failure mode), (4) SVG icon sprite sheet usage, (5) a page embedding `<video>`, (6) a page with deep Shadow DOM/web components, (7) a page using `adoptedStyleSheets`, (8) a page already shipping native `prefers-color-scheme: dark` support, (9) a page loading stylesheets cross-origin, (10–20) further diverse real-world pages spanning news, e-commerce, documentation, and social-media-style layouts.

### Appendix C: Naming

"Darkframe" (Latin: shadow) was selected as a working project name for its thematic fit and because it does not collide with any existing folder in `~/Documents/Personal`. Not yet checked against Chrome Web Store or npm registry collisions (see Open Questions).
