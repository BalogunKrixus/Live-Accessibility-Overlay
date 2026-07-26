/**
 * Loads the extension runtime into a fixture page with a stubbed chrome API,
 * asserts the audits found what the fixture deliberately contains, and captures
 * screenshots of every surface in both themes.
 *
 *   node test/harness.mjs [--shots]
 */
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = join(ROOT, 'test', 'shots');
const WANT_SHOTS = process.argv.includes('--shots');

const RUNTIME = [
  'src/core/util.js',
  'src/core/color.js',
  'src/audits/contrast.js',
  'src/audits/headings.js',
  'src/audits/images.js',
  'src/audits/taborder.js',
  'src/ui/styles.js',
  'src/ui/icons.js',
  'src/ui/copy.js',
  'src/ui/overlay.js',
  'src/ui/panel.js',
  'src/content/main.js',
];

const CHROME_STUB = `
  globalThis.chrome = {
    storage: { local: {
      _d: {},
      get(k) { return Promise.resolve({ [k]: this._d[k] }); },
      set(o) { Object.assign(this._d, o); return Promise.resolve(); },
    }},
    runtime: {
      sendMessage() {},
      onMessage: { addListener() {} },
      lastError: null,
    },
  };
`;

/* --------------------------------------------------------------- assertions */

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function loadRuntime(page, fixture) {
  await page.addInitScript(CHROME_STUB);
  await page.goto(pathToFileURL(join(ROOT, 'test', fixture)).href);
  for (const file of RUNTIME) {
    await page.addScriptTag({ content: readFileSync(join(ROOT, file), 'utf8') });
  }
  await page.waitForFunction(() => globalThis.__LAO__?.app?.results, null, { timeout: 8000 });
  await page.waitForTimeout(400);
}

/** Serialisable view of the scan, for assertions. */
const summarise = () => {
  const r = globalThis.__LAO__.app.results;
  const strip = (i) => ({
    lens: i.lens, severity: i.severity, title: i.title, kind: i.kind,
    ratio: i.ratio, required: i.required, unmeasurable: i.unmeasurable,
    fgHex: i.fgHex, bgHex: i.bgHex,
    tag: i.element?.tagName?.toLowerCase(),
    cls: typeof i.element?.className === 'string' ? i.element.className : '',
    text: i.text,
  });
  return {
    contrast: { issues: r.contrast.issues.map(strip), scanned: r.contrast.scanned, groups: r.contrast.groups.length },
    headings: {
      issues: r.headings.issues.map((h) => ({ name: h.name, level: h.level, codes: h.problems.map((p) => p.code) })),
      outline: r.headings.outline.map((h) => ({ level: h.level, name: h.name, implicit: h.implicit })),
      scanned: r.headings.scanned,
    },
    images: { issues: r.images.issues.map(strip), scanned: r.images.scanned, passes: r.images.passes.length },
    tabs: {
      issues: r.tabs.issues.map((i) => ({ severity: i.severity, title: i.title })),
      steps: r.tabs.steps.map((s) => ({ index: s.index, name: s.name, label: s.label, backward: !!s.backward, offCanvas: !!s.offCanvas })),
      scanned: r.tabs.scanned,
    },
  };
};

/* -------------------------------------------------------------------- run */

// /opt/pw-browsers/chromium is a symlink to the binary itself.
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 1440, height: 940 }, deviceScaleFactor: 2 });
const page = await context.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('  [page error]', m.text()); });
page.on('pageerror', (e) => console.log('  [page exception]', e.message));

console.log('\n── Fixture with known problems ──────────────────────────────');
await loadRuntime(page, 'fixture-issues.html');
const s = await page.evaluate(summarise);

/* Contrast ---------------------------------------------------------------- */
const byClass = (cls) => s.contrast.issues.filter((i) => (i.cls || '').includes(cls));

check('contrast: flags the ~1.9:1 paragraph', byClass('fail-hard').length === 1,
  JSON.stringify(byClass('fail-hard')[0]?.ratio?.toFixed(2)));
check('contrast: flags the ~2.8:1 paragraph', byClass('fail-mid').length === 1,
  byClass('fail-mid')[0]?.ratio?.toFixed(2));
check('contrast: flags the ~3.5:1 paragraph', byClass('fail-slight').length === 1,
  byClass('fail-slight')[0]?.ratio?.toFixed(2));
check('contrast: does NOT flag the passing 4.5:1 paragraph', byClass('fail-near').length === 0);
check('contrast: does NOT flag 26px large text at 3:1+', byClass('large-ok').length === 0,
  'large-text threshold applied');
