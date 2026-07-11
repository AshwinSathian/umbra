# Releasing Darkframe

This is the step-by-step path from "code is ready" (where this repo is right now) to
"installable from the Chrome Web Store and the Mac App Store." Everything that could be
prepared in advance — listing copy, screenshots, permission justifications, privacy
disclosures, the upload package itself — already exists in this repo. What's left is a set of
actions only you can take: creating accounts, paying fees, and clicking submit. This doc is
the checklist for those.

## Where things stand right now

| | Chrome Web Store | Mac App Store (Safari) |
|---|---|---|
| Extension builds and works | ✅ verified via `tests/e2e/verify-extension.mjs` (10/10 checks, real Chromium) | ✅ verified via `xcodebuild` + launching the built app |
| Listing copy written | ✅ `store/chrome/listing.md` | ✅ `store/safari/app-store-connect.md` |
| Store images generated | ✅ `store/chrome/screenshots/`, `store/chrome/promo/` | ✅ starter set in `store/safari/screenshots/` (see note below) |
| Upload package | ✅ `node scripts/package-chrome.mjs` → `store/chrome/build/darkframe-chrome-v1.0.0.zip` | ⏳ needs a signed Xcode archive (can't be done until your Apple Developer account is approved) |
| Developer account | ⏳ needs a one-time $5 fee + your action | ⏳ **pending** — you have a submitted Apple Developer Program enrollment awaiting identity verification |
| Privacy policy | ✅ `PRIVACY.md`, publicly reachable via raw GitHub URL | ✅ same file, referenced in the App Privacy questionnaire |

Nothing below requires more engineering work first — it's account/payment/review steps.

## Part 1: Chrome Web Store

This part has no external dependency — you can do it today.

### 1. Create/access your developer account

1. Go to https://chrome.google.com/webstore/devconsole.
2. Sign in with the Google account you want to own this listing.
3. If you haven't registered as a Chrome Web Store developer before, you'll be asked for a
   **one-time $5 registration fee**. This is paid once, ever, per Google account — not per
   extension.

### 2. Build the upload package

```sh
node scripts/package-chrome.mjs
```

This produces `store/chrome/build/darkframe-chrome-v1.0.0.zip` (gitignored — it's a build
artifact, regenerate it any time). Re-run this any time you bump the version.

### 3. Create the item and upload

1. In the dashboard, click **New Item**.
2. Upload `store/chrome/build/darkframe-chrome-v1.0.0.zip`.
3. Chrome will parse the manifest and show you the item's draft page.

### 4. Fill in the Store Listing tab

Open `store/chrome/listing.md` and copy each field across:
- Extension name, summary, description → **Store Listing** tab
- Category → **Store Listing** tab
- Screenshots (`store/chrome/screenshots/*.png`, all 5) and promo tiles
  (`store/chrome/promo/*.png`) → **Store Listing** tab's graphic assets section

### 5. Fill in the Privacy practices tab

Also from `store/chrome/listing.md`:
- Single purpose description
- Permission justifications (one per requested permission — `storage` and
  `host_permissions`)
- "Are you using remote code?" → **No**
- Data usage disclosure table → all **No** (nothing is collected)
- Certifications → check both boxes described in the doc
- Privacy policy URL → `https://raw.githubusercontent.com/AshwinSathian/umbra/main/PRIVACY.md`

### 6. Distribution tab

- Visibility: **Public**
- Pricing: **Free**
- Regions: **All regions**

### 7. Submit for review

Click **Submit for Review**. Chrome Web Store review typically takes a few hours to a few
days for a new listing (first submissions and anything requesting broad host permissions
tend toward the slower end — expect up to a couple of weeks in the worst case, though that's
uncommon). You'll get an email when it's approved or if the reviewer needs changes.

**If the reviewer flags the `host_permissions: <all_urls>` grant**: point them at the
permission justification text already in the dashboard (also in `store/chrome/listing.md`) —
this is a well-understood, common permission class for dynamic dark-mode extensions, and the
justification explains why narrower permissions don't work for this product.

### 8. After approval

- The listing goes live at a URL like
  `https://chromewebstore.google.com/detail/darkframe/<generated-id>`.
- Update `README.md` with the real install link (replace the "Load unpacked" dev instructions
  with "Install from the Chrome Web Store" as the primary path, keeping the dev path for
  contributors).
- See "Tagging a release" below.

## Part 2: Safari (Mac App Store)

This part is blocked on your Apple Developer Program enrollment being approved (currently
pending identity verification, per our conversation). Everything else is ready to go the
moment that clears.

### 0. Wait for approval

Check https://developer.apple.com/account — enrollment status shows there. Apple's identity
verification can take anywhere from same-day to a couple of weeks depending on what
additional documentation they ask for. Nothing below can proceed until this shows
**Active**.

### 1. Register the App ID

Once approved, in the Apple Developer portal → **Certificates, Identifiers & Profiles** →
**Identifiers**:
1. Register a new App ID: `com.darkframe.app` (the container app).
2. Register its associated extension App ID: `com.darkframe.app.Extension`.
3. Both are already set as the `PRODUCT_BUNDLE_IDENTIFIER` in
   `packages/ext-safari/Darkframe/Darkframe.xcodeproj/project.pbxproj` — you're just
   registering the identifiers Apple's side, not changing anything in the project.

### 2. Set up signing in Xcode

1. Open `packages/ext-safari/Darkframe/Darkframe.xcodeproj` in Xcode.
2. Select the **Darkframe** target → **Signing & Capabilities**.
3. Switch **Team** from "None" to your Apple Developer team.
4. Repeat for the **Darkframe Extension** target.
5. With "Automatically manage signing" checked (the default), Xcode provisions everything
   itself — no manual certificate/profile juggling needed for a straightforward app like
   this one.
6. Build once (⌘B) to confirm it still builds clean with real signing instead of the
   "Sign to Run Locally" ad-hoc identity used during development.

### 3. Create the app record in App Store Connect

1. Go to https://appstoreconnect.apple.com → **My Apps** → **+** → **New App**.
2. Platform: **macOS**. Name: `Darkframe`. Bundle ID: select `com.darkframe.app` (now
   registered). SKU: any unique string, e.g. `darkframe-macos-1`.
3. This creates the empty app record you'll fill in next.

### 4. Fill in the listing

Open `store/safari/app-store-connect.md` and copy each field across: name, subtitle,
category, age rating, pricing, App Privacy answers, description, keywords, support/marketing
URLs, and the App Review notes (important — Safari extensions are invisible until manually
enabled, and reviewers need to be told how).

**Before uploading screenshots**: the doc recommends replacing at least the first screenshot
with a real one taken in actual Safari. To do that:
```sh
pnpm --filter @darkframe/ext-safari build:xcode
```
then run the built app, enable the extension in **Safari → Settings → Extensions**, visit a
real website, and take a screenshot (⌘⇧4, or ⌘⇧5 for more control) at one of Apple's accepted
sizes (1280×800, 1440×900, 2560×1600, or 2880×1800). The existing generated images in
`store/safari/screenshots/` are valid to use as-is if you'd rather not do this manual step —
they're accurate, just not literally captured inside Safari's window chrome.

### 5. Archive and upload the build

1. In Xcode, select the **Darkframe** scheme and the **Any Mac** destination (not a
   simulator).
2. **Product → Archive**.
3. When the Organizer window opens, select the archive → **Distribute App** → **App Store
   Connect** → **Upload**. Xcode handles signing and upload with the team you set up in step
   2.
4. Back in App Store Connect, the build appears under the app's **TestFlight** or **App
   Store** build list after Apple finishes processing it (usually 15–60 minutes).
5. On the app's version page, select that build.

### 6. Submit for review

Click **Add for Review** → **Submit to App Review**. Apple's typical review time is 24–48
hours for a straightforward app, though Safari Web Extensions sometimes take a reviewer a
little longer since they have to manually enable the extension to test it — the App Review
notes you filled in step 4 are there specifically to make that fast.

### 7. After approval

- The app goes live at its Mac App Store URL.
- Update `README.md`'s Safari section to lead with the App Store install link, keeping the
  build-from-source path as a secondary "want to build it yourself, or can't wait for
  review" option — don't delete that path, it's the only route available to anyone before
  this ships and remains valuable for contributors/auditors.

## Interim: Safari build-from-source stays available throughout

Nothing above blocks people from using Safari today. `README.md` already documents
`pnpm --filter @darkframe/ext-safari build` + opening the Xcode project + Run, which works
right now with zero Apple Developer Program dependency (ad-hoc "Sign to Run Locally" signing,
confirmed working in this repo's history). Keep pointing people there until the App Store
listing is live, and keep the instructions afterward for anyone who prefers building from
source.

## Tagging a release

Once you've submitted (or, if you'd rather wait for actual approval — your call) to at least
one store:

```sh
git tag -a v1.0.0 -m "v1.0.0 — first public release"
git push origin v1.0.0
```

And update `CHANGELOG.md`: rename the `## [Unreleased]` heading to `## [1.0.0] - <today's
date>`, and add a fresh empty `## [Unreleased]` section above it for whatever comes next.

Consider also creating a GitHub Release (`gh release create v1.0.0`) with
`store/chrome/build/darkframe-chrome-v1.0.0.zip` attached — gives people a way to
side-load/audit the exact submitted build without waiting on either store's review queue.

## Keeping both listings in sync on future versions

1. Bump the version: `package.json` (root + every `packages/*/package.json`),
   `packages/ext-chrome/manifest.json`, and the Xcode project's `MARKETING_VERSION` (Xcode →
   target → General tab, or edit `project.pbxproj` directly — both `Darkframe` and `Darkframe
   Extension` targets, all four build configurations).
