# Chrome Web Store submission

Everything the Developer Dashboard asks for, ready to paste. Build the package
with `npm run package` and the images with `npm run store-assets`.

Upload: `dist/live-accessibility-overlay-v1.0.0.zip`
Images: `dist/store/`

---

## Store listing tab

**Item name**
```
Live Accessibility Overlay
```

**Short description** (132 char limit — this is 125, and must match the manifest)
```
Find accessibility problems on any page, in plain language: contrast, headings, alt text and keyboard order. Checked locally.
```

**Category** — `Developer Tools`
(`Workflow & Planning` is the alternative if you want to reach designers rather
than engineers. Developer Tools has more traffic; Workflow has less competition.)

**Language** — English (United Kingdom)

**Detailed description**
```
Accessibility tools usually hand you a wall of rule codes and contrast ratios. This one
tells you what is wrong in the words you would actually use, shows you where it is on the
page, and moves on to the next thing.

HOW IT WORKS

Click the icon on any page. You get a short list of problems in plain language — "This text
is hard to read", "This image has no description", "Keyboard focus jumps backwards" — sorted
by what to fix first, then down the page.

Open one and you get why it matters, who it affects, and how to fix it. For colour problems
it suggests the closest colour to your original that people can actually read, ready to copy.

Only the issue you are looking at is marked on the page, so a page with real problems never
turns into a wall of boxes. Press Next to walk through the rest.

WHAT IT CHECKS

• Text contrast — measured with the standard WCAG formula, compositing translucent
  backgrounds and inherited opacity, with the correct thresholds for large text
• Headings — the full outline, flagging skipped levels, empty headings and a missing H1
• Image descriptions — missing alt text, filenames used as descriptions, and links that
  contain only an image and so announce as nothing at all
• Keyboard order — the route the Tab key takes, flagging positive tabindex, focus that jumps
  backwards, and off-screen controls that can still be reached

It also draws the keyboard path across the page on request, and shows the heading outline as
a map you can click through.

BUILT WITH CARE ABOUT FALSE POSITIVES

Screen-reader-only text and disabled controls are excluded, because neither is a real
problem and reporting them is what trains people to ignore a tool. Where a background is an
image or a gradient, it says the contrast cannot be measured rather than guessing.

FOR DEVELOPERS TOO

Every ratio, hex value, CSS selector and WCAG reference is one click away under "Technical
details" — present when you want it, invisible when you do not.

PRIVACY

Nothing is uploaded, ever. There are no analytics, no accounts, and no network requests of
any kind. The extension holds no permission to read any site: it is injected only into the
tab you invoke it on, only when you click the icon, and it cannot see a page you have not
explicitly opened it on. Everything is measured in your browser.

Automated checking catches roughly a third of real accessibility barriers. This will not
tell you whether your alt text is any good, whether your reading order makes sense, or
whether a form is understandable under stress. Those still need a person.
```

---

## Privacy practices tab

**Single purpose** (required, one sentence)
```
Checks the page the user is viewing for accessibility problems and displays them in an overlay panel.
```

**Permission justifications** — each field is required and reviewers read them.

`activeTab`
```
Used to read the DOM and computed styles of the page the user explicitly invokes the
extension on, in order to measure colour contrast, heading structure, image alt text and
keyboard focus order. Access is granted only by the user clicking the toolbar icon or
pressing the keyboard shortcut, and only for that tab.
```

`scripting`
```
Used to inject the extension's analysis and UI code into the active tab when the user clicks
the toolbar icon. The extension deliberately declares no static content scripts so that no
code runs on any page until the user asks for it.
```

`storage`
```
Used to remember two interface preferences locally: the panel's colour theme (system, light
or dark) and which side of the window it is docked to. No page content, scan results or
personal data is stored.
```

**Are you using remote code?** — No. All code is contained in the package.

**Data usage** — tick **nothing**, then confirm all three certifications:
- Not being sold to third parties
- Not being used for purposes unrelated to the item's single purpose
- Not being used to determine creditworthiness or for lending purposes

A privacy policy URL is only required if you declare a data type. Since none is
collected, you can leave it blank — though linking the repo's README is a nice
signal of good faith if you want to.

---

## Images

| Asset | Size | File |
|---|---|---|
| Store icon | 128×128 | `icons/icon-128.png` |
| Screenshot 1 | 1280×800 | `dist/store/screenshot-1-overview.png` |
| Screenshot 2 | 1280×800 | `dist/store/screenshot-2-issue.png` |
| Screenshot 3 | 1280×800 | `dist/store/screenshot-3-on-page.png` |
| Screenshot 4 | 1280×800 | `dist/store/screenshot-4-keyboard-path.png` |
| Screenshot 5 | 1280×800 | `dist/store/screenshot-5-all-clear.png` |
| Small promo tile | 440×280 | `dist/store/promo-tile-440x280.png` |

At least one screenshot is required; five is the maximum and helps conversion.
The promo tile is optional but is what appears if the item is ever featured.

Suggested screenshot captions (the dashboard does not host captions, so bake
them in only if you want them — the images read fine without):
1. Problems in plain language, worst first
2. Why it matters, and the colour that fixes it
3. Only the issue you are looking at is marked
4. See the route the Tab key takes
5. A page with nothing to fix

---

## Before you submit

- [ ] `npm test` passes (117 UI + 23 packaged-extension checks)
- [ ] `npm run package` reports no blocking problems
- [ ] Load `dist/…zip` unpacked once and click through it yourself
- [ ] Developer account registered and the one-off $5 USD fee paid
- [ ] Set visibility: **Unlisted** for a first submission is a good idea — it
      still goes through review, so you learn of any problem without the listing
      being public while you fix it

Review typically takes a few hours to a few days. Extensions with no host
permissions and no data collection — which is this one — are on the fastest path.

## If it gets rejected

The two most common causes do not apply here (remote code, and permissions
broader than the described purpose). If it happens anyway, the rejection email
names the specific policy; fix it, bump `version` in `manifest.json`, re-run
`npm run package`, and upload again.
