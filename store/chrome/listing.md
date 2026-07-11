# Chrome Web Store listing — copy-paste reference

Everything in this file is meant to be pasted directly into the Chrome Web Store Developer
Dashboard (https://chrome.google.com/webstore/devconsole) when creating the listing. It's
kept in the repo (not the dashboard) so it's reviewable, versioned, and regenerable.

## Store Listing tab

**Extension name** (max 45 chars — currently 9):

```
Darkframe
```

**Summary** (shown under the name in search/listing cards, max 132 chars):

```
Free dark mode for every site. Photos and video are never altered — only page chrome is recolored.
```

**Description** (main listing body, max 16,000 chars):

```
Darkframe is a free, open-source dark mode for every website — built around one hard rule:
your photos and videos are never touched.

Most dark-mode extensions decide whether to recolor an image using a single global
brightness average. That average is easy to get wrong — a bright product photo on a white
background, or a photo with a large sky or wall in it, regularly gets misclassified as a
plain icon and gets inverted or dimmed along with the rest of the page. Darkframe uses a
image classifier that looks at local contrast, edge density, and color diversity, not just
brightness — and when it isn't confident an image is a flat icon or logo, it leaves the
image completely alone. Video and canvas elements are unconditionally excluded, full stop,
not just heuristically avoided.

WHAT IT DOES
• Recolors page backgrounds, text, and UI chrome to a dark theme in real time, using a
  perceptually uniform (OKLCH) color remap instead of a naive color inversion — so hues stay
  correct instead of shifting toward mud.
• Solves recolored text against a WCAG 2.1 contrast target, so text stays readable rather
  than merely "dark."
• Classifies every image before touching it. Photos, illustrations, and anything the
  classifier isn't confident about are left exactly as the site author made them. Only flat
  icons/logos get recolored.
• Cooperates with sites that already ship a native dark mode instead of double-theming them.
• Applies its overrides as a single additive stylesheet — it doesn't rewrite the page's own
  CSS in place, so it's a smaller, more reversible footprint than extensions that mutate
  every stylesheet on the page.
• Per-site on/off, plus brightness/contrast/sepia/grayscale and contrast-target sliders.

WHAT IT DOESN'T DO
• No telemetry, no analytics, no data collection of any kind. Nothing about your browsing
  is ever sent anywhere — there is no backend for this extension at all.
• No paid tier. Darkframe is free on every platform it ships on, including Safari — there is
  no "Pro" version withholding features.
• No canvas/WebGL pixel theming (e.g. Figma, Google Docs' canvas-rendered layers) — this is
  a structural limitation of any CSS-based dark-mode extension, not something Darkframe
  papers over with a partial, unreliable fix.

Darkframe is fully open source under the MIT license. Read the code, file an issue, or see
exactly what it does and doesn't do: https://github.com/AshwinSathian/umbra
```

**Category**: `Accessibility` (primary fit: contrast/eye-strain focus; `Tools` is a reasonable
fallback if Accessibility doesn't fit the review team's judgment on the day you submit —
category options do shift over time, so confirm the live list in the dashboard).

**Language**: English

## Privacy practices tab

**Single purpose description** (required, must be narrow and specific):

```
Darkframe's single purpose is to apply a dark color theme to the web pages a user visits,
in real time, without altering photographic images or video.
```

**Permission justifications** (one field per requested permission in the dashboard):

- `storage`:
  ```
  Used to save the user's own settings locally in the browser (global on/off, per-site
  overrides, and theme sliders such as brightness/contrast/sepia/grayscale) via
  chrome.storage.local, so preferences persist across browser restarts. Nothing stored here
  is transmitted anywhere.
  ```
- `host_permissions` (`http://*/*`, `https://*/*`):
  ```
  Darkframe's single purpose — recoloring a visited page's own styles in real time — requires
  reading that page's stylesheets, computed styles, and image pixel data on whichever site the
  user has it enabled on, and requires being able to run on any site the user chooses (dark
  mode is not useful if restricted to a fixed list of domains). All of this processing happens
  locally in the browser session; no page content, URL, or browsing data is ever transmitted
  off the device. This is the same permission scope any dynamic (as opposed to canned-CSS)
  dark-mode extension requires for the same reason.
  ```
- Background service worker / content scripts (if the dashboard asks for a general
  justification beyond the two permissions above):
  ```
  The background service worker relays cross-origin stylesheet fetches (needed because a
  page's own Content-Security-Policy can block a content script's own fetch of a third-party
  stylesheet, but not the extension's background context) and stores/reads settings. It holds
  no persistent in-memory state and contacts no server other than the third-party stylesheet
  URLs the visited page itself already references.
  ```

**Are you using remote code?**: `No`. (Confirmed: no `eval`, no remotely fetched/executed
script anywhere in the codebase — grep-verified. All logic ships inside the extension
package. See PLAN-darkframe.md's Chrome Web Store requirements research if this needs
re-verifying at submission time.)

**Data usage** (per-category disclosure — answer for each category the dashboard lists,
matching PRIVACY.md exactly):

| Category | Collected? |
|---|---|
| Personally identifiable information | No |
| Health information | No |
| Financial and payment information | No |
| Authentication information | No |
| Personal communications | No |
| Location | No |
| Web history | No |
| User activity (clicks, mouse position, scroll) | No |
| Website content (the actual page content Darkframe reads to theme it) | **See note below** |

Note on "Website content": Darkframe's content script *reads* page stylesheets, DOM, and
image pixel data in memory in order to compute a theme — but this data is never persisted,
transmitted, or shared, and is discarded the moment the tab closes or the theme
recomputes. Chrome's own guidance is that this disclosure is about data that is *collected*
(persisted/transmitted), not merely read in-memory to perform the extension's function — so
the accurate answer here is **No** collection, with the justification text above making the
in-memory-only read explicit for reviewers. If Chrome's dashboard copy asks this more
literally at submission time ("does your extension read website content"), answer honestly
in whatever the current field actually asks — don't let this note override the live UI.

**Certifications** (checkboxes in the dashboard):
- ✅ "I do not sell or transfer user data to third parties outside of the approved use cases"
  — true, there is no data transfer of any kind.
- ✅ "I do not use or transfer user data for purposes unrelated to the item's single purpose"
  — true, trivially, since no user data is collected at all.
- ✅ Certify compliance with the Limited Use requirements.

**Privacy policy URL**:

```
https://raw.githubusercontent.com/AshwinSathian/umbra/main/PRIVACY.md
```

(Works immediately with zero setup. A nicer long-term option — not required — is enabling
GitHub Pages for the repo and linking a rendered HTML version instead of raw Markdown; see
RELEASING.md for that as an optional polish step.)

## Distribution tab

- **Visibility**: Public
- **Pricing**: Free (no in-app purchases, no paid tier — matches the product's actual
  no-monetization design)
- **Regions**: All regions (no reason to restrict; there's no data-residency concern since
  nothing is collected)

## Graphic assets

See `store/chrome/screenshots/` (5 images, 1280×800) and `store/chrome/promo/` (440×280
small tile, 1400×560 marquee tile) — generated by `scripts/generate-store-assets.mjs` from
the real, running extension. The 128×128 icon already lives at
`packages/ext-chrome/icons/icon-128.png`.
