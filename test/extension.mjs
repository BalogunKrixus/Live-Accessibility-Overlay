/**
 * End-to-end test of the packaged extension.
 *
 * The unit harness loads the runtime files directly, which proves the audits
 * work but says nothing about whether the *extension* works: manifest validity,
 * background-script startup, injection order, and the message handshake are all
 * untested by it. This loads the real unpacked extension in Chromium and drives
 * the real injection path.
 *
 * One deviation is unavoidable: `activeTab` is granted by a genuine toolbar
 * click, which cannot be synthesised. The extension is copied to a temp
 * directory and given host_permissions there so the injection can be triggered
 * from the service worker. Everything else is exactly what ships.
 *
 *   node test/extension.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, mkdtempSync, cpSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
};

/* ------------------------------------------------- serve the fixture over http */

const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };
const server = createServer((req, res) => {
  const name = (req.url || '/').split('?')[0].replace(/^\/+/, '') || 'fixture-issues.html';
  try {
    const body = readFileSync(join(ROOT, 'test', name));
    res.writeHead(200, { 'content-type': TYPES[extname(name)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

/* ------------------------------------------ stage the extension in a temp dir */

// LAO_EXT_DIR points the test at an already-extracted build, so the artifact
// that actually ships can be verified rather than just the source tree.
const dir = mkdtempSync(join(tmpdir(), 'lao-ext-'));
if (process.env.LAO_EXT_DIR) {
  cpSync(process.env.LAO_EXT_DIR, dir, { recursive: true });
  console.log(`  (testing the built package at ${process.env.LAO_EXT_DIR})`);
} else {
  cpSync(join(ROOT, 'manifest.json'), join(dir, 'manifest.json'));
  cpSync(join(ROOT, 'src'), join(dir, 'src'), { recursive: true });
  cpSync(join(ROOT, 'icons'), join(dir, 'icons'), { recursive: true });
}

const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
check('manifest: is Manifest V3', manifest.manifest_version === 3);
check('manifest: requests no host permissions',
  !manifest.host_permissions, 'privacy: activeTab only');
check('manifest: declares no static content scripts',
  !manifest.content_scripts, 'nothing runs until invoked');
check('manifest: permissions are minimal',
  JSON.stringify(manifest.permissions) === JSON.stringify(['activeTab', 'scripting', 'storage']),
  manifest.permissions.join(', '));

// The service worker's injection list is the single source of truth for load
// order; if a file is added to src/ and not to that list, injection breaks at
// runtime with a confusing undefined error. Verify every entry resolves.
const swSource = readFileSync(join(dir, 'src/background/background.js'), 'utf8');
const runtimeList = [...swSource.matchAll(/'(src\/[^']+\.js)'/g)].map((m) => m[1]);
let allExist = true;
for (const file of runtimeList) {
  try { readFileSync(join(dir, file)); } catch { allExist = false; console.log(`      missing: ${file}`); }
}
check('manifest: every injected file exists', allExist && runtimeList.length === 12,
  `${runtimeList.length} files`);

// Grant host permissions in the temp copy only, so injection can be triggered
// without a toolbar click.
manifest.host_permissions = ['<all_urls>'];
writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));

/* ------------------------------------------------------------------ run */

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'lao-prof-')), {
  executablePath: '/opt/pw-browsers/chromium',
  args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`],
  viewport: { width: 1280, height: 900 },
});

let worker = context.serviceWorkers()[0];
if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
check('background: service worker registered and running', !!worker, worker?.url().split('/').pop());

const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
await page.goto(`${BASE}/fixture-issues.html`);
await page.waitForLoadState('domcontentloaded');

// Drive the exact injection sequence the toolbar click performs.
const injected = await worker.evaluate(async () => {
  const RUNTIME = [
    'src/core/util.js', 'src/core/color.js',
    'src/audits/contrast.js', 'src/audits/headings.js',
    'src/audits/images.js', 'src/audits/taborder.js',
    'src/ui/styles.js', 'src/ui/icons.js', 'src/ui/copy.js',
    'src/ui/overlay.js', 'src/ui/panel.js', 'src/content/main.js',
  ];
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: RUNTIME });
  const res = await chrome.tabs.sendMessage(tab.id, { type: 'lao:ping' });
  return { tabId: tab.id, pong: res?.type };
});
check('injection: all 12 runtime files execute in order', !!injected.tabId);
check('messaging: content script answers the ping handshake', injected.pong === 'lao:pong');

// The content script lives in an isolated world, so its globals are invisible
// here by design. Everything below is asserted through the DOM the user
// actually sees, which is the stronger test anyway.
// The panel opens first and reports its progress while it reads the page, so
// wait for the pass to finish rather than for the panel to appear.
await page.waitForFunction(() => {
  const host = document.querySelector('live-accessibility-overlay');
  const sr = host?.shadowRoot;
  if (!sr?.querySelector('.lao-panel[data-state="open"]')) return false;
  return host.dataset.scanning === 'false';
}, null, { timeout: 10000 });

const live = await page.evaluate(() => {
  const host = document.querySelector('live-accessibility-overlay');
  const sr = host.shadowRoot;
  return {
    mounted: !!sr.querySelector('.lao-panel'),
    ruleCount: sr.adoptedStyleSheets?.[0]?.cssRules.length ?? 0,
    panelState: sr.querySelector('.lao-panel')?.dataset.state,
    status: sr.querySelector('.lao-status')?.textContent?.trim(),
    markers: sr.querySelectorAll('.lao-mk').length,
    issueRows: sr.querySelectorAll('.lao-items .lao-item').length,
    panelWidth: Math.round(sr.querySelector('.lao-panel').getBoundingClientRect().width),
    // Proof of isolation: the extension's globals must not reach the page.
    leaks: Object.keys(globalThis).filter((k) => k.startsWith('__LAO')),
  };
});
check('runtime: panel mounted in a shadow root', live.mounted);
check('runtime: stylesheet adopted and applied',
  live.ruleCount > 60 && live.panelWidth === 372, `${live.ruleCount} rules, ${live.panelWidth}px`);
check('runtime: panel opened on injection', live.panelState === 'open');
check('runtime: issue list rendered', live.issueRows > 0, `${live.issueRows} rows`);
check('runtime: scan produced findings', /\d+ found/.test(live.status || ''), live.status);
check('runtime: page starts unmarked until something is selected',
  live.markers === 0, `${live.markers} markers`);
check('isolation: nothing leaks into the page world', live.leaks.length === 0);
check('runtime: no uncaught page errors', pageErrors.length === 0, pageErrors.join('; '));

// The toolbar badge: it must carry the same number the panel lists, scoped to
// this tab. A badge that disagrees with the panel is worse than no badge.
const badge = await worker.evaluate(async (tabId) => {
  // The count travels from the page to the worker by message, so it lands a
  // beat after the panel has rendered it.
  let text = '';
  for (let i = 0; i < 40 && !text; i++) {
    text = await chrome.action.getBadgeText({ tabId });
    if (!text) await new Promise((r) => setTimeout(r, 50));
  }
  const colour = await chrome.action.getBadgeBackgroundColor({ tabId });
  // A tab the extension has never run in must carry no badge of its own.
  const otherTab = await chrome.tabs.create({ url: 'about:blank', active: false });
  const otherText = await chrome.action.getBadgeText({ tabId: otherTab.id });
  await chrome.tabs.remove(otherTab.id);
  return { text, colour, otherText };
}, injected.tabId);

const panelCount = await page.evaluate(() => {
  const sr = document.querySelector('live-accessibility-overlay').shadowRoot;
  return (sr.querySelector('.lao-status')?.textContent || '').match(/(\d+) found/)?.[1];
});
check('badge: shows a plain issue count', /^\d+$/.test(badge.text), `"${badge.text}"`);
check('badge: matches the number the panel reports',
  badge.text === panelCount, `badge ${badge.text} vs panel ${panelCount}`);
check('badge: is scoped to this tab only', badge.otherText === '', `other tab: "${badge.otherText}"`);
check('badge: is tinted for the worst tier present',
  badge.colour?.[0] === 194, JSON.stringify(badge.colour));

// Storage round-trip: click the real theme control (Playwright's CSS engine
// pierces open shadow roots), then read the value back from the service worker,
// which shares the extension's storage area.
await page.locator('live-accessibility-overlay .lao-head-actions button').first().click();
await page.waitForTimeout(300);
const saved = await worker.evaluate(async () => {
  const s = await chrome.storage.local.get('lao:prefs');
  return s['lao:prefs']?.theme;
});
const themeAttr = await page.evaluate(() =>
  document.querySelector('live-accessibility-overlay').dataset.theme);
check('storage: theme choice persists via chrome.storage.local',
  saved === 'light' && themeAttr === 'light', `stored=${saved}, applied=${themeAttr}`);

// Toggling closes without tearing the runtime down.
const toggled = await worker.evaluate(async (tabId) => {
  await chrome.tabs.sendMessage(tabId, { type: 'lao:toggle' });
  return true;
}, injected.tabId);
await page.waitForTimeout(500);
const afterClose = await page.evaluate(() => {
  const host = document.querySelector('live-accessibility-overlay');
  return {
    state: host.shadowRoot.querySelector('.lao-panel').dataset.state,
    markers: [...host.shadowRoot.querySelectorAll('.lao-mk')].length,
  };
});
check('toggle: closes the panel', toggled && afterClose.state === 'closed');
check('toggle: leaves nothing drawn on the page', afterClose.markers === 0, `${afterClose.markers} left`);

await context.close();
server.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} extension checks passed`);
if (failed.length) process.exit(1);