check('contrast: does NOT flag sr-only text', byClass('sr-only').length === 0,
  'visually-hidden text excluded');
check('contrast: reports gradient background as unmeasurable',
  s.contrast.issues.some((i) => i.unmeasurable === 'gradient'));
check('contrast: resolves nested background colour (#2f6f75 panel)',
  s.contrast.issues.some((i) => i.bgHex === '#2F6F75'),
  s.contrast.issues.find((i) => i.bgHex === '#2F6F75')?.ratio?.toFixed(2));
check('contrast: composites translucent text over its backdrop',
  byClass('translucent').length === 1,
  byClass('translucent')[0]?.fgHex);
check('contrast: groups issues by colour pair', s.contrast.groups < s.contrast.issues.length,
  `${s.contrast.issues.length} issues in ${s.contrast.groups} groups`);

/* Headings ---------------------------------------------------------------- */
const hCodes = s.headings.issues.flatMap((h) => h.codes);
check('headings: detects the H1 -> H4 skip', hCodes.includes('skip'));
check('headings: detects the empty heading', hCodes.includes('empty'));
check('headings: picks up role="heading" with aria-level',
  s.headings.outline.some((h) => h.implicit && h.level === 3));
check('headings: outline is in document order',
  s.headings.outline[0]?.level === 1 && s.headings.outline[0]?.name.startsWith('Quarterly'));

/* Images ------------------------------------------------------------------ */
const kinds = s.images.issues.map((i) => i.kind);
check('images: flags the image with no alt attribute', kinds.includes('missing'));
check('images: flags filename-as-alt', kinds.includes('placeholder'));
check('images: flags "image of ..." phrasing', kinds.includes('redundant'));
check('images: flags a linked image marked decorative', kinds.includes('decorative-in-control'));
check('images: does NOT flag a properly described image',
  s.images.passes >= 1, `${s.images.passes} passing`);

/* Tab order --------------------------------------------------------------- */
check('tabs: warns about positive tabindex',
  s.tabs.issues.some((i) => /positive tabindex/i.test(i.title)));
check('tabs: positive tabindex is ordered first',
  s.tabs.steps[0]?.name?.includes('Pulled forward'),
  s.tabs.steps[0]?.name);
check('tabs: flags the off-canvas focusable control',
  s.tabs.steps.some((x) => x.offCanvas) && s.tabs.issues.some((i) => /off-screen/i.test(i.title)));
check('tabs: excludes the disabled button',
  !s.tabs.steps.some((x) => /Disabled/i.test(x.name || '')));
check('tabs: detects a backwards jump', s.tabs.steps.some((x) => x.backward));

/* Isolation --------------------------------------------------------------- */
const isolation = await page.evaluate(() => {
  const host = document.querySelector('live-accessibility-overlay');
  return {
    hasShadow: !!host?.shadowRoot,
    styleTagsInPage: document.querySelectorAll('head style[data-lao], body > style').length,
    scannedSelf: globalThis.__LAO__.app.results.contrast.issues.some((i) =>
      i.element?.closest?.('live-accessibility-overlay')),
    panelInShadow: !!host?.shadowRoot?.querySelector('.lao-panel'),
  };
});
check('isolation: panel lives in a shadow root', isolation.hasShadow && isolation.panelInShadow);
check('isolation: the tool never audits its own UI', isolation.scannedSelf === false);

/* Styling actually applied ------------------------------------------------ */

// The stylesheet is a JS template literal, so a stray backtick silently drops
// every rule while the DOM assertions above still pass. Prove it landed.
const styling = await page.evaluate(() => {
  const host = document.querySelector('live-accessibility-overlay');
  const sr = host.shadowRoot;
  const panel = sr.querySelector('.lao-panel');
  const sheet = sr.adoptedStyleSheets?.[0];
  const dot = sr.querySelector('.lao-dot[data-tier="fix"]');
  return {
    ruleCount: sheet ? sheet.cssRules.length : 0,
    panelWidth: Math.round(panel.getBoundingClientRect().width),
    rowWidth: Math.round(sr.querySelector('.lao-item').getBoundingClientRect().width),
    dotBg: dot ? getComputedStyle(dot).backgroundColor : null,
    heroSize: parseFloat(getComputedStyle(sr.querySelector('.lao-hero-big')).fontSize),
  };
});
check('styling: stylesheet parsed into rules', styling.ruleCount > 60, `${styling.ruleCount} rules`);
check('styling: panel is the docked width, not full-bleed',
  styling.panelWidth === 372, `${styling.panelWidth}px`);
