/**
 * Pre-flight validation and packaging for the Chrome Web Store and
 * addons.mozilla.org.
 *
 *   node tools/package.mjs
 *
 * Checks everything either store rejects an upload for, then writes one zip per
 * target containing only the files the extension actually runs — no tests, no
 * tooling, no node_modules. Exits non-zero if anything would fail review, so
 * this can gate a release.
 *
 * manifest.json is the single source of truth. The Firefox manifest is derived
 * from it here rather than hand-maintained, because two manifests drift: the
 * only real differences are the background declaration and the Gecko block.
 */
import { readFileSync, readdirSync, statSync, mkdirSync, rmSync, existsSync, cpSync, writeFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

/* What actually ships. Everything else is development scaffolding. */
const SHIP = ['manifest.json', 'src', 'icons'];
const SHIP_EXCLUDE = [/\.svg$/]; // mark.svg is a design source, not runtime.

const problems = [];
const notes = [];
const ok = (label, detail = '') => console.log(`  ok    ${label}${detail ? ` — ${detail}` : ''}`);
const fail = (label, detail = '') => { problems.push(`${label}${detail ? ` — ${detail}` : ''}`); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`); };
const warn = (label, detail = '') => { notes.push(`${label}${detail ? ` — ${detail}` : ''}`); console.log(`  note  ${label}${detail ? ` — ${detail}` : ''}`); };

/* ------------------------------------------------------------- manifest */

console.log('\n── Manifest ─────────────────────────────────────────────────');
const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));

manifest.manifest_version === 3
  ? ok('Manifest V3')
  : fail('Must be Manifest V3', `found ${manifest.manifest_version}`);

// Hard limits the dashboard enforces on upload.
manifest.name.length <= 75
  ? ok('Name within 75 characters', `${manifest.name.length}`)
  : fail('Name too long', `${manifest.name.length}/75`);

manifest.description.length <= 132
  ? ok('Description within 132 characters', `${manifest.description.length}`)
  : fail('Description too long', `${manifest.description.length}/132 — the dashboard rejects this`);

/^\d+(\.\d+){0,3}$/.test(manifest.version)
  ? ok('Version is a valid dotted integer', manifest.version)
  : fail('Version must be 1–4 dot-separated integers', manifest.version);

manifest.host_permissions
  ? warn('Requests host permissions', 'triggers a broader review and a scarier install prompt')
  : ok('No host permissions', 'activeTab only — narrowest possible review');

manifest.content_scripts
  ? warn('Declares static content scripts', 'runs on pages before the user asks')
  : ok('No static content scripts', 'nothing runs until invoked');

/* ---------------------------------------------------------------- icons */

console.log('\n── Icons ────────────────────────────────────────────────────');

/** Read width/height straight from the PNG IHDR chunk. */
function pngSize(file) {
  const b = readFileSync(file);
  const isPng = b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (!isPng) return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

// 128 is the one the store listing itself uses; the rest are toolbar sizes.
for (const size of ['16', '32', '48', '128']) {
  const rel = manifest.icons?.[size];
  if (!rel) { fail(`Missing ${size}px icon`); continue; }
  const file = join(ROOT, rel);
  if (!existsSync(file)) { fail(`Icon file missing`, rel); continue; }
  const dim = pngSize(file);
  if (!dim) fail(`Icon is not a valid PNG`, rel);
  else if (dim.w !== +size || dim.h !== +size) fail(`Icon ${rel} is ${dim.w}x${dim.h}, expected ${size}x${size}`);
  else ok(`${size}x${size} PNG`, rel);
}

/* ------------------------------------------------------------- payload */

console.log('\n── Code ─────────────────────────────────────────────────────');

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const shipped = [];
for (const entry of SHIP) {
  const full = join(ROOT, entry);
  if (!existsSync(full)) { fail(`Missing ${entry}`); continue; }
  const files = statSync(full).isDirectory() ? walk(full) : [full];
  shipped.push(...files.filter((f) => !SHIP_EXCLUDE.some((re) => re.test(f))));
}

const source = shipped.filter((f) => f.endsWith('.js')).map((f) => [f, readFileSync(f, 'utf8')]);

// Remotely-hosted code is the single most common rejection reason for MV3.
const remote = source.filter(([, c]) => /\beval\s*\(|new\s+Function\s*\(|importScripts\s*\(/.test(c));
remote.length
  ? fail('Remote/dynamic code execution found', remote.map(([f]) => relative(ROOT, f)).join(', '))
  : ok('No eval, Function() or importScripts');

const fetches = source.filter(([, c]) => /\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket/.test(c));
fetches.length
  ? warn('Network APIs referenced', fetches.map(([f]) => relative(ROOT, f)).join(', '))
  : ok('No network calls', 'nothing to disclose in the privacy tab beyond "no data collected"');

const debug = source.filter(([, c]) => /console\.(log|debug)\s*\(|\bdebugger\b/.test(c));
debug.length
  ? warn('Debug statements left in', debug.map(([f]) => relative(ROOT, f)).join(', '))
  : ok('No debug statements');

// Every file the service worker injects must be present in the package.
const sw = readFileSync(join(ROOT, 'src/background/background.js'), 'utf8');
const injected = [...sw.matchAll(/'(src\/[^']+\.js)'/g)].map((m) => m[1]);
const missing = injected.filter((f) => !shipped.includes(join(ROOT, f)));
missing.length
  ? fail('Injected files missing from the package', missing.join(', '))
  : ok(`All ${injected.length} injected files are in the package`);

for (const f of source) {
  try { new Function(f[1]); } catch (e) { fail(`Syntax error in ${relative(ROOT, f[0])}`, e.message); }
}

/* ---------------------------------------------------------------- build */

/* --------------------------------------------------- cross-browser checks */

console.log('\n── Cross-browser ────────────────────────────────────────────');

// Awaiting `chrome.*` works in Chrome MV3 but not in Firefox, where only
// `browser.*` is promise-based. A bare `chrome.` in extension-API code is the
// one difference that produces a build which loads fine and then silently does
// nothing, so it is worth failing the build over.
const apiFiles = [join(ROOT, 'src/background/background.js'), join(ROOT, 'src/content/main.js')];
const bareChrome = apiFiles.filter((f) =>
  /(?<!\/\/.*)\bchrome\.(storage|runtime|tabs|action|scripting|commands)\b/.test(readFileSync(f, 'utf8')));
bareChrome.length
  ? fail('Extension APIs called on `chrome.` directly', `${bareChrome.map((f) => relative(ROOT, f)).join(', ')} — use the browser/chrome shim`)
  : ok('Extension APIs go through the browser/chrome shim', 'promise-based on both engines');

/* -------------------------------------------------------------- build */

console.log('\n── Packages ─────────────────────────────────────────────────');

if (problems.length) {
  console.log(`\n${problems.length} blocking problem(s) — not packaging:\n`);
  for (const p of problems) console.log(`  · ${p}`);
  process.exit(1);
}

mkdirSync(DIST, { recursive: true });

/**
 * Firefox MV3 runs the background as a non-persistent event page and has no
 * `background.service_worker`; Chrome MV3 requires exactly that and rejects
 * `background.scripts`. Everything else in the manifest is shared.
 *
 * strict_min_version is a judgment call. The code itself only needs 113 — MV3
 * and the `action` API arrived in 109, and the panel stylesheet uses
 * color-mix() which landed in 113. It is set to 140 (the current ESR) because
 * `data_collection_permissions` needs 140, and declaring "this add-on collects
 * nothing" in a machine-readable way is worth more than supporting browsers
 * two ESRs out of date. Drop the floor to 113 if reach matters more; the only
 * cost is one informational lint warning.
 */
function firefoxManifest(base) {
  const m = structuredClone(base);
  delete m.minimum_chrome_version;
  m.background = { scripts: [base.background.service_worker] };
  m.browser_specific_settings = {
    gecko: {
      id: 'live-accessibility-overlay@balogunkrixus',
      strict_min_version: '140.0',
      // Firefox asks add-ons to state this explicitly. The extension collects
      // nothing, and "none" is the declaration for exactly that.
      data_collection_permissions: { required: ['none'] },
    },
    // Firefox for Android gained the same key two releases later, so it needs
    // its own floor rather than inheriting the desktop one.
    gecko_android: { strict_min_version: '142.0' },
  };
  return m;
}

const TARGETS = [
  { id: 'chrome', label: 'Chrome Web Store', manifest },
  { id: 'firefox', label: 'addons.mozilla.org', manifest: firefoxManifest(manifest) },
];

const built = [];
for (const target of TARGETS) {
  const stage = join(DIST, target.id);
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });

  for (const entry of SHIP) {
    if (entry === 'manifest.json') continue; // Written per target below.
    cpSync(join(ROOT, entry), join(stage, entry), {
      recursive: true,
      filter: (src) => !SHIP_EXCLUDE.some((re) => re.test(src)),
    });
  }
  writeFileSync(join(stage, 'manifest.json'), `${JSON.stringify(target.manifest, null, 2)}\n`);

  const zipPath = join(DIST, `live-accessibility-overlay-${target.id}-v${manifest.version}.zip`);
  rmSync(zipPath, { force: true });
  execFileSync('zip', ['-q', '-r', '-X', zipPath, '.'], { cwd: stage });

  const bytes = statSync(zipPath).size;
  const listed = execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' }).trim().split('\n');

  const strays = listed.filter((f) => /node_modules|test\/|tools\/|\.map$|package\.json/.test(f));
  if (strays.length) fail(`${target.id}: development files leaked in`, strays.join(', '));
  if (!listed.includes('manifest.json')) fail(`${target.id}: manifest.json is not at the archive root`);

  ok(`${target.label}`, `${relative(ROOT, zipPath)} (${(bytes / 1024).toFixed(0)} KB, ${listed.length} entries)`);
  built.push({ ...target, zipPath, stage });
}

/* ------------------------------------------------------ Firefox lint */

// web-ext lint runs addons-linter, the same linter AMO runs on submission, so
// this catches a rejection before it is a rejection.
console.log('\n── addons.mozilla.org linter ─────────────────────────────────');
const ffStage = built.find((b) => b.id === 'firefox').stage;
// Parse the JSON report rather than the exit code: web-ext exits 0 with
// warnings present, and a warning still means a human reviewer has something
// to adjudicate.
try {
  const raw = execFileSync(
    'npx',
    ['--no-install', 'web-ext', 'lint', '--source-dir', ffStage, '--output', 'json'],
    { encoding: 'utf8', cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] },
  );
  const report = JSON.parse(raw);
  const { errors: e = 0, warnings: w = 0, notices: n = 0 } = report.summary || {};
  const detail = (list) => [...new Set(list.map((x) => `${x.code} (${x.file || 'manifest'})`))].join(', ');

  if (e) fail('AMO linter reported errors', detail(report.errors));
  else ok('AMO linter: no errors');

  if (w) warn(`AMO linter: ${w} warning${w === 1 ? '' : 's'}`, detail(report.warnings));
  else ok('AMO linter: no warnings', 'nothing for a reviewer to adjudicate');
  if (n) notes.push(`AMO linter: ${n} notice(s)`);
} catch (err) {
  const out = `${err.stdout || ''}${err.stderr || ''}`.trim();
  fail('AMO linter failed to run', out.split('\n').slice(-8).join(' | ') || err.message);
}

if (problems.length) {
  console.log(`\n${problems.length} blocking problem(s):\n`);
  for (const p of problems) console.log(`  · ${p}`);
  process.exit(1);
}

console.log('\nReady to upload:');
for (const b of built) console.log(`  ${b.label.padEnd(22)} ${relative(ROOT, b.zipPath)}`);
if (notes.length) {
  console.log('\nWorth knowing:');
  for (const n of notes) console.log(`  · ${n}`);
}
