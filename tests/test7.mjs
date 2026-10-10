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

const read = rel => fs.readFileSync(path.join(DECOR, rel), 'utf8');

// ---------------------------------------------------------------- layout math
console.log('\nStage 3.2: layout offsets (pure)');
const viewerSrc = read('js/viewer.js');
const gapDecl = /const OVERLAY_GAP = [\d.]+;/.exec(viewerSrc);
const fnDecl = /export function layoutOffsets\([\s\S]*?\n\}/.exec(viewerSrc);
check('viewer defines the layout offset helper', !!fnDecl && !!gapDecl);
if (!fnDecl || !gapDecl) {
  console.log(`\n${fails} CHECK(S) FAILED`);
  process.exit(1);
}

const layoutFile = path.join(TMP, 'layout.mjs');
fs.writeFileSync(layoutFile, (gapDecl[0] + '\n' + (fnDecl ? fnDecl[0] : '')) + '\n');
const { layoutOffsets } = await import(pathToFileURL(layoutFile).href);
const GAP = 2.5;

const placed = (spans, gap = GAP) => {
  const offs = layoutOffsets(spans, gap);
  return spans.map((s, i) => [s[0] + offs[i], s[1] + offs[i], offs[i]]);
};
const overlaps = boxes => boxes.some((b, i) => i && b[0] < boxes[i - 1][1] - 1e-9);
const gapsBetween = boxes => boxes.slice(1).map((b, i) => b[0] - boxes[i][1]);

check('a single model is re-centred, not moved', (() => {
  const [[mn, mx]] = placed([[-6, 6]]);
  return Math.abs(mn + 6) < 1e-9 && Math.abs(mx - 6) < 1e-9;
})());
check('an off-centre single model still lands on the origin', (() => {
  const [[mn, mx]] = placed([[-10, 2]]);
  return Math.abs((mn + mx) / 2) < 1e-9;
})());

check('two models never overlap', !overlaps(placed([[-6, 6], [-6, 6]])));
check('neighbouring models are exactly `gap` apart', (() => {
  const g = gapsBetween(placed([[-6, 6], [-6, 6]]));
  return g.length === 1 && Math.abs(g[0] - GAP) < 1e-9;
})());
check('the row as a whole is centred', (() => {
  const b = placed([[-6, 6], [-6, 6]]);
  return Math.abs((b[0][0] + b[b.length - 1][1]) / 2) < 1e-9;
})());

check('three models of different widths keep the gap and stay centred', (() => {
  const b = placed([[-5, 5], [-1, 3], [-8, 2]]);
  const gs = gapsBetween(b);
  const centred = Math.abs((b[0][0] + b[2][1]) / 2) < 1e-9;
  return !overlaps(b) && gs.every(g => Math.abs(g - GAP) < 1e-9) && centred;
})());

check('a custom gap is honoured', (() => {
  const b = placed([[-6, 6], [-6, 6]], 10);
  return Math.abs(gapsBetween(b)[0] - 10) < 1e-9;
})());

check('empty spans are skipped instead of adding phantom space', (() => {
  const b = placed([[-6, 6], [0, 0], [-6, 6]]).filter(x => x[1] > x[0]);
  return b.length === 2 && Math.abs(gapsBetween(b)[0] - GAP) < 1e-9;
})());

check('nothing mounted yields no offsets', layoutOffsets([]).length === 0);
check('layoutOffsets returns finite numbers', placed([[-5, 5], [-2, 2]])
  .every(b => Number.isFinite(b[2])));