check('styling: issue rows fit inside the panel',
  styling.rowWidth > 0 && styling.rowWidth <= styling.panelWidth,
  `${styling.rowWidth}px in ${styling.panelWidth}px`);
check('styling: severity dot is coloured', styling.dotBg === 'rgb(194, 47, 74)', styling.dotBg);
check('styling: headline is set at display size', styling.heroSize >= 24, `${styling.heroSize}px`);

/* Simplicity of the surface ------------------------------------------------ */

// The point of the redesign: someone who has never read a WCAG document should
// be able to use this. Guard the properties that make that true, because they
// are exactly the ones that erode as features get added.
const surface = await page.evaluate(() => {
  const sr = document.querySelector('live-accessibility-overlay').shadowRoot;
  const home = sr.querySelector('.lao-view--home');
  const text = home.textContent;
  const controls = [...home.querySelectorAll('button')];
  // Length of the findings list is data, not complexity. What matters is that
  // there is nothing to *configure* — no toggles, no filters, no settings.
  const nonNavigation = controls.filter((b) => !b.classList.contains('lao-item'));
  return {
    controlCount: controls.length,
    configControls: nonNavigation.length,
    inputs: home.querySelectorAll('input, select, [role="switch"], [role="tab"]').length,
    jargon: ['tabindex', 'WCAG', 'aria-', ':1', 'contrast ratio', 'alt attribute', 'DOM']
      .filter((t) => text.toLowerCase().includes(t.toLowerCase())),
    hasToggles: sr.querySelectorAll('[role="switch"]').length,
    titles: [...home.querySelectorAll('.lao-item-title')].map((n) => n.textContent),
  };
});
check('simplicity: no jargon on the overview screen',
  surface.jargon.length === 0, surface.jargon.join(', ') || 'none found');
check('simplicity: no lens toggles to configure', surface.hasToggles === 0);
check('simplicity: overview is a list, not a control panel',
  surface.configControls === 0 && surface.inputs === 0,
  `${surface.controlCount} rows, ${surface.configControls} settings`);
/* Coverage strip -------------------------------------------------------- */
const coverage = await page.evaluate(() => {
  const sr = document.querySelector('live-accessibility-overlay').shadowRoot;
  const block = sr.querySelector('.lao-view--home .lao-coverage');
  const r = globalThis.__LAO__.app.results;
  return {
    present: !!block,
    label: block?.querySelector('.lao-coverage-label')?.textContent,
    text: block?.querySelector('.lao-coverage-line')?.textContent,
    expected: [r.contrast.scanned, r.images.scanned, r.headings.scanned, r.tabs.scanned],
    // It must sit at the very bottom of the overview, below everything else.
    isLastChild: block === sr.querySelector('.lao-view--home').lastElementChild,
  };
});
check('coverage: "Checked on this page" is shown', coverage.present && coverage.label === 'Checked on this page');
check('coverage: it sits at the foot of the overview', coverage.isLastChild);
check('coverage: it reports what was actually scanned',
  coverage.expected.every((n) => new RegExp(`\\b${n}\\b`).test(coverage.text || '')),
  coverage.text);

check('simplicity: issue titles are plain sentences',
  surface.titles.every((t) => /^[A-Z]/.test(t) && !/\d+(\.\d+)?:1/.test(t)),
  surface.titles[0]);

/* One thing at a time ------------------------------------------------------ */

const marking = await page.evaluate(async () => {
  const app = globalThis.__LAO__.app;
  const sr = app.shadow;
  const atRest = sr.querySelectorAll('.lao-mk').length;

  app.panel.showIssue(0);
  await new Promise((r) => setTimeout(r, 250));
  const afterSelect = sr.querySelectorAll('.lao-mk').length;
  const caption = sr.querySelector('.lao-mk-badge')?.textContent;

  app.panel.step(1);
  await new Promise((r) => setTimeout(r, 250));
  const afterStep = sr.querySelectorAll('.lao-mk').length;

  app.panel.showHome();
  await new Promise((r) => setTimeout(r, 250));
  const afterBack = sr.querySelectorAll('.lao-mk').length;

  return { atRest, afterSelect, afterStep, afterBack, caption, total: app.panel.state.items.length };
});
check('one at a time: nothing is marked before you choose', marking.atRest === 0);
check('one at a time: choosing an issue marks exactly one element',
  marking.afterSelect === 1, `${marking.afterSelect} marks`);
check('one at a time: stepping to the next issue still marks only one',
  marking.afterStep === 1, `${marking.afterStep} marks`);
