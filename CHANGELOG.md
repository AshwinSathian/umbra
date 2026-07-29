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
- Chrome popup redesigned from two bare buttons into a real quick-control panel: an
  aperture-ring primary toggle for the current site, a global-enable switch, a
  conservative-image-mode switch, and inline Brightness/Contrast/Background-darkness
  sliders under a "Tuning" disclosure — all reading and writing the same
  `THEME_SETTINGS_KEY` storage and `darkframe:settings-changed` broadcast as the full
  options page, so either surface stays in sync with the other. The options page got a
  matching visual refresh (`packages/ext-chrome/src/styles/darkframe-ui.css`, a shared
  token/component stylesheet) so navigating from the new popup to "All settings" doesn't
  land somewhere visually unrelated.

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
  initial load — common on long-lived SPA sessions — was never themed. `dom/stylesheet-
  mutation-watch.ts` was added to also observe these calls — **correction, found during a
  later performance investigation**: this only works for calls made from the *same* JS realm,
  and a real installed extension's content script runs in an isolated world that does not
  share `CSSStyleSheet.prototype` with the page's own scripts, so it currently does not
  intercept a real page's own CSS-in-JS `insertRule` calls at all. See "Known gaps" below and
  the doc comment at the top of `dom/stylesheet-mutation-watch.ts`.
- A `var(--token)` reference gated behind `:hover`/`:focus`/`:focus-visible`/`:focus-within`/
  `:active`/`:visited` was never resolved — reported live on npmjs.com's account menu, where
  the hover/focus highlight stayed at its original light color inside an otherwise
  dark-recolored dropdown. `document.querySelector` can only match a selector containing one
  of these while that state is truly, momentarily live (or, for `:visited`, never at all —
  browsers deliberately hide it from scripts as a history-sniffing defense), which
  essentially never coincides with a render pass. The resolver now also tries the same
  selector with these pseudo-classes stripped out, since a custom property's value doesn't
  differ based on whether *this* rule's own interaction state happens to be active.
- A `var(--token)` reference declared through a shorthand whose entire value is that one
  reference (`background: var(--surface)`, `outline: var(--x)`) was also never resolved,
  independently of the fix above: a shorthand containing an unresolved `var()` anywhere in it
  becomes a "pending-substitution value" per the CSS spec, so its longhand sub-properties
  (`background-color`, `outline-color`) read back as genuinely empty via CSSOM — not just
  falling through the var() check, invisible before reaching it at all. Only resolved when
  the shorthand's entire value is the one reference (unambiguous); a shorthand with other
  content alongside it (`border: 1px solid var(--x)`) is deliberately left untouched rather
  than guess which sub-property the reference was meant for.
- Real, measured jank on content-heavy pages (reported live on a LinkedIn job-search results
  page — infinite scroll, lots of DOM churn), introduced by the `var()`-resolution work above:
  every mutation-triggered render was re-running `querySelector` + `getComputedStyle` — a
  forced synchronous layout — for *every* `var()`-backed rule in the stylesheet, every single
  time, even though the resolved value essentially never changes between renders. Confirmed
  and quantified via a real-Chromium repro simulating an infinite-scroll SPA with a
  ~3,000-rule stylesheet: 452ms spent inside `computeTheme()` and 630 `getComputedStyle` calls
  across a 15-batch scroll session. **Fix**: `VarResolutionCache` (`theme/theme-engine.ts`)
  now persists this resolution across renders instead of recomputing it every time — safe
  because `getComputedStyle()`'s return value is live (confirmed, not assumed: querying a
  previously-obtained reference reflects the *current* value even after the underlying custom
  property changes), with a `isConnected` check to safely re-resolve if the originally-matched
  element is later removed (list virtualization). Cut `getComputedStyle` calls by 95% (630 ->
  30) and total `computeTheme()` time by 60% (452ms -> 172ms) in the same repro, with zero
  behavior change. Also coalesced the (previously independent) DOM-mutation and stylesheet-
  mutation change-detection paths into one shared, macrotask-debounced scheduler, so two
  "please re-render" signals arriving in the same tick collapse into a single render rather
  than two back-to-back ones.
- **Caught before shipping, while verifying the fix above**: the cache's first version treated
  a selector matching *nothing* the same as a real match — permanently. Content-heavy pages
  routinely define a class's CSS before any element with that class exists yet (content
  streamed in later via infinite scroll); caching "no match" would have permanently stuck any
  such selector unthemed the instant it was first checked too early. Fixed by only ever caching
  positive matches — a "no match" always retries fresh next render, which is safe to redo
  unconditionally since selector matching (unlike `getComputedStyle`) doesn't force a style
  recalculation.
