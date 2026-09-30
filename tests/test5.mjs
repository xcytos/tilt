import * as THREE from './vendor/three160.js';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DECOR = path.resolve(HERE, '..');
const TMP = path.join(HERE, '.tmp');
fs.mkdirSync(TMP, { recursive: true });

let fails = 0;
const check = (l, c, x = '') => {
  if (c) console.log('  ok   ' + l);
  else { fails++; console.log('  FAIL ' + l + (x ? '  ' + x : '')); }
};

// Import the model factory (three must be rewritten for node) and registry.js
const threeURL = pathToFileURL(path.join(HERE, 'vendor', 'three160.js')).href;
const modelFile = path.join(TMP, 'o2tilt.test5.mjs');
fs.writeFileSync(modelFile,
  fs.readFileSync(path.join(DECOR, 'js/objects/o2tilt.js'), 'utf8')
    .replace("from 'three'", `from '${threeURL}'`));
const { createO2TiltModel, PARAMS } = await import(pathToFileURL(modelFile).href);

const registryFile = path.join(TMP, 'registry.test5.mjs');
fs.writeFileSync(registryFile, fs.readFileSync(path.join(DECOR, 'js/registry.js'), 'utf8'));
const { Registry, validateDef } = await import(pathToFileURL(registryFile).href);

const types = new Map([['o2tilt-frame', { factory: createO2TiltModel, params: PARAMS }]]);

// Serve the DECOR folder in place of a real HTTP server, so loadManifest/load
// run exactly as they will in the browser. Accepts both './models/x.json'
// (browser style) and file:// URLs (used by the hardening tests).
const toFile = url => {
  const s = String(url);
  if (s.startsWith('file://')) return decodeURI(s.slice('file://'.length));
  return path.resolve(DECOR, s.replace(/^\.\//, ''));
};
const localFetch = async url => {
  const file = toFile(url);
  if (!file.startsWith(DECOR) || !fs.existsSync(file)) return { ok: false, status: 404 };
  const text = fs.readFileSync(file, 'utf8');
  return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) };
};
globalThis.fetch = localFetch;

console.log('\n1. manifest.json is well formed');
const manifestPath = path.join(DECOR, 'models/manifest.json');
let manifest;
try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); check('parses as JSON', true); }
catch (e) { check('parses as JSON', false, e.message); process.exit(1); }
check('has a models array', Array.isArray(manifest.models) && manifest.models.length > 0);
for (const m of manifest.models) {
  check(`entry ${m.id}: id/name/file present`,
        typeof m.id === 'string' && typeof m.name === 'string' && typeof m.file === 'string');
  check(`  models/${m.file} exists`, fs.existsSync(path.join(DECOR, 'models', m.file)));
  const def = JSON.parse(fs.readFileSync(path.join(DECOR, 'models', m.file), 'utf8'));
  check(`  ${m.file} id matches manifest (${def.id} === ${m.id})`, def.id === m.id);
}

console.log('\n2. registry.loadManifest + load + instantiate');
const reg = new Registry('./models').register('o2tilt-frame', createO2TiltModel, PARAMS);
const entries = await reg.loadManifest();
check('returns one entry per manifest model', entries.length === manifest.models.length,
      `${entries.length}/${manifest.models.length}`);
check('exposes a list for the panel selector', reg.list.length === entries.length);
check('source is now "manifest"', reg.manifestSource === 'manifest');

for (const entry of entries) {
  const def = await reg.load(entry.id);
  check(`${entry.id}: validates clean`, validateDef(def, types).length === 0);
  const { models, environment } = await reg.instantiate(def);
  check(`  instantiates ${models.length} object(s)`, models.length === def.objects.length);
  check(`  model renamed to "${def.name}"`, models[0].name === def.name && models[0].id === def.id);
  const want = def.objects[0].params;
  const got = models[0].state;
  const mismatch = Object.entries(want).filter(([k, v]) => got[k] !== v);
  check(`  state matches preset params (${Object.keys(want).join(', ')})`, mismatch.length === 0,
        JSON.stringify(mismatch));
  check(`  environment carried through`, !environment.theme || ['light', 'dark'].includes(environment.theme));
  check(`  preset actually changes geometry vs classic`, (() => {
    const base = createO2TiltModel();
    const a = JSON.stringify(base.object3D.children.map(c => [
      +c.position.x.toFixed(4), +c.position.z.toFixed(4)]));
    const b = JSON.stringify(models[0].object3D.children.map(c => [
      +c.position.x.toFixed(4), +c.position.z.toFixed(4)]));
    return entry.id === 'o2tilt-classic' ? true : a !== b;
  })());
  models.forEach(m => m.dispose());
}
check('definitions are cached', (await reg.load(entries[0].id)) === (await reg.load(entries[0].id)));