check('one at a time: going back clears the page', marking.afterBack === 0);
check('one at a time: the mark is captioned in plain words',
  !!marking.caption && !/:1/.test(marking.caption), marking.caption);

/* Panel accessibility ----------------------------------------------------- */
const a11y = await page.evaluate(() => {
  const sr = document.querySelector('live-accessibility-overlay').shadowRoot;
  const panel = sr.querySelector('.lao-panel');
  const buttons = [...sr.querySelectorAll('button')];
  return {
    role: panel.getAttribute('role'),
    label: panel.getAttribute('aria-label'),
    buttonsAllLabelled: buttons.every(
      (b) => (b.textContent || '').trim() || b.getAttribute('aria-label') || b.getAttribute('title'),
    ),
    liveRegion: !!sr.querySelector('[aria-live="polite"]'),
    inertOffscreenPane: sr.querySelectorAll('.lao-view[inert]').length === 1,
    markersHiddenFromAT: sr.querySelector('.lao-layer')?.getAttribute('aria-hidden') === 'true',
    // Native <details> carries its own expanded semantics.
    techIsDetails: !!sr.querySelector('details.lao-tech'),
  };
});
check('panel a11y: dialog role and accessible name', a11y.role === 'dialog' && !!a11y.label);
check('panel a11y: every button has an accessible name', a11y.buttonsAllLabelled);
check('panel a11y: has a polite live region', a11y.liveRegion);
check('panel a11y: off-screen pane is inert', a11y.inertOffscreenPane);
check('panel a11y: decorative marker layer hidden from AT', a11y.markersHiddenFromAT);

/* Technical detail is available but out of the way ------------------------- */
const tech = await page.evaluate(async () => {
  const app = globalThis.__LAO__.app;
  const sr = app.shadow;
  // Pick a contrast issue: it is the one with numbers worth hiding.
  const idx = app.panel.state.items.findIndex((i) => i.category === 'contrast');
  app.panel.showIssue(idx);
  await new Promise((r) => setTimeout(r, 200));

  const details = sr.querySelector('details.lao-tech');
  // textContent sees inside a closed <details>, so ask the element itself.
  const startsClosed = !details.open;
  const summary = details.querySelector('summary').textContent.trim();

  details.open = true;
  details.dispatchEvent(new Event('toggle'));
  await new Promise((r) => setTimeout(r, 60));
  const lines = [...details.querySelectorAll('li')].map((l) => l.textContent);

  // Sticky across issues: a developer opens it once, not on every issue.
  app.panel.step(1);
  await new Promise((r) => setTimeout(r, 200));
  const stillOpen = sr.querySelector('details.lao-tech').open;
  app.panel.showHome();
  return { startsClosed, summary, lines, stillOpen };
});
check('technical details: hidden until asked for',
  tech.startsClosed && tech.summary === 'Technical details', tech.summary);
check('technical details: contain the numbers and the rule',
  tech.lines.some((l) => /:1/.test(l)) && tech.lines.some((l) => /WCAG/.test(l)),
  tech.lines[0]);
check('technical details: stay open once opened', tech.stillOpen);

/* Keyboard ---------------------------------------------------------------- */
const keyboard = await page.evaluate(async () => {
  const app = globalThis.__LAO__.app;
  const sr = app.shadow;
  app.panel.showIssue(0);
  await new Promise((r) => setTimeout(r, 80));
  const inDetail = app.host.dataset.view === 'detail';
  const homeInert = sr.querySelector('.lao-view--home').hasAttribute('inert');
  app.panel.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await new Promise((r) => setTimeout(r, 80));
  return { inDetail, homeInert, backHome: app.host.dataset.view === 'home' };
});
check('keyboard: opening an issue inerts the overview pane',
  keyboard.inDetail && keyboard.homeInert);
check('keyboard: Escape steps back to the overview', keyboard.backHome);

/* The keyboard path is opt-in --------------------------------------------- */
const optIn = await page.evaluate(async () => {
  const app = globalThis.__LAO__.app;
  const sr = app.shadow;
  const before = sr.querySelectorAll('.lao-node').length;
  app.panel.showKeyboard();
  await new Promise((r) => setTimeout(r, 250));
  const after = sr.querySelectorAll('.lao-node').length;
  app.panel.showHome();
  app.overlay.setTabPath(false);
  await new Promise((r) => setTimeout(r, 150));
  return { before, after, cleared: sr.querySelectorAll('.lao-node').length };
});
check('keyboard path: not drawn until explicitly opened', optIn.before === 0);
check('keyboard path: drawn in full once opened', optIn.after > 3, `${optIn.after} stops`);
check('keyboard path: removed on leaving', optIn.cleared === 0);

