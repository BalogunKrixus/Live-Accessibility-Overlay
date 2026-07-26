# Live Accessibility Overlay

A Chrome extension that shows accessibility problems **on the live page, in context** — not
in a report you read afterwards.

Four lenses: contrast, heading structure, alt text, and tab order. Everything is measured
locally in the tab. Nothing is uploaded, and the extension cannot read a page it was not
explicitly invited into.

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

### Aperture

The tool reads a page the way a light meter reads a scene — legibility and exposure, not
compliance policing. That idea drives the mark (a hexagonal iris), the palette, and the
language ("19 things to look at", not "19 violations").

### On-page markers

Issues are marked with **thin corner brackets** — crop marks, not boxes — with a small badge
hung off the top-left corner. The badge stays collapsed to a severity glyph until you hover
it, so a page with two hundred findings still reads as a page. A dual drop-shadow halo keeps
the brackets visible on any background, light or dark.

### Severity

Four hues, deliberately not a traffic light:

| | | |
|---|---|---|
| **Rose** | Critical | A hard failure — someone cannot use this |
| **Ochre** | Warning | It works, but it degrades for someone |
| **Iris** | Notice | Worth a look, not a defect |
| **Aqua** | Clear | The brand, and the all-clear |

Every severity is *also* a three-segment meter glyph (▮▮▮ / ▮▮▯ / ▮▯▯), so severity survives
colour blindness, greyscale printing, and the screenshots people actually share. Backward tab
jumps are dashed as well as ochre, for the same reason.

### The panel

Docked, not floating; 372px; light and dark following the system, with a manual override.
Two panes slide between overview and detail. The overview leads with the worst few findings
so the tool answers "what should I fix?" before you have opened anything.

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

Results are **grouped by colour pair**, because a page usually has a handful of broken
*decisions* repeated across hundreds of nodes. The suggested fix holds hue and saturation and
moves lightness only as far as it must, picking the perceptually nearest passing colour by
CIE Lab ΔE — and it will not suggest repainting the page canvas.

### Headings
Full outline including `role="heading"` with `aria-level`, flagging skipped levels, empty
headings, missing or duplicated `h1`, and headings hidden from view.

### Alt text
Distinguishes *decorative* from *meaningful*, which is the distinction that matters:
missing attribute vs. `alt=""`, filename-as-alt, placeholder alt, redundant "image of…"
phrasing, over-long alt, and — most importantly — images that are the sole content of a link
or button with no accessible name.

### Tab order
Derived by walking focusable elements and applying sequential-focus rules (positive `tabindex`
first in ascending order, then DOM order). Nothing requires you to press Tab. Flags positive
`tabindex`, backward jumps against reading order, and off-canvas controls still in the tab
order — the classic closed-drawer bug.

All four lenses descend into **open shadow roots**, so component-driven sites are actually
audited rather than silently under-reported.

---

## Privacy

- `activeTab`, `scripting`, `storage`. **No host permissions**, no static content scripts.
- Nothing is injected into any page until you click the icon or press the shortcut.
- No network calls of any kind. No analytics. Nothing persists but your theme, panel side,
  and which lenses are on.

---

## Its own accessibility

An inaccessible accessibility tool would be an embarrassment, so the panel is held to the
standard it measures:

- Full keyboard operation; <kbd>Esc</kbd> steps back from detail to overview, then closes.
- Real semantics: `role="dialog"`, `role="switch"` with `aria-checked`, real lists and
  buttons, `aria-expanded` on disclosures, a polite live region for scan results.
- The off-screen pane is `inert`, so it never takes focus or gets read out.
- One focus treatment everywhere; it never mutates an element's shape.
- `prefers-reduced-motion` removes motion — including the decorative flourishes — without
  removing the design. `forced-colors` hands control back to the system palette.
- **The palette is verified by the extension's own contrast engine**, in both themes, against
  every surface each token actually appears on. That check is part of the test suite, and it
  has already caught two tokens I had misjudged by eye.

The marker layer is `aria-hidden`: markers are pointer affordances over content already in
the accessibility tree, and every issue is reachable as a real control in the panel. Adding
several hundred duplicate buttons would bloat the very tree we ask authors to keep clean.

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
- **`test/harness.mjs`** (96 checks) — loads the runtime against two fixtures with
  known-answer issues. Asserts audit correctness *and* that the styling actually applied,
  the palette self-audit, reduced-motion behaviour, and performance on a heavy page
  (~900 findings over 2,700 nodes, scanning in under 200ms with markers virtualised).
- **`test/extension.mjs`** (19 checks) — loads the real unpacked extension in Chromium and
  drives the actual injection path: manifest, service worker, file order, message handshake,
  storage round-trip, and isolated-world separation.

`test/fixture-issues.html` contains deliberate, documented problems; `test/fixture-clean.html`
must report exactly zero.

---

## Judgment calls

The PRD left three questions open. These are the calls I made, and why.

**1. Severity tiers — fixed three-tier, or more granular?**
Three tiers (critical / warning / notice) for *categorisation*, with granularity carried
*within* a finding rather than by adding tiers. A contrast issue's tier is derived from how
far it is from passing — a 1.9:1 near-invisible failure is genuinely a different problem from
a 4.3:1 near-miss — and the exact ratio and shortfall are always shown. Three tiers keep the
page calm and the summary scannable; more tiers would have made the colour system muddy
without telling anyone more.

**2. How much detail in the hover tooltip?**
Hover shows one number and nothing else (`1.96:1 · needs 4.5`), revealed by expanding the
badge in place. Everything else — the colour pair, the suggested fix, the occurrence list —
lives in the panel. On-page popovers would cover the very layout being audited, which defeats
the point of an in-context tool. The badge is a collapsed severity glyph until hovered, so
the resting state of a busy page stays quiet.

**3. Draggable panel, or fixed?**
Docked to one side, with a control to flip left/right, and not free-dragging. Free-drag panels
get lost, overlap the content you are inspecting, and add a state nobody wants to manage.
Flipping sides solves the real problem (the panel covering the thing you are looking at)
without the cost. Panel side persists.

**Two further calls worth flagging, since they are genuinely arguable:**

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