- Darkframe could get permanently stuck in light mode on a page with the Grammarly browser
  extension active — reported live. Root-caused to `dom/mutation-tree.ts`'s "self-inflicted"
  filter, which decided whether to ignore a `MutationObserver` batch purely by checking whether
  every touched node carried Darkframe's own managed-style id — on the assumption that only
  Darkframe's own write could ever produce such a batch. That assumption breaks the moment a
  third party removes or replaces that same node as an incidental side effect of *its own*
  unrelated work: Grammarly injects its UI into an *open* shadow root, which Darkframe, by
  design, also themes by inserting a managed `<style>` into it, and Grammarly's shadow-DOM UI
  fully owns and re-renders its own subtree on nearly every keystroke, discarding any child it
  doesn't recognize — including Darkframe's style. Matched purely by node identity, that
  removal was indistinguishable from Darkframe's own write, so it was silently swallowed and
  never triggered a re-render; once it hit the top-level managed stylesheet with no other page
  mutation following to accidentally trigger recovery, the whole page stayed light for good.
  **Fix**: replaced the identity-based heuristic with `MutationWatcher.withoutObserving()` —
  Darkframe's own writes now happen with the observer disconnected, so they never produce a
  mutation record in the first place, and *any* external removal (Grammarly's or otherwise) is
  once again a real, observed mutation that triggers a re-render, which simply re-creates the
  missing element. Verified against the real, installed Grammarly extension in a live Chromium
  instance via Playwright, and with a deterministic regression test (`apply-theme.test.ts`)
  simulating a lone third-party removal.
- Still-visible jank on content-heavy pages even after the `VarResolutionCache` fix above —
  reported live, again on LinkedIn. Root-caused to a second, independent cost the earlier fix
  didn't touch: `VarResolutionCache` only memoized the forced-layout `getComputedStyle` call
  *feeding into* the recolor pipeline, but every resolved value — fresh or not — still ran
  through the full OKLCH round-trip + gamut-mapping + iterative WCAG contrast-solve (up to 40
  binary-search iterations per call — `contrast-solver.ts`) from scratch, on every single
  mutation-triggered render, for every themed property on every rule. A real stylesheet
  overwhelmingly repeats a small design-token palette across hundreds/thousands of selectors,
  so this cost scaled with total stylesheet size rather than with the (almost always far
  smaller) number of *distinct* colors on the page. **Fix**: `RecoloredValueCache`
  (`theme/theme-engine.ts`) memoizes the recolor pipeline's output keyed on its only two real
  inputs — the declared raw value and which property it's for — safe unconditionally (no
  dependency on DOM/rule identity, so no invalidation logic needed for churn or a matched
  element changing; if the raw value itself ever changes, the cache key changes with it), with
  the whole cache cleared if the `settings` reference changes (e.g. a brightness-slider drag).
  Paired with a second, complementary fix: `layer-injector.ts`'s `applyLayerTheme` now skips
  the managed stylesheet's `textContent` write entirely when the freshly computed CSS is
  byte-identical to what's already applied, avoiding a full CSSOM reparse/style-recalc for the
  common case where a render was triggered by a mutation that didn't actually change any
  themed value.
- Large decorative images (banners, cover photos) could get visibly, incorrectly
  "inverted" — reported live on LinkedIn's default profile cover-photo banner, a smooth,
  low-color-diversity gradient. Root-caused to `image/classify.ts`'s flat/photo classifier:
  a smooth gradient's pixel signature (few distinct colors, no sharp local edges) is
  indistinguishable from a small decorative icon/badge asset by content alone, and the
  classifier deliberately treats that signature as `"flat"` (see the existing "a pure smooth
  gradient asset ... is fine to recolor" test) — a sound call for icon-sized assets, where the
  resulting `invert(1) hue-rotate(180deg)` filter (`image/image-theme.ts`) is imperceptible,
  but the exact same transform applied to a large, prominent banner reads as broken/inverted,
  not dark-moded. **Fix**: a decoded-pixel-dimension gate in `analyzeImage` downgrades a
  `"flat"` verdict to `"uncertain"` whenever the image's natural width or height exceeds 512px
  — cheap (the pixel dimensions are already computed for every sampled image; no extra
  DOM/layout read, keeping this consistent with the rest of the codebase's effort to avoid
  forced layout) and safe (only ever downgrades `"flat"`, never touches the `"photo"` verdict,
  so the hard "never alter photos" guarantee is untouched). Under conservative mode (the
  default) an `"uncertain"` image is left alone, the same fallback every other ambiguous case
  already gets.

### Known gaps (tracked, not silently dropped)

- `dom/stylesheet-mutation-watch.ts`'s `CSSStyleSheet.insertRule`/`deleteRule` watching
  (added for CSS-in-JS "speedy" mode support, see above) currently has no effect on a real
  page's own script calls: a content script runs in an isolated JS world that does not share
  `CSSStyleSheet.prototype` with the page's main-world scripts, so the patch only ever
  intercepts same-realm calls — which, in a shipped extension, Darkframe itself never makes
  on a real page stylesheet. Confirmed directly against a real Chromium instance: from the
  main world, `CSSStyleSheet.prototype.insertRule.toString()` still shows unmodified native
  code after the isolated-world patch runs, and a real page's own `insertRule` call never
  triggers a re-render. Fixing this properly needs a *main-world* script (via
  `chrome.scripting.registerContentScripts(..., { world: "MAIN" })` on Chrome — the static
  manifest `"world": "MAIN"` declaration has a longstanding Chrome bug and doesn't reliably
  work — and Safari's equivalent, supported since Safari 16.4) bridging back to the isolated
  world via a `CustomEvent`. Scoped out of the performance-fix pass that discovered this
  because it needs a new `scripting` permission and a new build target — a real
  permission-surface change that deserves its own store-listing justification update, not a
  silent addition alongside an unrelated jank fix.

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