// ------------------------------------------------- real presets, real bounds
console.log('\nStage 3.2: real presets laid out side by side');
globalThis.fetch = async (url) => {
  const file = path.join(DECOR, String(url).replace(/^\.?\//, ''));
  try {
    const data = fs.readFileSync(file, 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(data) };
  } catch (err) {
    return { ok: false, status: 404, json: async () => { throw err; } };
  }
};

const { Registry, validateDef } = await import(
  pathToFileURL(path.join(DECOR, 'js/registry.js')).href);

const o2Src = read('js/objects/o2tilt.js').replace(
  "from 'three'", `from '${pathToFileURL(path.join(HERE, 'vendor', 'three160.js')).href}'`);
const o2File = path.join(TMP, 'o2tilt.layout.mjs');
fs.writeFileSync(o2File, o2Src);
const o2 = await import(pathToFileURL(o2File).href);

const registry = new Registry('./models');
registry.register('o2tilt-frame', o2.createO2TiltModel, o2.PARAMS);
await registry.loadManifest();
check('manifest lists the merged pair', registry.list.length === 2, `${registry.list.length}`);

const groups = [];
let allValid = true;
for (const entry of registry.list) {
  const def = await registry.load(entry.id);
  const errs = validateDef(def, registry.types);
  if (errs.length) { allValid = false; console.log('      ' + entry.id + ': ' + errs.join('; ')); }
  const { models } = await registry.instantiate(def);
  groups.push({ id: entry.id, models });
}
check('every preset validates against its schema', allValid);
check('every preset produced at least one model', groups.every(g => g.models.length > 0));

const spans = groups.map(g => {
  const box = new THREE.Box3();
  for (const m of g.models) {
    const t = new THREE.Box3().setFromObject(m.object3D);
    if (!t.isEmpty()) box.union(t);
  }
  return [box.min.x, box.max.x];
});
check('every preset has measurable bounds',
      spans.every(([a, b]) => Number.isFinite(a) && Number.isFinite(b)));

const row = placed(spans);
check('the presets sit side by side without clipping', !overlaps(row),
      JSON.stringify(row.map(b => [b[0].toFixed(2), b[1].toFixed(2)])));
check('spacings are the configured gap', gapsBetween(row)
  .every(g => Math.abs(g - GAP) < 1e-9), JSON.stringify(gapsBetween(row).map(g => g.toFixed(3))));
check('the row is centred on the stage',
      Math.abs((row[0][0] + row[row.length - 1][1]) / 2) < 1e-6);

check('every preset has a real footprint', spans.every(([a, b]) => b - a > 1),
      JSON.stringify(spans.map(([a, b]) => +(b - a).toFixed(2))));

console.log('\nStage 3.2: composition wiring');
const app = read('js/app.js');
const panel = read('js/panel.js');

check('app tracks a display mode', /\blet mode = 'single';/.test(app));
check('app tracks which presets are wanted', /let overlayIds = \[\];/.test(app));
check('app tracks what is actually mounted', /const mounted = new Map\(\);/.test(app));
check('app spaces models through viewer.layoutGroups', /viewer\.layoutGroups\(/.test(app));
const syncSrc = /async function syncScene\([^)]*\) \{[\s\S]*?\n\}/.exec(app);
check('scene sync places frames, then pillars, then frames once',
      !!syncSrc
      && /defaultPlaces\(\);[\s\S]*?applyPlaces\(\);\s*\n\s*refreshPillarPlaces\(\);\s*\n\s*applyPlaces\(\);[\s\S]*?viewer\.frameScene\(\);/.test(syncSrc));
check('panel callbacks are guarded against rejection',
      /onSelect: guard\(/.test(app) && /onModeChange: guard\(/.test(app)
      && /onToggle: guard\(/.test(app));
check('app exposes overlay controls on window.O2',
      /setMode, toggleOverlay, syncScene/.test(app) && /get mode\(\)/.test(app)
      && /get mounted\(\)/.test(app));
check('param changes filter to keys each model understands', /m\.params\[k\]/.test(app));
check('scene sync drops presets that failed to build', /failures\.map\(f => f\.id\)/.test(app));
check('preset theme only reapplies when the primary changes',
      /primary === lastPrimary/.test(app));

check('panel offers one-at-a-time and all-at-once',
      /\['single', 'One at a time'\]/.test(panel) && /\['overlay', 'All at once'\]/.test(panel));
check('panel has an overlay picker', /pickerBlock/.test(panel) && /onToggle/.test(panel));
check('panel renders a collapsible section per preset', /createElement\('details'\)/.test(panel));
check('panel scopes param edits to that preset\'s models',
      /emit\(\{ \[k\]: v \}, targets\)/.test(panel) && /onParamsChange\(partial, targets\)/.test(panel));
check('section control ids are namespaced by preset', /\$\{key\}-\$\{k\}/.test(panel));
check('panel can repaint without losing accordion state', /renderIfChanged/.test(panel)
      && /setBusy/.test(panel) && /sync\(\)/.test(panel));
check('viewer undoes the previous layout before re-measuring',
      /m\.object3D\.position\.x -= m\.layoutX/.test(viewerSrc));
const addSrc = /addModel\(model\) \{[\s\S]*?\n    \}/.exec(viewerSrc);
check('mounting a model does not auto-reframe the camera',
      !!addSrc && !/frameScene/.test(addSrc));

console.log(fails === 0 ? '\nALL CHECKS PASSED' : `\n${fails} CHECK(S) FAILED`);
process.exit(fails ? 1 : 0);
