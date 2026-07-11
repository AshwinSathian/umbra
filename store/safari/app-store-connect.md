# App Store Connect listing — copy-paste reference (Safari Web Extension, macOS)

Everything here is meant to be pasted into App Store Connect
(https://appstoreconnect.apple.com) once the Apple Developer Program membership is approved
and an app record is created. Kept in-repo so it's reviewable and versioned, same as
`store/chrome/listing.md`.

**Status note**: as of this writing, the Apple Developer Program enrollment is submitted and
pending identity verification — not yet approved. Nothing in this file can actually be
submitted until that completes. This file exists so submission is a copy-paste exercise, not
a research project, the moment the account is ready. See RELEASING.md for the exact sequence.

## App Information tab

**Name** (max 30 chars):

```
Darkframe
```

**Subtitle** (max 30 chars, shown under the name):

```
Dark mode. Photos untouched.
```

**Bundle ID**: `com.darkframe.app` (already set in the Xcode project —
`packages/ext-safari/Darkframe/Darkframe.xcodeproj`). Must be registered as an App ID under
**Certificates, Identifiers & Profiles** in the Apple Developer portal before it can be
selected in App Store Connect — see RELEASING.md.

**Primary category**: `Utilities` (Mac App Store's closest fit to Chrome Web Store's
"Accessibility"; Utilities is where most Safari extension host apps land). **Secondary
category**: `Productivity`.

**Age rating**: complete Apple's questionnaire honestly — everything should resolve to the
lowest tier (4+). No user-generated content, no gambling, no objectionable content, nothing
in this extension implicates any of the categories.

## Pricing and Availability

- **Price**: Free
- **Availability**: All countries/regions (no data-residency reason to restrict)

## App Privacy tab

Apple's "nutrition label" questionnaire. Answer per PRIVACY.md — Darkframe collects nothing:

- "Does this app collect data?" → **No, we do not collect data from this app.**

That single declaration is sufficient — when "No" is selected, Apple doesn't require walking
through the individual data-type categories (contrast with Chrome's dashboard, which still
asks per-category even when the answer is uniformly "no"). If Apple's flow has changed and
does ask per-category despite that top-level "No", answer the individual categories the same
way as `store/chrome/listing.md`'s data-use table — all "No".

## Version Information tab (for the container app, which is what App Review actually reviews
— the extension itself has no separate listing)

**Promotional text** (max 170 chars, editable without a new build):

```
Free, open-source dark mode for every site. Photos and video are never altered — only page
chrome gets recolored. No telemetry, ever.
```

**Description** (max 4,000 chars):

```
Darkframe is a free, open-source dark mode for every website — built around one hard rule:
your photos and videos are never touched.

This app is a lightweight host for the Darkframe Safari Web Extension. After installing,
enable the extension once in Safari Settings → Extensions (this app's window walks you
through that step).

WHAT IT DOES
• Recolors page backgrounds, text, and UI chrome to a dark theme in real time, using a
  perceptually uniform (OKLCH) color remap — hues stay correct instead of shifting toward mud.
• Classifies every image before touching it, using local contrast, edge density, and color
  diversity — not just a brightness average. Photos, illustrations, and anything the
  classifier isn't confident about are left exactly as the site author made them.
• Solves recolored text against a WCAG 2.1 contrast target, so text stays readable.
• Cooperates with sites that already ship a native dark mode instead of double-theming them.
• Per-site on/off, plus brightness/contrast/sepia/grayscale and contrast-target sliders.

WHAT IT DOESN'T DO
• No telemetry, no analytics, no data collection of any kind — there is no backend for this
  extension at all.
• No paid tier. Darkframe is free on every platform it ships on, including this Mac app —
  there is no "Pro" version withholding features.
• No canvas/WebGL pixel theming (e.g. Figma, Google Docs' canvas layers) — a structural
  limitation of any CSS-based dark-mode extension, not something Darkframe papers over with
  an unreliable partial fix.

Darkframe is fully open source under the MIT license:
https://github.com/AshwinSathian/umbra
```

**Keywords** (max 100 chars, comma-separated, no spaces needed after commas):

```
dark mode,dark theme,night mode,eye strain,accessibility,contrast,safari extension,oklch
```

**Support URL**:

```
https://github.com/AshwinSathian/umbra/issues
```

**Marketing URL** (optional):

```
https://github.com/AshwinSathian/umbra
```

**Copyright**:

```
© 2026 Ashwin Sathian
```

## App Review Information tab

Safari Web Extensions require one specific thing reviewers often need spelled out: the
extension is invisible until manually enabled in Safari Settings, and this app's own window
exists specifically to walk the user through that.

**Notes for the reviewer**:

```
Darkframe is a Safari Web Extension. This app's window explains how to enable it: open
Safari → Settings → Extensions, check "Darkframe", then grant it permission on websites you
visit (either "Ask" per-site or "Always Allow" — the extension needs page access to compute
and apply its dark theme, the same permission scope any dynamic dark-mode extension
requires). Once enabled, visit any website with the extension on to see the dark theme
applied. The extension's own on/off toggle and settings are reachable via the Safari
toolbar's extensions menu (the puzzle-piece icon) → Darkframe.

No account, sign-in, or network access is required to use or review this extension — it is
fully client-side with no backend and collects no data (see the App Privacy tab).
```

**Contact information**: use your own name/email/phone — required by Apple, not shown
publicly.

**Demo account**: not applicable — no sign-in exists.

## Screenshots (App Information → Mac screenshots)

Apple accepts one Mac screenshot set at any of 1280×800, 1440×900, 2560×1600, or 2880×1800
(16:10), 1–10 images, JPEG or PNG — Apple scales it for every Mac display size, no need for
multiple sets. `store/safari/screenshots/` currently holds 1280×800 images reused from the
Chrome listing's generated assets (before/after, popup, options, feature card) — these are
browser-chrome-agnostic (they show the themed web page and the shared popup/options UI, not
Chrome-specific browser frame), so they're accurate for Safari too as a starting point.

**Recommended before submitting**: once the extension is manually enabled in real Safari
(`pnpm --filter @darkframe/ext-safari build:xcode`, then enable in Safari Settings →
Extensions per the App Review notes above), replace at least the first screenshot with a
genuine screenshot taken in Safari itself (⌘⇧4 or Screenshot.app) showing the extension
active in Safari's actual window chrome — more convincing than a browser-agnostic composite,
though not a hard Apple requirement. This is a manual step; nothing in this repo can
automate it (Playwright's `webkit` engine is not real Safari and cannot load a signed Safari
Web Extension).

## App Icon

The container app's icon (`packages/ext-safari/Darkframe/Darkframe/Assets.xcassets/
AppIcon.appiconset/`) is already generated at every required size via
`node scripts/generate-icons.mjs` and is picked up automatically by Xcode's build — no
separate 1024×1024 App Store icon upload is needed for Mac apps built with an asset catalog
(unlike iOS, which needs a separate marketing icon upload in some flows).