/* The tool audits itself ---------------------------------------------------- */

// An accessibility tool with a failing palette would be an embarrassment, so
// the panel's own colours are measured with the same engine it measures pages
// with — in both themes, against every surface each token is used on.
for (const theme of ['light', 'dark']) {
  await page.evaluate((t) => {
    globalThis.__LAO__.app.prefs.theme = t;
    globalThis.__LAO__.app._applyPrefs();
  }, theme);
  await page.waitForTimeout(120);

  const palette = await page.evaluate(() => {
    const c = globalThis.__LAO__.color;
    const host = document.querySelector('live-accessibility-overlay');
    const cs = getComputedStyle(host);
    const v = (name) => c.parse(cs.getPropertyValue(name).trim());
    const ratio = (fg, bg) => c.contrast(c.over(fg, bg), bg);

    const surface = v('--lao-surface');
    const sunken = v('--lao-surface-sunken');
    const hover = v('--lao-surface-hover');
    const active = v('--lao-surface-active');

    const out = {};
    // Body-weight text: must clear 4.5:1.
    for (const [name, fg, bg] of [
      ['text on surface', v('--lao-text'), surface],
      ['text-muted on surface', v('--lao-text-muted'), surface],
      ['text-faint on surface', v('--lao-text-faint'), surface],
      ['text-faint on sunken', v('--lao-text-faint'), sunken],
      ['text-faint on hover', v('--lao-text-faint'), hover],
      ['text-faint on active', v('--lao-text-faint'), active],
      ['text-muted on active', v('--lao-text-muted'), active],
      ['text-muted on hover', v('--lao-text-muted'), hover],
      ['brand on surface', v('--lao-brand'), surface],
      ['critical on surface', v('--lao-critical'), surface],
      ['warning on surface', v('--lao-warning'), surface],
      ['notice on surface', v('--lao-notice'), surface],
      ['critical on its wash', v('--lao-critical'), v('--lao-critical-wash')],
      ['warning on its wash', v('--lao-warning'), v('--lao-warning-wash')],
      ['notice on its wash', v('--lao-notice'), v('--lao-notice-wash')],
      ['brand on its wash', v('--lao-brand'), v('--lao-brand-wash')],
      ['primary button label', v('--lao-focus-contrast'), v('--lao-brand')],
    ]) out[name] = ratio(fg, bg);

    // Non-text: focus ring and severity meters need 3:1 (WCAG 1.4.11).
    const nonText = {
      'focus ring on surface': ratio(v('--lao-focus'), surface),
      'focus ring on sunken': ratio(v('--lao-focus'), sunken),
    };
    return { text: out, nonText };
  });

  for (const [name, r] of Object.entries(palette.text)) {
    check(`palette (${theme}): ${name} clears 4.5:1`, r >= 4.5, `${r.toFixed(2)}:1`);
  }
  for (const [name, r] of Object.entries(palette.nonText)) {
    check(`palette (${theme}): ${name} clears 3:1`, r >= 3, `${r.toFixed(2)}:1`);
  }
}
await page.evaluate(() => {
  globalThis.__LAO__.app.prefs.theme = 'system';
  globalThis.__LAO__.app._applyPrefs();
});

/* Contrast maths ---------------------------------------------------------- */
const maths = await page.evaluate(() => {
  const c = globalThis.__LAO__.color;
  const white = { r: 255, g: 255, b: 255 };
  const black = { r: 0, g: 0, b: 0 };
  const mid = c.parse('#767676');
  const fix = c.suggestFix(c.parse('#949494'), white, 4.5);
  return {
    blackWhite: c.contrast(black, white),
    same: c.contrast(white, white),
    known767676: c.contrast(mid, white),
    largeThreshold: c.threshold(24, 400).aa,
    boldLargeThreshold: c.threshold(19, 700).aa,
    bodyThreshold: c.threshold(16, 400).aa,
    fixRatio: fix.text?.ratio,
    fixPasses: fix.text ? fix.text.ratio >= 4.5 : false,
    fixHex: fix.text ? c.toHex(fix.text.color) : null,
  };
});
check('maths: black on white is 21:1', Math.abs(maths.blackWhite - 21) < 0.001);
check('maths: identical colours are 1:1', Math.abs(maths.same - 1) < 0.001);
check('maths: #767676 on white is the canonical 4.54:1',
  Math.abs(maths.known767676 - 4.54) < 0.02, maths.known767676.toFixed(3));
