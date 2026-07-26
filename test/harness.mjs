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
  const seg = sr.querySelector('.lao-bar i[data-sev="critical"]');
  const marker = sr.querySelector('.lao-mk');
  return {
    ruleCount: sheet ? sheet.cssRules.length : 0,
    panelWidth: Math.round(panel.getBoundingClientRect().width),
    viewportWidth: innerWidth,
    rowWidth: Math.round(sr.querySelector('.lao-lens').getBoundingClientRect().width),
    segBg: seg ? getComputedStyle(seg).backgroundColor : null,
    segWidth: seg ? Math.round(seg.getBoundingClientRect().width) : 0,
    markerTransform: marker ? getComputedStyle(marker).transform : null,
  };
});
check('styling: stylesheet parsed into rules', styling.ruleCount > 60, `${styling.ruleCount} rules`);
check('styling: panel is the docked width, not full-bleed',
  styling.panelWidth === 372, `${styling.panelWidth}px`);
check('styling: lens rows fit inside the panel',
  styling.rowWidth > 0 && styling.rowWidth <= styling.panelWidth,
  `${styling.rowWidth}px in ${styling.panelWidth}px`);
check('styling: severity bar segments are coloured and sized',
  styling.segBg === 'rgb(194, 47, 74)' && styling.segWidth > 0,
  `${styling.segBg} @ ${styling.segWidth}px`);
check('styling: marker keeps its positioning transform',
  !!styling.markerTransform && styling.markerTransform !== 'none' &&
  !/matrix\(1, 0, 0, 1, 0, 0\)/.test(styling.markerTransform),
  styling.markerTransform);

/* Panel accessibility ----------------------------------------------------- */
const a11y = await page.evaluate(() => {
  const sr = document.querySelector('live-accessibility-overlay').shadowRoot;
  const panel = sr.querySelector('.lao-panel');
  const switches = [...sr.querySelectorAll('[role="switch"]')];
  const buttons = [...sr.querySelectorAll('button')];
  return {
    role: panel.getAttribute('role'),
    label: panel.getAttribute('aria-label'),
    switchCount: switches.length,
    switchesHaveChecked: switches.every((b) => b.hasAttribute('aria-checked')),
    switchesHaveLabel: switches.every((b) => b.getAttribute('aria-label')),
    buttonsAllLabelled: buttons.every(
      (b) => (b.textContent || '').trim() || b.getAttribute('aria-label') || b.getAttribute('title'),
    ),
    liveRegion: !!sr.querySelector('[aria-live="polite"]'),
    inertOffscreenPane: sr.querySelectorAll('.lao-view[inert]').length === 1,
    markersHiddenFromAT: sr.querySelector('.lao-layer')?.getAttribute('aria-hidden') === 'true',
  };
});
check('panel a11y: dialog role and accessible name',
  a11y.role === 'dialog' && !!a11y.label);
check('panel a11y: switches expose aria-checked and a label',
  a11y.switchCount === 4 && a11y.switchesHaveChecked && a11y.switchesHaveLabel);
check('panel a11y: every button has an accessible name', a11y.buttonsAllLabelled);
check('panel a11y: has a polite live region', a11y.liveRegion);
check('panel a11y: off-screen pane is inert', a11y.inertOffscreenPane);
check('panel a11y: decorative marker layer hidden from AT', a11y.markersHiddenFromAT);

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

/* Keyboard ---------------------------------------------------------------- */
const keyboard = await page.evaluate(async () => {
  const app = globalThis.__LAO__.app;
  const sr = app.shadow;
  app.panel.showDetail('contrast');
  await new Promise((r) => setTimeout(r, 60));
  const inDetail = app.host.dataset.view === 'detail';
  const homeInert = sr.querySelector('.lao-view').hasAttribute('inert');
  app.panel.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
  const backHome = app.host.dataset.view === 'home';
  return { inDetail, homeInert, backHome };
});
check('keyboard: opening detail inerts the overview pane',
  keyboard.inDetail && keyboard.homeInert);
