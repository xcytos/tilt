import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DECOR = path.resolve(HERE, '..');
const TMP = path.join(HERE, '.tmp');
fs.mkdirSync(TMP, { recursive: true });

const { bundle, buildTo, ORDER, splitImports, stripExports, topLevelNames } =
  await import(pathToFileURL(path.join(DECOR, 'tools/build.mjs')).href);

let fails = 0;
const check = (l, c, x = '') => {
  if (c) console.log('  ok   ' + l);
  else { fails++; console.log('  FAIL ' + l + (x ? '  ' + x : '')); }
};

const read = rel => fs.readFileSync(path.join(DECOR, rel), 'utf8');
const MODULE_TAG = '<script type="module" src="./js/app.js"></script>';

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js')) out.push(path.relative(DECOR, p));
  }
  return out;
}

console.log('\n1. TILT.html stays the served/dev entry');
check('references js/app.js as an external module', read('TILT.html').includes(MODULE_TAG));
check('keeps the importmap', /<script type="importmap">/.test(read('TILT.html')));
{
  const html = read('TILT.html');
  check('redirects non-http opens to the standalone build',
        /TILT\\.standalone\\.html\$/.test(html) && /location\.replace/.test(html));
  check('redirect is a no-op on http(s)', /https\?\:\$\//.test(html));
}

console.log('\n2. TILT.standalone.html is up to date');
const committedPath = path.join(DECOR, 'TILT.standalone.html');
check('exists', fs.existsSync(committedPath));
const freshPath = path.join(TMP, 'fresh.html');
const fresh = buildTo(freshPath);
const committed = fs.readFileSync(committedPath, 'utf8');
check('matches a clean rebuild (run `node tools/build.mjs`)', fresh === committed,
      fresh === committed ? '' : `${fresh.length} vs ${committed.length} bytes`);

console.log('\n3. standalone is self contained');
const html = committed;
const modMatch = /<script type="module">([\s\S]*?)<\/script>/.exec(html);
check('has an inline module script', !!modMatch);
check('no longer references js/app.js', !html.includes('src="./js/app.js"'));
const code = modMatch ? modMatch[1] : '';
check('no export statements left', !/^\s*export\s/m.test(code));
check('no unresolved local imports', !/from\s+'\.\//.test(code));
check('keeps the redirect guard but never loops',
      /TILT\\.standalone\\.html\$/.test(html) && /location\.replace/.test(html));
check('keeps the importmap before the module', html.indexOf('importmap') < html.indexOf('<script type="module">'));

const REMOTE = [
  "import * as THREE from 'three';",
  "import { OrbitControls } from 'three/addons/controls/OrbitControls.js';",
  "import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';"
];
for (const line of REMOTE) {
  const n = code.split(line).length - 1;
  check(`imports ${line.slice(8, 48)}... exactly once`, n === 1, `x${n}`);
}

console.log('\n4. every source module made it into the bundle');
for (const rel of ORDER) {
  check(`bundle marker for ${rel}`, code.includes(`// ---- ${rel} ----`));
}
const allJs = walk(path.join(DECOR, 'js'));
const missing = allJs.filter(rel => ORDER.includes(rel) === false);
check('ORDER covers every file under js/', missing.length === 0, missing.join(', '));
check('ORDER entries all exist', ORDER.every(rel => fs.existsSync(path.join(DECOR, rel))));

console.log('\n5. nothing was dropped or duplicated');
const expect = [];
for (const rel of ORDER) {
  const src = read(rel);
  const { code: body } = splitImports(rel, src);
  expect.push(...topLevelNames(stripExports(rel, body)));
}
const got = topLevelNames(code);
const sortedExpect = [...expect].sort();
const sortedGot = [...got].sort();
check(`top-level declarations match the sources (${sortedExpect.length})`,
      JSON.stringify(sortedExpect) === JSON.stringify(sortedGot),
      `expected ${sortedExpect.length}, got ${sortedGot.length}`);
const dupes = got.filter((n, i) => got.indexOf(n) !== i);
check('no duplicate top-level names', dupes.length === 0, dupes.join(', '));

for (const sym of ['validateDef', 'Registry', 'PARAMS', 'createO2TiltModel',
                   'getStructuralPoints', 'generateFabricGeometry', 'createBaseFrame',
                   'frameCamera', 'Viewer', 'createPanel', 'scheduleRebuild', 'window.O2']) {
  check(`symbol present: ${sym}`, new RegExp(`\\b${sym}\\b`).test(code));
}

console.log('\n6. the bundle parses');
{
  const file = path.join(TMP, 'standalone.bundle.mjs');
  fs.writeFileSync(file, code);
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  check('node --check on the inlined module', r.status === 0, (r.stderr || '').trim().split('\n')[0]);
}

console.log('\n7. both HTML files: inline classic scripts parse');
for (const file of ['TILT.html', 'TILT.standalone.html']) {
  const src = read(file);
  const scripts = [...src.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)];
  let bad = 0;
  scripts.forEach((m, i) => {
    const attrs = m[1] || '';
    const body = m[2];
    if (/type="importmap"/.test(attrs)) {
      try { JSON.parse(body); } catch (e) { bad++; console.log('      importmap: ' + e.message); }
      return;
    }
    const isModule = /type="module"/.test(attrs);
    const ext = path.join(TMP, `inline-${file.replace(/\W/g, '')}-${i}${isModule ? '.mjs' : '.cjs'}`);
    fs.writeFileSync(ext, body);
    const r = spawnSync(process.execPath, ['--check', ext], { encoding: 'utf8' });
    if (r.status !== 0) { bad++; console.log('      ' + (r.stderr || '').split('\n').find(l => l.includes('Error'))); }
  });
  check(`${file}: ${scripts.length} inline scripts parse`, bad === 0, `${bad} bad`);
}

console.log(fails === 0 ? '\nALL CHECKS PASSED' : `\n${fails} CHECK(S) FAILED`);
process.exit(fails ? 1 : 0);