check('maths: large-text threshold is 3:1 at 24px', maths.largeThreshold === 3);
check('maths: 19px bold counts as large text', maths.boldLargeThreshold === 3);
check('maths: body threshold is 4.5:1', maths.bodyThreshold === 4.5);
check('maths: suggested fix actually reaches the target',
  maths.fixPasses, `${maths.fixHex} at ${maths.fixRatio?.toFixed(2)}:1`);

/* ------------------------------------------------------------- screenshots */

if (WANT_SHOTS) {
  mkdirSync(SHOTS, { recursive: true });
  const panelClip = () => page.evaluate(() => {
    const p = document.querySelector('live-accessibility-overlay').shadowRoot.querySelector('.lao-panel');
    const r = p.getBoundingClientRect();
    return { x: r.left - 24, y: r.top - 24, width: r.width + 48, height: r.height + 48 };
  });
  const shoot = async (name, opts = {}) => {
    await page.screenshot({ path: join(SHOTS, `${name}.png`), ...opts });
    console.log(`  shot  ${name}.png`);
  };
  const idxOf = (category) => page.evaluate((c) =>
    globalThis.__LAO__.app.panel.state.items.findIndex((i) => i.category === c), category);

  await page.evaluate(() => {
    const app = globalThis.__LAO__.app;
    app.panel.state.techOpen = false; // Earlier assertions opened it; shots show the default.
    app.panel.showHome();
    scrollTo(0, 0);
  });
  await page.waitForTimeout(500);
  await shoot('01-overview-light', { clip: await panelClip() });

  // Scrolled to the foot of the overview, where the coverage strip sits.
  await page.evaluate(() => {
    const v = globalThis.__LAO__.app.shadow.querySelector('.lao-view--home');
    v.scrollTop = v.scrollHeight;
  });
  await page.waitForTimeout(300);
  await shoot('01b-overview-bottom-light', { clip: await panelClip() });
  await page.evaluate(() => {
    globalThis.__LAO__.app.shadow.querySelector('.lao-view--home').scrollTop = 0;
  });

  // A contrast issue: the colour swap and the "where it happens" stepper.
  await page.evaluate((i) => globalThis.__LAO__.app.panel.showIssue(i), await idxOf('contrast'));
  await page.waitForTimeout(600);
  await shoot('02-issue-light', { clip: await panelClip() });
  await shoot('03-single-mark-on-page');

  // The same issue with the technical details opened.
  await page.evaluate(() => {
    const d = globalThis.__LAO__.app.shadow.querySelector('details.lao-tech');
    d.open = true;
    d.dispatchEvent(new Event('toggle'));
  });
  await page.waitForTimeout(350);
  await shoot('04-issue-technical-light', { clip: await panelClip() });
  await page.evaluate(() => {
    const d = globalThis.__LAO__.app.shadow.querySelector('details.lao-tech');
    d.open = false;
    d.dispatchEvent(new Event('toggle'));
  });

  // An image issue, to show a different evidence treatment.
  await page.evaluate((i) => globalThis.__LAO__.app.panel.showIssue(i), await idxOf('images'));
  await page.waitForTimeout(500);
  await shoot('05-issue-image-light', { clip: await panelClip() });

  await page.evaluate(() => globalThis.__LAO__.app.panel.showOutline());
  await page.waitForTimeout(500);
  await shoot('06-page-outline-light', { clip: await panelClip() });

  await page.evaluate(() => {
    globalThis.__LAO__.app.panel.showKeyboard();
    document.querySelector('nav')?.scrollIntoView({ block: 'center' });
  });
  await page.waitForTimeout(700);
  await shoot('07-keyboard-path-light');

  // Dark mode.
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.evaluate(() => {
    const app = globalThis.__LAO__.app;
    app.overlay.setTabPath(false);
    app.panel.showHome();
    scrollTo(0, 0);
  });
  await page.waitForTimeout(500);
  await shoot('08-overview-dark', { clip: await panelClip() });
  await page.evaluate((i) => globalThis.__LAO__.app.panel.showIssue(i), await idxOf('contrast'));
  await page.waitForTimeout(600);
  await shoot('09-issue-dark', { clip: await panelClip() });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.evaluate(() => globalThis.__LAO__.app.panel.showHome());
}

/* ------------------------------------------------------- clean fixture */

