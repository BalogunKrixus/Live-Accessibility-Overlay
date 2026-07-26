/**
 * Generates Chrome Web Store listing assets.
 *
 *   node tools/store-assets.mjs
 *
 * Screenshots must be exactly 1280x800 (or 640x400) and the small promo tile
 * exactly 440x280, so everything here is captured at those dimensions with
 * deviceScaleFactor 1 — the dashboard rejects anything else.
 */
import { chromium } from 'playwright';
import { readFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'dist', 'store');

const RUNTIME = [
  'src/core/util.js', 'src/core/color.js',
  'src/audits/contrast.js', 'src/audits/headings.js',
  'src/audits/images.js', 'src/audits/taborder.js',
  'src/ui/styles.js', 'src/ui/icons.js', 'src/ui/copy.js',
  'src/ui/overlay.js', 'src/ui/panel.js', 'src/content/main.js',
];

const CHROME_STUB = `
  globalThis.chrome = {
    storage: { local: { _d: {},
      get(k) { return Promise.resolve({ [k]: this._d[k] }); },
      set(o) { Object.assign(this._d, o); return Promise.resolve(); } } },
    runtime: { sendMessage() {}, onMessage: { addListener() {} } },
  };
`;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
// Exactly the dimensions the dashboard expects, at 1x.
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });

async function load(fixture) {
  const page = await context.newPage();
  await page.addInitScript(CHROME_STUB);
  await page.goto(pathToFileURL(join(ROOT, 'test', fixture)).href);
  for (const f of RUNTIME) await page.addScriptTag({ content: readFileSync(join(ROOT, f), 'utf8') });
  await page.waitForFunction(() => globalThis.__LAO__?.app?.results, null, { timeout: 10000 });
  await page.waitForTimeout(600);
  return page;
}

const shot = async (page, name) => {
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log(`  ${name}.png  1280x800`);
};

/* ------------------------------------------------------------ screenshots */

console.log('\nScreenshots (1280x800):');
const demo = await load('fixture-demo.html');

await demo.evaluate(() => globalThis.__LAO__.app.panel.showHome());
await demo.waitForTimeout(400);
await shot(demo, 'screenshot-1-overview');

// An issue with a suggested colour, which is the clearest single demonstration.
await demo.evaluate(() => {
  const app = globalThis.__LAO__.app;
  const i = app.panel.state.items.findIndex((x) => x.category === 'contrast');
  app.panel.showIssue(i >= 0 ? i : 0);
});
await demo.waitForTimeout(700);
await shot(demo, 'screenshot-2-issue');

// The single on-page mark: the thing that makes it "in context".
await demo.evaluate(() => {
  const app = globalThis.__LAO__.app;
  const i = app.panel.state.items.findIndex((x) => x.category === 'images');
  if (i >= 0) app.panel.showIssue(i);
});
await demo.waitForTimeout(700);
await shot(demo, 'screenshot-3-on-page');

await demo.evaluate(() => globalThis.__LAO__.app.panel.showKeyboard());
await demo.waitForTimeout(700);
await shot(demo, 'screenshot-4-keyboard-path');

const clean = await load('fixture-clean.html');
await clean.waitForTimeout(700);
await shot(clean, 'screenshot-5-all-clear');

/* ------------------------------------------------------------ promo tile */

console.log('\nPromo tile (440x280):');
const tile = await context.newPage();
await tile.setViewportSize({ width: 440, height: 280 });
await tile.setContent(`
  <style>
    html,body { margin:0; height:100%; }
    body {
      display:grid; place-items:center;
      background: radial-gradient(120% 120% at 20% 0%, #f2f5ff 0%, #e6ebfb 55%, #dfe6f8 100%);
      font: 16px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      color:#14161c;
    }
    .card { display:flex; flex-direction:column; align-items:center; gap:14px; text-align:center; }
    .name { font-size:24px; font-weight:640; letter-spacing:-0.03em; }
    .tag { font-size:13.5px; color:#4a5061; max-width:30ch; }
    svg { filter: drop-shadow(0 8px 18px rgba(78,107,245,0.32)); }
  </style>
  <div class="card">
    <svg width="76" height="76" viewBox="0 0 24 24" fill="none">
      <path d="M12 2.55 L20.23 7.28 L20.23 16.73 L12 21.45 L3.77 16.73 L3.77 7.28 Z"
            fill="#4E6BF5" stroke="#4E6BF5" stroke-width="5.2" stroke-linejoin="round"/>
      <path d="M7.4 12.3 L10.7 15.7 L17.0 8.5" stroke="#fff" stroke-width="2.9"
            fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <div>
      <div class="name">Live Accessibility Overlay</div>
      <div class="tag">Accessibility problems on any page, in plain language.</div>
    </div>
  </div>
`);
await tile.waitForTimeout(400);
await tile.screenshot({ path: join(OUT, 'promo-tile-440x280.png') });
console.log('  promo-tile-440x280.png  440x280');

await browser.close();
console.log(`\nWritten to ${join('dist', 'store')}`);
