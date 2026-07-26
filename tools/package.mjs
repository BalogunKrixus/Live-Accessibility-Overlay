/**
 * Pre-flight validation and packaging for the Chrome Web Store.
 *
 *   node tools/package.mjs
 *
 * Checks everything the Web Store rejects an upload for, then writes
 * dist/<name>-v<version>.zip containing only the files the extension actually
 * runs — no tests, no tooling, no node_modules. Exits non-zero if anything
 * would fail review, so this can gate a release.
 */
import { readFileSync, readdirSync, statSync, mkdirSync, rmSync, existsSync } from 'node:fs';
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
const sw = readFileSync(join(ROOT, 'src/background/service-worker.js'), 'utf8');
const injected = [...sw.matchAll(/'(src\/[^']+\.js)'/g)].map((m) => m[1]);
const missing = injected.filter((f) => !shipped.includes(join(ROOT, f)));
missing.length
  ? fail('Injected files missing from the package', missing.join(', '))
  : ok(`All ${injected.length} injected files are in the package`);

for (const f of source) {
  try { new Function(f[1]); } catch (e) { fail(`Syntax error in ${relative(ROOT, f[0])}`, e.message); }
}

/* ---------------------------------------------------------------- build */

console.log('\n── Package ──────────────────────────────────────────────────');

if (problems.length) {
  console.log(`\n${problems.length} blocking problem(s) — not packaging:\n`);
  for (const p of problems) console.log(`  · ${p}`);
  process.exit(1);
}

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

const zipName = `live-accessibility-overlay-v${manifest.version}.zip`;
const zipPath = join(DIST, zipName);
const args = ['-q', '-r', '-X', zipPath, ...SHIP, '-x', '*.svg', '.DS_Store', '__MACOSX/*'];
execFileSync('zip', args, { cwd: ROOT });

const bytes = statSync(zipPath).size;
ok('Package written', `${relative(ROOT, zipPath)} (${(bytes / 1024).toFixed(0)} KB, ${shipped.length} files)`);

// The store's own cap is generous, but a small package reviews faster.
bytes < 10 * 1024 * 1024
  ? ok('Well under the store size limit')
  : warn('Package is large', `${(bytes / 1024 / 1024).toFixed(1)} MB`);

const listed = execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' }).trim().split('\n');
const strays = listed.filter((f) => /node_modules|test\/|tools\/|\.map$|package\.json/.test(f));
strays.length
  ? fail('Development files leaked into the package', strays.join(', '))
  : ok('Contains only runtime files', 'no tests, tooling or dependencies');

console.log(`\nReady to upload: ${relative(ROOT, zipPath)}`);
if (notes.length) {
  console.log('\nWorth knowing:');
  for (const n of notes) console.log(`  · ${n}`);
}