console.log('\n3. presets are distinct');
const states = [];
for (const e of entries) {
  const def = await reg.load(e.id);
  states.push(JSON.stringify(def.objects[0].params));
}
check('all three presets differ', new Set(states).size === states.length, `${new Set(states).size}/${states.length}`);

console.log('\n4. validation rejects bad definitions');
const bad = [
  ['not an object', 'nope', /must be a JSON object/],
  ['missing id', { name: 'x', objects: [{ type: 'o2tilt-frame' }] }, /missing "id"/],
  ['missing name', { id: 'x', objects: [{ type: 'o2tilt-frame' }] }, /missing "name"/],
  ['empty objects', { id: 'x', name: 'x', objects: [] }, /non-empty array/],
  ['unknown object type', { id: 'x', name: 'x', objects: [{ type: 'pillar' }] }, /not registered/],
  ['param out of range', { id: 'x', name: 'x',
    objects: [{ type: 'o2tilt-frame', params: { pan: 500 } }] }, /outside \[0, 90\]/],
  ['param wrong type', { id: 'x', name: 'x',
    objects: [{ type: 'o2tilt-frame', params: { gap: 'wide' } }] }, /must be a number/],
  ['toggle must be boolean', { id: 'x', name: 'x',
    objects: [{ type: 'o2tilt-frame', params: { fabric: 'yes' } }] }, /true or false/],
  ['unknown param', { id: 'x', name: 'x',
    objects: [{ type: 'o2tilt-frame', params: { sparkle: 1 } }] }, /unknown "sparkle"/],
  ['bad theme', { id: 'x', name: 'x', environment: { theme: 'neon' },
    objects: [{ type: 'o2tilt-frame' }] }, /environment\.theme/],
  ['elements must be an array', { id: 'x', name: 'x',
    objects: [{ type: 'o2tilt-frame', elements: 'curtain' }] }, /elements must be an array/]
];
for (const [label, def, re] of bad) {
  const errs = validateDef(def, types);
  check(`${label}`, errs.length > 0 && errs.some(e => re.test(e)), errs.join('; '));
}
check('a good definition passes', validateDef({
  id: 'ok', name: 'OK',
  environment: { theme: 'dark' },
  objects: [{ type: 'o2tilt-frame', params: { gap: 3, pan: 10, pitch: 5, decline: 20, fabric: true }, elements: [] }]
}, types).length === 0);

console.log('\n5. manifest hardening');
const hostile = {
  models: [{ id: 'evil', name: 'Evil', file: '../../../etc/passwd' }]
};
{
  const scratch = path.join(TMP, 'hostile');
  fs.mkdirSync(scratch, { recursive: true });
  fs.writeFileSync(path.join(scratch, 'manifest.json'), JSON.stringify(hostile));
  const hreg = new Registry(pathToFileURL(scratch).href).register('o2tilt-frame', createO2TiltModel, PARAMS);
  let threw = '';
  try { await hreg.loadManifest(); } catch (e) { threw = e.message; }
  check('rejects a path-traversal file reference', /must stay inside/.test(threw), threw);

  fs.writeFileSync(path.join(scratch, 'manifest.json'), JSON.stringify({
    models: [{ id: 'a', name: 'A', file: 'a.json' }, { id: 'a', name: 'B', file: 'b.json' }]
  }));
  threw = '';
  try { await hreg.loadManifest(); } catch (e) { threw = e.message; }
  check('rejects duplicate ids', /duplicate model id/.test(threw), threw);

  fs.writeFileSync(path.join(scratch, 'manifest.json'), '{ not json');
  threw = '';
  try { await hreg.loadManifest(); } catch (e) { threw = e.message; }
  check('reports invalid JSON clearly', /not valid JSON/.test(threw), threw);
}

console.log('\n6. built-in fallback when the manifest is unreachable');
{
  globalThis.fetch = async () => ({ ok: false, status: 404 });
  const bare = new Registry('./missing').register('o2tilt-frame', createO2TiltModel, PARAMS);
  let threw = false;
  try { await bare.loadManifest(); } catch { threw = true; }
  check('loadManifest rejects on 404', threw);
  check('list falls back to one built-in entry', bare.list.length === 1 && bare.list[0].tags.includes('builtin'));
  const def = await bare.load(bare.list[0].id);
  const { models } = await bare.instantiate(def);
  check('built-in model instantiates', models.length === 1 && models[0].object3D.children.length > 0);
  models.forEach(m => m.dispose());
  globalThis.fetch = localFetch;
}

console.log('\n7. no unregistered model types in the manifest');
for (const m of manifest.models) {
  const def = JSON.parse(fs.readFileSync(path.join(DECOR, 'models', m.file), 'utf8'));
  for (const o of def.objects) {
    check(`${m.id} -> "${o.type}" is registered`, types.has(o.type));
  }
}

console.log(fails === 0 ? '\nALL CHECKS PASSED' : `\n${fails} CHECK(S) FAILED`);
process.exit(fails ? 1 : 0);