console.log('\n── Fixture with nothing to flag ─────────────────────────────');
const page2 = await context.newPage();
page2.on('pageerror', (e) => console.log('  [page exception]', e.message));
await page2.addInitScript(CHROME_STUB);
await page2.goto(pathToFileURL(join(ROOT, 'test', 'fixture-clean.html')).href);
for (const file of RUNTIME) {
  await page2.addScriptTag({ content: readFileSync(join(ROOT, file), 'utf8') });
}
await page2.waitForFunction(() => globalThis.__LAO__?.app?.results, null, { timeout: 8000 });
await page2.waitForTimeout(400);

const clean = await page2.evaluate(() => {
  const r = globalThis.__LAO__.app.results;
  const sr = globalThis.__LAO__.app.shadow;
  return {
    total:
      r.contrast.issues.length + r.headings.issues.length +
      r.images.issues.length + r.tabs.issues.length,
    detail: {
      contrast: r.contrast.issues.map((i) => `${i.fgHex}/${i.bgHex} ${i.ratio?.toFixed(2)}`),
      headings: r.headings.issues.map((h) => h.name),
      images: r.images.issues.map((i) => i.title),
      tabs: r.tabs.issues.map((i) => i.title),
    },
    hasAllClear: !!sr.querySelector('.lao-clear'),
    markers: sr.querySelectorAll('.lao-mk').length,
    headline: sr.querySelector('.lao-clear-title')?.textContent,
    coverage: sr.querySelector('.lao-coverage-line')?.textContent,
    ...(() => {
      const home = sr.querySelector('.lao-view--home');
      const strip = sr.querySelector('.lao-coverage');
      const gap = Math.round(home.getBoundingClientRect().bottom - strip.getBoundingClientRect().bottom);
      return { coverageGap: gap, coverageAtFoot: gap < 40 };
    })(),
  };
});
check('clean page: reports zero issues', clean.total === 0, JSON.stringify(clean.detail));
check('clean page: shows the all-clear state', clean.hasAllClear);
check('clean page: draws no markers', clean.markers === 0);
check('clean page: says so in plain words', clean.headline === 'Nothing to fix', clean.headline);
check('clean page: still reports what was checked',
  !!clean.coverage && /pieces of text/.test(clean.coverage), clean.coverage);
// margin-top:auto silently computes to 0 if the column ever stops being a flex
// container, which parks the strip under the content instead of at the foot.
check('clean page: the coverage strip is pushed to the foot of the panel',
  clean.coverageAtFoot, `${clean.coverageGap}px from the bottom`);

if (WANT_SHOTS) {
  await page2.waitForTimeout(600);
  const box = await page2.evaluate(() => {
    const p = document.querySelector('live-accessibility-overlay').shadowRoot.querySelector('.lao-panel');
    const r = p.getBoundingClientRect();
    return { x: r.left - 24, y: r.top - 24, width: r.width + 48, height: r.height + 48 };
  });
  await page2.screenshot({ path: join(SHOTS, '10-allclear-light.png'), clip: box });
  console.log('  shot  10-allclear-light.png');
  await page2.emulateMedia({ colorScheme: 'dark' });
  await page2.waitForTimeout(400);
  await page2.screenshot({ path: join(SHOTS, '11-allclear-dark.png'), clip: box });
  console.log('  shot  11-allclear-dark.png');
}

/* ------------------------------------------------------- reduced motion */

console.log('\n── prefers-reduced-motion: reduce ───────────────────────────');
const rmContext = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  reducedMotion: 'reduce',
});
const rmPage = await rmContext.newPage();
rmPage.on('pageerror', (e) => console.log('  [page exception]', e.message));
await rmPage.addInitScript(CHROME_STUB);
await rmPage.goto(pathToFileURL(join(ROOT, 'test', 'fixture-clean.html')).href);
for (const file of RUNTIME) {
  await rmPage.addScriptTag({ content: readFileSync(join(ROOT, file), 'utf8') });
}
await rmPage.waitForFunction(() => globalThis.__LAO__?.app?.results, null, { timeout: 8000 });
await rmPage.waitForTimeout(400);

const motion = await rmPage.evaluate(() => {
  const sr = globalThis.__LAO__.app.shadow;
  const ms = (v) => parseFloat(v) * (v.includes('ms') ? 1 : 1000);
  const panel = sr.querySelector('.lao-panel');
  const mark = sr.querySelector('.lao-clear-mark');
  const row = sr.querySelector('.lao-item');
  return {
    panelTransition: ms(getComputedStyle(panel).transitionDuration.split(',')[0]),
    lensTransition: ms(getComputedStyle(row).transitionDuration.split(',')[0]),
    ringAnimation: getComputedStyle(mark, '::before').animationName,
    // The decorative ring must still be *visible*, just not animated — removing
    // motion should not remove the design.
    ringOpacity: parseFloat(getComputedStyle(mark, '::before').opacity),
  };
});
check('reduced motion: panel transition is effectively instant',
  motion.panelTransition <= 1, `${motion.panelTransition}ms`);
