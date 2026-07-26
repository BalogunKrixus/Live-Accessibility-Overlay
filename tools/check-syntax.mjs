/**
 * Parses every runtime file.
 *
 * The stylesheet is a JS template literal, so a stray backtick in a CSS comment
 * silently terminates it and the whole design system evaporates while the DOM
 * still renders. That failure once passed a full suite of behavioural tests, so
 * it gets its own cheap guard that runs first.
 *
 *   node tools/check-syntax.mjs
 */
import { readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith('.js') || name.endsWith('.mjs')) out.push(full);
  }
  return out;
}

const files = [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'tools')), ...walk(join(ROOT, 'test'))];
let failed = 0;

for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (err) {
    failed++;
    console.error(`FAIL ${relative(ROOT, file)}`);
    console.error(String(err.stderr || err.message).split('\n').slice(0, 4).join('\n'));
  }
}

console.log(`${files.length - failed}/${files.length} files parse`);
if (failed) process.exit(1);
