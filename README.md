# Darkframe

[![CI](https://github.com/AshwinSathian/umbra/actions/workflows/ci.yml/badge.svg)](https://github.com/AshwinSathian/umbra/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Tests](https://img.shields.io/badge/tests-119%20passing-brightgreen)](./PLAN-darkframe.md)

A free, open-source, cross-browser dark-mode engine for Chrome and Safari — built as a
constructive overhaul of Dark Reader's approach, with three explicit goals:

1. **Images and video are never altered.** Photos are classified using local contrast/edge
   density, not just global lightness, and the engine is biased to leave anything it's
   unsure about untouched. `<video>`/`<canvas>`/`<audio>` are unconditionally excluded.
2. **Minimal disruption to the page.** Theming is applied as a single additive `@layer`
   stylesheet — original page stylesheets are never rewritten in place (with a
   CSSOM-direct-rewrite fallback for engines without Cascade Layer support).
3. **Fully free, on every platform, including Safari.** No paid tier, no purchase, ever.

See [PLAN-darkframe.md](./PLAN-darkframe.md) for the full architecture, phased build plan, risks,
and open questions.

## Status

Phases 0–5 of the plan are built: the core color/DOM/image engine (`packages/core` +
`packages/shared`, 119 passing unit tests), a working Chrome MV3 extension
(`packages/ext-chrome`, verified end-to-end against a real Chromium instance — see
`tests/e2e/verify-extension.mjs`), and a real, buildable macOS Safari Web Extension Xcode
project (`packages/ext-safari`, generated via Apple's `safari-web-extension-converter` and
confirmed to build and launch locally with free ad-hoc code signing).

Both store listings are fully prepared — packaged build, screenshots, promo art, and every
required piece of listing/privacy copy — but not yet submitted: the Chrome Web Store
submission just needs a developer-account action, and the Safari/Mac App Store submission is
blocked on Apple Developer Program identity verification currently in progress. See
[RELEASING.md](./RELEASING.md) for the full step-by-step path and [`store/`](./store) for the
prepared listing copy and generated assets for both platforms.

The project has also been through a dedicated adversarial security audit and an independent
architecture/quality audit — see PLAN-darkframe.md's "Security Hardening" section for the two
real vulnerabilities found and fixed, and the "Follow-up Work" / Data Flow sections for the
quality findings addressed.

## Try it now (before either store listing is live)

Neither store submission is live yet (see [RELEASING.md](./RELEASING.md)), but nothing about
that blocks using Darkframe today — one script builds it from source and gets it into a real
Chrome and/or Safari on this machine:

```sh
pnpm install
pnpm install:local            # builds + sets up whatever this OS supports
```

It installs dependencies, builds the extension, structurally validates the build output
(catches a truncated build before you try to load it), and — unless `--no-open` is
passed — opens a detected Chromium-family browser straight to `chrome://extensions` (with
the unpacked-extension folder path already on your clipboard) and, on macOS, builds the
Safari Xcode project and launches the resulting app. The one manual click each browser still
requires ("Load unpacked" in Chrome, enabling the extension in Safari's Settings) is a
deliberate security boundary neither browser exposes to scripts — see the comment at the top
of [`scripts/install-local.mjs`](./scripts/install-local.mjs) for the full option list
(`--chrome`, `--safari`, `--all`, `--no-open`, `--verify`, `--skip-install`, `--help`) and
what each target validates. Safe to re-run any time, e.g. after pulling new changes.

The sections below document the same two paths by hand, for anyone who'd rather run the
individual commands themselves or is auditing what the script does.

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
pnpm --filter @darkframe/ext-chrome build
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
pnpm --filter @darkframe/ext-safari build          # syncs the built web-extension into the Xcode project
open packages/ext-safari/Darkframe/Darkframe.xcodeproj
```

Then in Xcode, select the "Darkframe" scheme and Run. The first time, enable the extension in
**Safari > Settings > Extensions** (you may also need **System Settings > Privacy &
Security > Extensions** and, on some macOS versions, enabling "Allow unsigned extensions"
via `safari.developer` menu / `defaults write` for local development builds).

A signed, notarized build that a non-technical user could install with one click (rather
than building from source) requires an Apple Developer Program membership ($99/year) — the
project has committed to this and enrollment is in progress (pending Apple's identity
verification); see [RELEASING.md](./RELEASING.md) for the Mac App Store submission path once
that clears. The extension itself has no purchase price either way.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). This project follows the
[Contributor Covenant Code of Conduct](./CODE_OF_CONDUCT.md).

## Security

Found a vulnerability? Please see [SECURITY.md](./SECURITY.md) — don't open a public issue
for it.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).

## Releasing

See [RELEASING.md](./RELEASING.md) for the full Chrome Web Store and Mac App Store
submission process, and [`store/`](./store) for prepared listing copy and generated store
assets for both platforms.

## License

MIT — see [LICENSE](./LICENSE).
