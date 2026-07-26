# Live Accessibility Overlay

A Chrome extension that shows accessibility problems **on the live page, in context** — not
in a report you read afterwards.

It checks four things — contrast, heading structure, alt text and keyboard order — and
presents them the way a spell-checker does: one problem at a time, in plain words, with the
fix. Everything is measured locally in the tab. Nothing is uploaded, and the extension cannot
read a page it was not explicitly invited into.

---

## Install (unpacked)

```bash
git clone <this repo> && cd Live-Accessibility-Overlay
```

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. **Load unpacked** → select this folder
4. Open any page and click the toolbar icon, or press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>A</kbd>

There is no build step. The extension is plain ES5-compatible JavaScript with no bundler and
no dependencies; the `devDependencies` exist only to run the tests.

---

## The design

### It works like a spell-checker, not a dashboard

You do not get every misspelling highlighted at once alongside a control panel. You get one
problem, why it matters, how to fix it, and **Next**. That is the whole model here:

- **The page stays clean.** Nothing is drawn on it until you pick something to look at, and
  then exactly one element is marked. There are no lens toggles to configure.
- **Plain language throughout.** "This text is hard to read", not "1.96:1 against 4.5:1".
- **Prev / Next through the list**, ordered worst-first and then down the page, so walking
  the list walks the page.

### Two tiers, not three

**Fix this** (a solid dot) and **Worth checking** (a hollow one). "Notice" is a distinction
only an expert wants to make, so it is folded into the second tier. Rose and ochre carry the
colour; the filled/hollow dot carries the same meaning without it, so severity survives
colour blindness and greyscale screenshots. Backward jumps in the keyboard path are dashed as
well as ochre, for the same reason.

### One row per problem, not per occurrence

A gallery with 200 undescribed images has *one* problem, not 200. Findings of the same kind
collapse into a single row carrying every occurrence, and the issue screen steps through them
with **1 of 200** — showing that place's own sample and its own suggested fix. On a page with
1,800 findings the list is five rows long.

### Technical detail is present, not prominent

Every ratio, hex value, selector and WCAG reference lives behind a collapsed **Technical
details** disclosure. A developer opens it once and it stays open; nobody else ever sees it.
That is what lets the surface stay plain without dumbing the tool down.

### Aperture

The tool reads a page the way a light meter reads a scene — legibility, not compliance
policing. That drives the mark (a hexagonal iris), the aqua/rose/ochre palette, and the
language: "5 things to fix", never "5 violations".

On-page, an issue is marked with **thin corner brackets** — crop marks, not boxes — and a
caption in plain words. The caption is right-aligned above the block, because whatever sits
above it is nearly always left-aligned and narrower, so that corner is usually empty.

### The panel

Docked, not floating; 372px; light and dark following the system, with a manual override.
Two panes slide between the list and a single issue.

---

## What it checks

### Contrast
Every text-bearing element is measured with the standard WCAG relative-luminance formula.
The effective background is resolved by walking ancestors and compositing translucent layers,
and text alpha and inherited opacity are composited too.

Care has gone into *not* reporting things that are not problems:

- **Screen-reader-only text is excluded.** `clip`/`clip-path` sr-only patterns are detected.
  Reporting them is the most common false positive in naive scanners.
- **Disabled controls are excluded.** WCAG 1.4.3 exempts inactive components; measuring them
  flags every form on the web.
- **Large-text thresholds are applied properly** — 3:1 at ≥24px, or ≥18.66px bold.
- **Image and gradient backgrounds are reported as unmeasurable**, not guessed at. An honest
  "cannot measure this" beats a confident wrong number.

The suggested fix holds hue and saturation and moves lightness only as far as it must,
picking the perceptually nearest passing colour by CIE Lab ΔE — and it will not suggest
repainting the page canvas. Each place gets its own suggestion as you step through them.

### Headings
Full outline including `role="heading"` with `aria-level`, flagging skipped levels, empty
headings, missing or duplicated `h1`, and headings hidden from view.

### Alt text
Distinguishes *decorative* from *meaningful*, which is the distinction that matters:
missing attribute vs. `alt=""`, filename-as-alt, placeholder alt, redundant "image of…"
phrasing, over-long alt, and — most importantly — images that are the sole content of a link
or button with no accessible name.

### Keyboard order
Derived by walking focusable elements and applying sequential-focus rules (positive `tabindex`
first in ascending order, then DOM order). Nothing requires you to press Tab. Flags positive
`tabindex`, backward jumps against reading order, and off-canvas controls still in the tab
order — the classic closed-drawer bug.

The numbered route is the one thing drawn all at once, because a path is meaningless unless
you can see the whole of it. It is opt-in: **Keyboard path**, never on by default.

All four lenses descend into **open shadow roots**, so component-driven sites are actually
audited rather than silently under-reported.

---

## Privacy