check('reduced motion: hover transitions are instant',
  motion.lensTransition <= 1, `${motion.lensTransition}ms`);
check('reduced motion: decorative ring animation is disabled',
  motion.ringAnimation === 'none', motion.ringAnimation);
check('reduced motion: the ring is still rendered, not just removed',
  motion.ringOpacity > 0.5, `opacity ${motion.ringOpacity}`);

/* ------------------------------------------------------- load and robustness */

console.log('\n── Heavy page ───────────────────────────────────────────────');
const bigPage = await context.newPage();
bigPage.on('pageerror', (e) => console.log('  [page exception]', e.message));
await bigPage.addInitScript(CHROME_STUB);
await bigPage.goto('about:blank');
// A deliberately awkward page: deep nesting, a web component with an open
// shadow root, thousands of text nodes, and translucent stacked backgrounds.
await bigPage.evaluate(() => {
  document.body.style.cssText = 'margin:0;font:14px system-ui;background:#fff';
  const frag = document.createDocumentFragment();
  for (let i = 0; i < 900; i++) {
    const row = document.createElement('div');
    row.style.cssText = `background: rgba(0,0,0,0.02); color:#8c8c8c; padding:2px 8px`;
    row.textContent = `Row ${i} with text that fails contrast against the page.`;
    const img = document.createElement('img');
    img.width = 20; img.height = 20;
    img.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
    row.appendChild(img);
    const btn = document.createElement('button');
    btn.textContent = `Action ${i}`;
    row.appendChild(btn);
    frag.appendChild(row);
  }
  document.body.appendChild(frag);

  class LaoTestCard extends HTMLElement {
    connectedCallback() {
      const sr = this.attachShadow({ mode: 'open' });
      sr.innerHTML =
        '<h3 style="color:#b0b0b0;background:#fff">Heading inside a shadow root</h3>' +
        '<img width="30" height="30" alt="">' +
        '<a href="#x"><img width="30" height="30"></a>';
    }
  }
  customElements.define('lao-test-card', LaoTestCard);
  document.body.appendChild(document.createElement('lao-test-card'));
});
for (const file of RUNTIME) {
  await bigPage.addScriptTag({ content: readFileSync(join(ROOT, file), 'utf8') });
}
await bigPage.waitForFunction(() => globalThis.__LAO__?.app?.results, null, { timeout: 30000 });
await bigPage.waitForTimeout(600);

const heavy = await bigPage.evaluate(() => {
  const app = globalThis.__LAO__.app;
  const sr = app.shadow;
  return {
    duration: app.duration,
    contrast: app.results.contrast.issues.length,
    groups: app.results.contrast.groups.length,
    // Shadow-root content must be audited, not silently skipped.
    shadowHeading: app.results.contrast.issues.some(
      (i) => i.element?.getRootNode?.() !== document,
    ),
    shadowLink: app.results.images.issues.some(
      (i) => i.element?.getRootNode?.() !== document,
    ),
    renderedMarkers: sr.querySelectorAll('.lao-mk').length,
    plainItems: globalThis.__LAO__.copy.build(app.results).length,
    domNodes: document.querySelectorAll('*').length,
  };
});
check('heavy page: scan completes in a reasonable time',
  heavy.duration < 5000, `${heavy.duration}ms over ${heavy.domNodes} nodes`);
check('heavy page: finds the repeated contrast failure',
  heavy.contrast > 800, `${heavy.contrast} issues`);
check('heavy page: collapses them into few colour-pair groups',
  heavy.groups <= 5, `${heavy.groups} groups`);
check('heavy page: audits inside open shadow roots',
  heavy.shadowHeading && heavy.shadowLink);
check('heavy page: the page is left unmarked, however many findings there are',
  heavy.renderedMarkers === 0, `${heavy.renderedMarkers} marks for ${heavy.contrast} findings`);
check('heavy page: 900 findings collapse to a short, readable list',
  heavy.plainItems <= 12, `${heavy.plainItems} items in the panel`);

await browser.close();

/* ------------------------------------------------------------------ report */

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('\nFailures:');
  for (const f of failed) console.log(`  · ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
  process.exit(1);
}
