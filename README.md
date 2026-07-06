# Umbra

A free, open-source, cross-browser dark-mode engine for Chrome and Safari — built as a
constructive overhaul of Dark Reader's approach, with three explicit goals:

1. **Images and video are never altered.** Photos are classified using local contrast/edge
   density, not just global lightness, and the engine is biased to leave anything it's
   unsure about untouched. `<video>`/`<canvas>`/`<audio>` are unconditionally excluded.
2. **Minimal disruption to the page.** Theming is applied as a single additive `@layer`
   stylesheet — original page stylesheets are never rewritten in place (with a
   CSSOM-direct-rewrite fallback for engines without Cascade Layer support).
3. **Fully free, on every platform, including Safari.** No paid tier, no purchase, ever.

See [PLAN-umbra.md](./PLAN-umbra.md) for the full architecture, phased build plan, risks,
and open questions.

## Status

Phases 0–5 of the plan are built: the core color/DOM/image engine (`packages/core`, 69
passing unit tests), a working Chrome MV3 extension (`packages/ext-chrome`, verified
end-to-end against a real Chromium instance — see `tests/e2e/verify-extension.mjs`), and a
real, buildable macOS Safari Web Extension Xcode project (`packages/ext-safari`, generated
via Apple's `safari-web-extension-converter` and confirmed to build and launch locally with
free ad-hoc code signing). Not yet published to the Chrome Web Store or notarized for
non-technical Safari users — see PLAN-umbra.md Phase 6 and its Open Questions.

## Development

```sh
pnpm install
pnpm build
pnpm test
pnpm lint
pnpm typecheck
```

## Running the Chrome extension locally

```sh
pnpm --filter @umbra/ext-chrome build
```

Then in Chrome: go to `chrome://extensions`, enable Developer Mode, click "Load unpacked",
and select `packages/ext-chrome/dist`.

To re-run the automated real-browser verification (loads the built extension into an actual
Chromium instance via Playwright and checks page recoloring, image safety, and the
popup/background toggle):

```sh
node tests/e2e/verify-extension.mjs
```

## Running the Safari extension locally (macOS, free — no Apple Developer account required)

Requires Xcode. This builds and runs entirely locally with ad-hoc code signing; no App
Store submission or paid Apple Developer Program membership is needed just to build and use
it yourself.

```sh
pnpm --filter @umbra/ext-safari build          # syncs the built web-extension into the Xcode project
open packages/ext-safari/Umbra/Umbra.xcodeproj
```

Then in Xcode, select the "Umbra" scheme and Run. The first time, enable the extension in
**Safari > Settings > Extensions** (you may also need **System Settings > Privacy &
Security > Extensions** and, on some macOS versions, enabling "Allow unsigned extensions"
via `safari.developer` menu / `defaults write` for local development builds).

A signed, notarized build that a non-technical user could install with one click (rather
than building from source) requires an Apple Developer Program membership ($99/year) — see
the "Safari distribution funding decision" open question in PLAN-umbra.md. The extension
itself has no purchase price either way.

## License

MIT — see [LICENSE](./LICENSE).
