# addons.mozilla.org submission

Build with `npm run package`, then upload `dist/live-accessibility-overlay-firefox-v1.1.0.zip`
at [addons.mozilla.org/developers/addon/submit/distribution](https://addons.mozilla.org/developers/addon/submit/distribution).

AMO's flow differs from Chrome's in three ways worth knowing before you start:

- **No registration fee.** Sign in with a Firefox Account and you can submit.
- **Signing is mandatory.** Every add-on is signed by Mozilla; an unsigned build will not
  install in release Firefox. Submitting is what signs it.
- **Source code may be requested.** Only for obfuscated or build-tool output. This project
  ships readable, unbundled JavaScript, so it does not apply — but if a reviewer ever asks,
  point them at the repo.

`npm run package` runs `web-ext lint` — the same linter AMO runs on submission — and fails
the build on errors. It currently reports **zero errors and zero warnings**.

---

## Submission form

**Distribution:** *On this site* (listed publicly on AMO).
Choose *On your own* only if you want a signed build without a public listing.

**Name**
```
Live Accessibility Overlay
```

**Summary** (250 char limit on AMO — more room than Chrome's 132)
```
Find accessibility problems on any page, in plain language: contrast, headings, alt text and keyboard order. One problem at a time, with the fix — not a wall of rule codes. Everything is measured in your browser and nothing is ever uploaded.
```

**Description** — the same body as `STORE-LISTING.md`. AMO renders limited HTML, so plain
paragraphs and `<b>` work; bullet characters are fine as literal text.

**Categories:** *Other* → the closest fit is **Developer Tools** if offered in your
region's list, otherwise **Other**. AMO's taxonomy is shallower than Chrome's.

**Tags:** `accessibility`, `a11y`, `wcag`, `contrast`, `developer-tools`, `design`

**Support email / site:** optional. Link the GitHub repo if you want issues reported there.

**License:** pick one. If you have no preference, **MPL 2.0** is Mozilla's default and sits
naturally alongside a Firefox add-on. MIT is the other reasonable choice.

---

## Privacy

AMO asks a single question rather than Chrome's permission-by-permission form.

**Does your add-on collect or transmit user data?** — **No.**

The manifest also declares this in machine-readable form:

```json
"browser_specific_settings": {
  "gecko": {
    "data_collection_permissions": { "required": ["none"] }
  }
}
```

**Privacy policy:** not required when nothing is collected. If you want to supply one
anyway, the Privacy section of the README says everything needed.

**Notes for reviewers** (optional field, but it speeds things up):
```
The extension requests activeTab and scripting rather than host permissions, and declares
no static content scripts, so no code runs on any page until the user clicks the toolbar
icon or presses Alt+Shift+A. It then injects its analysis and UI into that one tab only.

There are no network requests of any kind, no analytics and no remote code — everything is
measured locally against the DOM and computed styles of the page being viewed. Only two
interface preferences (colour theme, panel side) are written to storage.local.

Source is readable and unbundled; no build step or minification is involved.
```

---

## Images

Reuse the Chrome assets in `dist/store/` — AMO accepts the same screenshots. It has no
required dimensions, unlike Chrome's strict 1280×800.

| Asset | File |
|---|---|
| Icon | `icons/store-icon-128.png` |
| Screenshots | `dist/store/screenshot-*.png` (five) |

AMO has no promo-tile equivalent, so `promo-tile-440x280.png` is Chrome-only.

---

## Version compatibility

The generated manifest sets:

```json
"strict_min_version": "140.0"          // desktop
"gecko_android": { "strict_min_version": "142.0" }
```

**This is a judgment call worth reviewing.** The code itself only needs Firefox **113**
(Manifest V3 and the `action` API arrived in 109; the panel stylesheet uses `color-mix()`,
which landed in 113). The floor is higher only because `data_collection_permissions` needs
140 on desktop and 142 on Android.

The trade:

- **Keep 140/142** — the "collects no data" declaration is machine-readable, and the AMO
  linter is completely silent. Firefox 140 is the current ESR, so anyone below it is on an
  unsupported build.
- **Drop to 113** — reaches older installs, at the cost of one informational lint warning
  (`MISSING_DATA_COLLECTION_PERMISSIONS`) and losing the machine-readable declaration.

Both are defensible. Change `strict_min_version` in `tools/make-icons.mjs`'s sibling,
`tools/package.mjs` (`firefoxManifest()`), if you want the wider reach.

---

## Before you submit

- [ ] `npm test` passes (lint, both API shapes, packaged-extension E2E)
- [ ] `npm run package` reports no errors and no AMO-linter warnings
- [ ] **Load it in real Firefox once**: `about:debugging` → This Firefox → Load Temporary
      Add-on → pick `dist/firefox/manifest.json`. This is the one step no automated check
      here can replace.
- [ ] Firefox Account ready

Review is usually faster than Chrome's — often hours for a listed add-on with no data
collection and no host permissions.