- `activeTab`, `scripting`, `storage`. **No host permissions**, no static content scripts.
- Nothing is injected into any page until you click the icon or press the shortcut.
- No network calls of any kind. No analytics. Nothing persists but your theme and which side
  the panel sits on.

---

## Its own accessibility

An inaccessible accessibility tool would be an embarrassment, so the panel is held to the
standard it measures:

- Full keyboard operation; <kbd>Esc</kbd> steps back one level, then closes.
  <kbd>Alt</kbd>+<kbd>↓</kbd>/<kbd>↑</kbd> moves between issues.
- Real semantics: `role="dialog"`, real lists and buttons, native `<details>` for the
  technical disclosure (correct expanded semantics with no ARIA of ours), and a polite live
  region announcing scan results and issue changes.
- The off-screen pane is `inert`, so it never takes focus or gets read out.
- One focus treatment everywhere; it never mutates an element's shape.
- `prefers-reduced-motion` removes motion — including the decorative flourishes — without
  removing the design. `forced-colors` hands control back to the system palette.
- **The palette is verified by the extension's own contrast engine**, in both themes, against
  every surface each token actually appears on. That check is part of the test suite, and it
  has already caught two tokens I had misjudged by eye.

The marker layer is `aria-hidden`: the mark is a pointer affordance over content already in
the accessibility tree, and every issue is reachable as a real control in the panel.

---

## Tests

```bash
npm install
npm test            # lint + unit/UI harness + packaged-extension E2E
npm run shots       # regenerate test/shots/
```

- **`tools/check-syntax.mjs`** — parses every file. The stylesheet is a template literal, and
  a stray backtick once wiped out the entire design system while every behavioural test still
  passed. That failure mode now gets caught first.
- **`test/harness.mjs`** (112 checks) — loads the runtime against two fixtures with
  known-answer issues. Asserts audit correctness, that the styling actually applied, the
  palette self-audit, reduced motion, and performance on a heavy page (~1,800 findings over
  2,700 nodes, scanning in ~250ms).

  It also guards the properties that make the tool simple, because those are exactly what
  erode as features get added: **no jargon on the overview screen**, no toggles to configure,
  issue titles that are plain sentences rather than ratios, nothing drawn on the page until
  something is selected, exactly one mark once it is, and 1,800 findings collapsing to a
  list of five rows.
- **`test/extension.mjs`** (19 checks) — loads the real unpacked extension in Chromium and
  drives the actual injection path: manifest, service worker, file order, message handshake,
  storage round-trip, and isolated-world separation.

`test/fixture-issues.html` contains deliberate, documented problems; `test/fixture-clean.html`
must report exactly zero.

---

## Judgment calls

The PRD left three questions open. These are the calls I made, and why.

**1. Severity tiers — fixed three-tier, or more granular?**
The audits compute three levels internally (a 1.9:1 near-invisible failure is genuinely a
different problem from a 4.3:1 near-miss), but the interface shows **two**: *Fix this* and
*Worth checking*. Three labels made people classify rather than act, and "notice" is a
distinction only an expert wants. The precise level is in Technical details.

**2. How much detail on the page versus behind a click?**
The page carries a plain-language caption and nothing else — no ratios, no tooltips. All
detail lives in the panel, where there is room for it. On-page popovers cover the very
layout being audited, which defeats the point of an in-context tool.

**3. Draggable panel, or fixed?**
Docked to one side, with a control to flip left/right, and not free-dragging. Free-drag panels
get lost, overlap the content you are inspecting, and add a state nobody wants to manage.
Flipping sides solves the real problem (the panel covering the thing you are looking at)
without the cost. Panel side persists.

**Further calls worth flagging, since they are genuinely arguable:**

**Nothing is marked on the page by default.** The first build drew every finding at once. It
was accurate and unusable: a page with real problems became a wall of brackets that told you
nothing about where to start. Marking one thing at a time trades a sense of overall scale for
the ability to act — and the scale is still there, in the headline count.

**Findings are grouped, so the list under-reports raw counts.** "This text is hard to read ·
5 places" is one row, not five. The count of distinct problems is the useful number; the
count of DOM nodes is not.

**Focus is not trapped in the panel.** A modal trap is the more conventional dialog pattern,
but trapping keyboard focus inside an *accessibility* tool would make the page under audit
unreachable by keyboard, which is absurd. The panel is a non-modal dialog you can tab out of;
<kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>A</kbd> brings it back.

**On-page markers are not keyboard focusable.** Making them focusable would add hundreds of
tab stops to the page being audited, wrecking the tab order the tool is meant to measure. The
panel's issue lists are the keyboard path, and every marker has a corresponding row there.

---

## Not in v1

Per the PRD: no auto-fixing, no screen-reader simulation, no accounts or saved history, and
no support for content the browser has not rendered. Cross-origin iframes are out of scope —
each frame is a separate document with its own scan lifecycle.