check('keyboard: Escape steps back from detail to overview', keyboard.backHome);

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
  const panelClip = async () => {
    const box = await page.evaluate(() => {
      const p = document.querySelector('live-accessibility-overlay').shadowRoot.querySelector('.lao-panel');
      const r = p.getBoundingClientRect();
      return { x: r.left - 24, y: r.top - 24, width: r.width + 48, height: r.height + 48 };
    });
    return box;
  };

  const shoot = async (name, opts = {}) => {
    await page.screenshot({ path: join(SHOTS, `${name}.png`), ...opts });
    console.log(`  shot  ${name}.png`);
  };

  // Overview, light.
  await page.evaluate(() => globalThis.__LAO__.app.panel.showHome());
  await page.waitForTimeout(500);
  await shoot('01-overview-light', { clip: await panelClip() });
  await shoot('02-page-markers-light', { fullPage: false });

  // Contrast detail with a card expanded.
  await page.evaluate(() => {
    const app = globalThis.__LAO__.app;
    const key = app.results.contrast.groups[0].key;
    app.panel.state.expanded.add(key);
    app.panel.showDetail('contrast');
  });
  await page.waitForTimeout(500);
  await shoot('03-contrast-detail-light', { clip: await panelClip() });

  // Heading map.
  await page.evaluate(() => globalThis.__LAO__.app.panel.showDetail('headings'));
  await page.waitForTimeout(450);
  await shoot('04-headings-light', { clip: await panelClip() });

  // Alt text.
  await page.evaluate(() => {
    const app = globalThis.__LAO__.app;
    app.panel.state.expanded.add(app.results.images.issues[0].id);
    app.panel.showDetail('images');
  });
  await page.waitForTimeout(450);
  await shoot('05-alt-light', { clip: await panelClip() });

  // Tab order, drawn on the page. Scroll to where the focusable elements
  // actually are, otherwise the path is culled out of the shot.
  await page.evaluate(() => {
    const app = globalThis.__LAO__.app;
    app.prefs.lenses = { contrast: false, headings: false, images: false, tabs: true };
    app._applyPrefs();
    app.panel.showDetail('tabs');
    document.querySelector('nav')?.scrollIntoView({ block: 'center' });
  });
  await page.waitForTimeout(700);
  await shoot('06-taborder-light');

  // Marker close-up: the on-page signature, with one badge hovered.
  await page.evaluate(() => {
    const app = globalThis.__LAO__.app;
    app.prefs.lenses = { contrast: true, headings: true, images: true, tabs: false };
    app._applyPrefs();
    app.panel.showHome();
    scrollTo(0, 0);
  });
  await page.waitForTimeout(400);
  const hoverTarget = await page.evaluate(() => {
    const sr = globalThis.__LAO__.app.shadow;
    const marks = [...sr.querySelectorAll('.lao-mk')];
    const target = marks.find((m) => m.getBoundingClientRect().top > 120) || marks[0];
    target.dataset.hover = 'true';
    const r = target.getBoundingClientRect();
    return { x: Math.max(0, r.left - 60), y: Math.max(0, r.top - 90), w: 720, h: 260 };
  });
  await page.waitForTimeout(350);
  await shoot('11-markers-closeup', {
    clip: { x: hoverTarget.x, y: hoverTarget.y, width: hoverTarget.w, height: hoverTarget.h },
  });

  // Dark mode.
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.evaluate(() => {
    const app = globalThis.__LAO__.app;
    app.prefs.lenses = { contrast: true, headings: true, images: true, tabs: false };
    app._applyPrefs();
    app.panel.showHome();
  });
  await page.waitForTimeout(500);
  await shoot('07-overview-dark', { clip: await panelClip() });
  await page.evaluate(() => {
    const app = globalThis.__LAO__.app;
    app.panel.state.expanded.add(app.results.contrast.groups[0].key);
    app.panel.showDetail('contrast');
  });
  await page.waitForTimeout(500);
  await shoot('08-contrast-detail-dark', { clip: await panelClip() });
  await page.emulateMedia({ colorScheme: 'light' });
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
  };
});
check('clean page: reports zero issues', clean.total === 0, JSON.stringify(clean.detail));
check('clean page: shows the all-clear state', clean.hasAllClear);
check('clean page: draws no markers', clean.markers === 0);

if (WANT_SHOTS) {
  await page2.waitForTimeout(600);
  const box = await page2.evaluate(() => {
    const p = document.querySelector('live-accessibility-overlay').shadowRoot.querySelector('.lao-panel');
    const r = p.getBoundingClientRect();
    return { x: r.left - 24, y: r.top - 24, width: r.width + 48, height: r.height + 48 };
  });
  await page2.screenshot({ path: join(SHOTS, '09-allclear-light.png'), clip: box });
  console.log('  shot  09-allclear-light.png');
  await page2.emulateMedia({ colorScheme: 'dark' });
  await page2.waitForTimeout(400);
  await page2.screenshot({ path: join(SHOTS, '10-allclear-dark.png'), clip: box });
  console.log('  shot  10-allclear-dark.png');
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
  const lens = sr.querySelector('.lao-lens-glyph');
  return {
    panelTransition: ms(getComputedStyle(panel).transitionDuration.split(',')[0]),
    lensTransition: ms(getComputedStyle(lens).transitionDuration.split(',')[0]),
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
check('heavy page: markers are culled to the viewport, not all rendered',
  heavy.renderedMarkers < heavy.contrast,
  `${heavy.renderedMarkers} rendered of ${heavy.contrast}`);

await browser.close();

/* ------------------------------------------------------------------ report */

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('\nFailures:');
  for (const f of failed) console.log(`  · ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
  process.exit(1);
}