2. Regenerate assets if the product's visuals changed:
   `node scripts/generate-store-assets.mjs` (Chrome screenshots/promo — safe to also reuse
   for Safari per the note above).
3. Rebuild the Chrome package: `node scripts/package-chrome.mjs`.
4. Update `CHANGELOG.md` with what changed.
5. Re-run the full verification suite before uploading anywhere:
   ```sh
   pnpm lint && pnpm typecheck && pnpm test && pnpm build
   node tests/e2e/verify-extension.mjs
   ```
6. Upload the new Chrome zip as a new package version in the existing dashboard item
   (dashboard → your item → **Package** → **Upload new package**), and a new build via Xcode
   Archive for Safari. Listing copy usually doesn't need re-submitting unless it changed.

## A note on the `host_permissions: <all_urls>` review risk

This is the one part of both submissions most likely to draw reviewer questions, on both
platforms — any extension that needs to read/modify every page a user visits looks the same
to an automated policy scanner whether it's doing something benign (recoloring pages) or
something invasive (harvesting data). The justification text in both listing docs is written
to preempt that question directly. If either store's review comes back asking for more detail
specifically about this permission, the honest, accurate answer is already written — point
them at it rather than writing a new one from scratch, so the story stays consistent across
both platforms and against `PRIVACY.md`.
