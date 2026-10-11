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

console.log('\nStage 1: shell / viewer / model separation');
const html = fs.readFileSync(path.join(DECOR, 'TILT.html'), 'utf8');
check('shell points at js/app.js', /<script type="module" src="\.\/js\/app\.js">/.test(html));
check('shell has no inline module code', !/<script type="module">/.test(html));
check('shell keeps the importmap', /<script type="importmap">/.test(html));
check('importmap is valid JSON', (() => {
  const m = /<script type="importmap">([\s\S]*?)<\/script>/.exec(html);
  try { JSON.parse(m[1]); return true; } catch { return false; }
})());
check('sliders moved out of the shell', !html.includes('slider-gap') && !html.includes('toggle-fabric'));
check('panel body is empty markup', /id="panel-body"><\/div>/.test(html));

const FILES = ['js/app.js', 'js/viewer.js', 'js/panel.js', 'js/registry.js', 'js/objects/o2tilt.js'];
for (const f of FILES) check(`exists ${f}`, fs.existsSync(path.join(DECOR, f)));

for (const f of FILES) {
  const src = fs.readFileSync(path.join(DECOR, f), 'utf8');
  const rel = [...src.matchAll(/from\s+'(\.[^']+)'/g)].map(m => m[1]);
  for (const r of rel) {
    const resolved = path.resolve(path.dirname(path.join(DECOR, f)), r);
    check(`${f} -> ${r}`, fs.existsSync(resolved));
  }
}
{
  const viewer = fs.readFileSync(path.join(DECOR, 'js/viewer.js'), 'utf8');
  const panel = fs.readFileSync(path.join(DECOR, 'js/panel.js'), 'utf8');
  const model = fs.readFileSync(path.join(DECOR, 'js/objects/o2tilt.js'), 'utf8');
  const app = fs.readFileSync(path.join(DECOR, 'js/app.js'), 'utf8');
  check('viewer owns scene/renderer/controls/env/floor/theme/frame',
        /OrbitControls/.test(viewer) && /RoomEnvironment/.test(viewer) &&
        /makeFloorTexture/.test(viewer) && /frameCamera/.test(viewer) && /setTheme/.test(viewer));
  check('panel builds controls from a schema (no hard-coded sliders)',
        !/slider-gap/.test(panel) && !/param-gap|toggle-fabric/.test(panel) &&
        /Object\.entries\(\w+\.params\)/.test(panel) &&
        /rangeBlock\(/.test(panel) && /toggleBlock\(/.test(panel));
  check('model owns its geometry, params, theme and anchors',
        /createBaseFrame/.test(model) && /generateFabricGeometry/.test(model) &&
        /PARAMS/.test(model) && /MODEL_THEME/.test(model) && /getAnchors/.test(model));
  check('model never touches the scene directly', !/scene\.add/.test(model) && !/document\./.test(model));
  check('viewer never hard-codes model params', !/UI\.gap|state\.pan/.test(viewer));
  check('app is the only composition root', /createO2TiltModel/.test(app) && /new Viewer/.test(app));
}

console.log('\nStage 2: model contract (real module import)');
const modelSrc = fs.readFileSync(path.join(DECOR, 'js/objects/o2tilt.js'), 'utf8');
const patched = modelSrc.replace("from 'three'", `from '${pathToFileURL(path.join(HERE, 'vendor', 'three160.js')).href}'`);
const tmpFile = path.join(TMP, 'o2tilt.contract.mjs');
fs.writeFileSync(tmpFile, patched);

const mod = await import(pathToFileURL(tmpFile).href);
const model = mod.createO2TiltModel();

check('exports a stable id/name', model.id === 'o2tilt' && typeof model.name === 'string');
check('exposes object3D for the viewer to mount', model.object3D && model.object3D.isObject3D);
check('builds real content', model.object3D.children.length > 0,
      `${model.object3D.children.length} children`);
check('exposes params schema + state', !!model.params && !!model.state);
check('exposes build/getAnchors/setTheme/setParams/dispose',
      ['build', 'getAnchors', 'setTheme', 'setParams', 'dispose'].every(k => typeof model[k] === 'function'));

let schemaOk = true, schemaWhy = '';
for (const [k, p] of Object.entries(model.params)) {
  const bad = p.type === 'range'
    ? !(p.label && p.min < p.max && p.step > 0 && typeof p.value === 'number')
    : p.type === 'toggle'
      ? !(p.label && typeof p.value === 'boolean')
      : true;
  if (bad) { schemaOk = false; schemaWhy = `${k} (${JSON.stringify(p)})`; break; }
}
check('every param is a range or toggle with a label', schemaOk, schemaWhy);
check('state mirrors every param', Object.keys(model.params).every(k => k in model.state));

check('setParams marks the model dirty', (() => {
  model.build();
  if (model.dirty) return false;
  model.setParams({ gap: 5 });
  return model.dirty === true;
})());
check('build() clears the dirty flag', (model.build(), model.dirty === false));
check('params actually change geometry', (() => {
  const before = model.object3D.children.length;
  model.setParams({ fabric: true });
  model.build();
  const after = model.object3D.children.length;
  model.setParams({ fabric: false });
  model.build();
  return after > before && model.object3D.children.length === before;
})(), 'curtain toggle should add/remove meshes');

console.log('\nStage 2: anchors (where ELEMENTS attach)');
const anchors = model.getAnchors();
check('anchors exist', anchors.length > 0, `${anchors.length}`);
const kinds = [...new Set(anchors.map(a => a.kind))].sort();
check('has rail + pole + base anchors', kinds.join(',') === 'base,pole,rail', kinds.join(','));
check('every anchor has position/tangent/normal', anchors.every(a =>
  a.position && a.tangent && a.normal &&
  Number.isFinite(a.position.x) && Number.isFinite(a.position.y) && Number.isFinite(a.position.z)));
check('rail anchors lie on the rail (y within +/-1 of the pole height)',
      anchors.filter(a => a.kind === 'rail').every(a => a.position.y > 2 && a.position.y < 9));
check('base anchors sit on the floor', anchors.filter(a => a.kind === 'base').every(a => a.position.y === 0));
check('anchors are cached until rebuild', (() => {
  const first = model.getAnchors();
  return model.getAnchors() === first;
})());
check('setTheme() does not throw for either mode', (() => {
  try { model.setTheme(true); model.setTheme(false); return true; } catch { return false; }
})());

console.log('\nStage 2: stands (3 per side, square, telescoping)');

const expectedRail = (i, decline) => 8 - (i / 2) * (decline / 100) * 5;
const stands = () => {
  const out = [];
  model.object3D.traverse(o => {
    if (o.type === 'Group' && /^stand-[LR]-\d+$/.test(o.name)) out.push(o);
  });
  return out.sort((a, b) => a.name.localeCompare(b.name));
};
const part = (g, name) => g.children.find(c => c.name === name);
const standIndex = g => Number(g.name.slice(-1));

{
  const s = stands();
  check('3 stands per side (6 total)', s.length === 6,
        s.map(g => g.name).join(' '));
  check('every stand is a sleeve plus an inner tube',
        s.every(g => part(g, 'stand-sleeve') && part(g, 'stand-inner')));
  check('stands are square tubes by default',
        s.every(g => part(g, 'stand-sleeve').geometry.type === 'ExtrudeGeometry'));
  check('stands stand on the floor',
        s.every(g => g.position.y === 0 && part(g, 'stand-sleeve').position.y === 0));
  check('stands step behind the fabric, off the rail line by the setback', (() => {
    const st = model.state;
    const ptsL = mod.getStructuralPoints(st, false, 300);
    const ptsR = mod.getStructuralPoints(st, true, 300);
    return s.every(g => {
      const pts = g.name.startsWith('stand-L') ? ptsL : ptsR;
      const i = Number(g.name.slice(-1));
      const idx = Math.floor((i / 2) * 300);
      const p = pts[idx];
      const dist = Math.hypot(g.position.x - p.x, g.position.z - p.z);
      return Math.abs(dist - 0.3) < 1e-6;
    });
  })());
}

// Default state: gap 5, decline 0, so every rail sits at the full 8 ft.
{
  const s = stands();
  check('sleeve is the 5 ft retracted length by default',
        s.every(g => Math.abs(part(g, 'stand-sleeve').scale.y - 5) < 1e-9),
        s.map(g => part(g, 'stand-sleeve').scale.y).join(','));
  check('inner tube takes up the rest of the way to the rail',
        s.every(g => Math.abs(part(g, 'stand-inner').scale.y - 3) < 1e-9),
        s.map(g => part(g, 'stand-inner').scale.y).join(','));
  check('a stand never overshoots its rail',
        s.every(g => Math.abs(part(g, 'stand-sleeve').scale.y
                                + part(g, 'stand-inner').scale.y
                                - expectedRail(standIndex(g), 0)) < 1e-9));
}

// decline = 100 drops the far end to 3 ft: below the sleeve, so no inner tube.
{
  model.setParams({ decline: 100 });
  model.build();
  const s = stands();
  const worst = s.reduce((m, g) => Math.abs(
    part(g, 'stand-sleeve').scale.y
    + (part(g, 'stand-inner').visible ? part(g, 'stand-inner').scale.y : 0)
    - expectedRail(standIndex(g), 100)), 0);
  check('decline re-splits sleeve and inner per stand', worst < 1e-9, `err ${worst}`);

  const far = s.filter(g => standIndex(g) === 2);
  check('a rail below the sleeve hides the inner tube',
        far.length === 2 && far.every(g => !part(g, 'stand-inner').visible));
  const near = s.filter(g => standIndex(g) === 0);
  check('a high rail still shows the inner tube',
        near.length === 2 && near.every(g => part(g, 'stand-inner').visible));

  model.setParams({ decline: 0 });
  model.build();
}

console.log('\nStage 2: advanced stand settings');
{
  const advanced = Object.entries(model.params).filter(([, p]) => p.advanced);
  check('shape and both wall thicknesses are exposed as advanced params',
        ['poleShape', 'poleInner', 'poleOuter', 'sleeve']
          .every(k => model.params[k] && model.params[k].advanced));
  check('advanced params are still plain range/toggle controls',
        advanced.every(([, p]) => p.type === 'range' || p.type === 'toggle'));
  check('wall thicknesses are millimetres',
        model.params.poleInner.unit === ' mm' && model.params.poleOuter.unit === ' mm');
  check('defaults are 1.0 mm inner / 1.5 mm outer / 5 ft sleeve',
        model.state.poleInner === 1 && model.state.poleOuter === 1.5
        && model.state.sleeve === 5);

  const before = stands()[0];
  const squareGeo = part(before, 'stand-sleeve').geometry;
  const squarePts = squareGeo.attributes.position.count;
  model.setParams({ poleShape: false });
  model.build();
  const roundGeo = part(before, 'stand-sleeve').geometry;
  check('one toggle swaps the stand to a round cross-section',
        roundGeo !== squareGeo && roundGeo.attributes.position.count > squarePts,
        `${squarePts} -> ${roundGeo.attributes.position.count} verts`);

  model.setParams({ poleShape: true, poleOuter: 3 });
  model.build();
  check('a heavier outer wall rebuilds the tube geometry',
        part(before, 'stand-sleeve').geometry !== roundGeo);
  check('the inner tube still nests inside the sleeve bore', (() => {
    const sleeve = part(before, 'stand-sleeve').geometry;
    const inner = part(before, 'stand-inner').geometry;
    const outerBox = new THREE.Box3().setFromBufferAttribute(sleeve.attributes.position);
    const innerBox = new THREE.Box3().setFromBufferAttribute(inner.attributes.position);
    return innerBox.max.x < outerBox.max.x - 1e-6 && innerBox.max.x > 0;
  })());

  model.setParams({ poleOuter: 1.5, poleInner: 1 });
  model.build();
}

check('dispose() detaches everything', (() => {
  model.dispose();
  return model.object3D.children.length === 0;
})());

console.log(fails === 0 ? '\nALL CHECKS PASSED' : `\n${fails} CHECK(S) FAILED`);
process.exit(fails ? 1 : 0);
