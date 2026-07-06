# Privacy Policy

Umbra does not collect, transmit, or store any user data, browsing history, or page
content on any server. There is no backend, no analytics SDK, and no telemetry of any
kind in this codebase.

## What the extension can see

Umbra requests broad host permissions (`http://*/*`, `https://*/*`) because its purpose —
recoloring arbitrary web pages — requires reading each page's stylesheets, DOM, and images
to compute a theme. This is the same class of permission any dynamic dark-mode extension
(including Dark Reader) requires, and is used only to:

- Read stylesheet rules and image pixel data, in memory, in order to compute recolored
  values.
- Write theme overrides back into that same page.

None of this data ever leaves the browser. There is no `fetch`/`XMLHttpRequest` call to
any Umbra-controlled server anywhere in this codebase.

## What is stored

Only your own settings — whether Umbra is enabled globally and per-site overrides — are
stored locally via the browser's own extension storage (`chrome.storage.local` / the
Safari Web Extension equivalent). This storage is local to your browser profile and is
not synced to any Umbra server (browser-level sync, if you have Chrome/Safari sync
enabled for extension storage, is between your own devices via your own browser vendor
account, not via Umbra).

## Third parties

Umbra has no third-party dependencies that transmit data at runtime. Build-time developer
tooling (TypeScript, ESLint, Vitest, esbuild, Playwright) does not ship in the built
extension.

## Changes

Since this project is open source, any future change to this policy will be visible in
the commit history at the project's repository.
