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
check('shelf body is empty markup', /id="shelf-body"[^>]*><\/div>/.test(html));

const FILES = ['js/app.js', 'js/viewer.js', 'js/panel.js', 'js/registry.js',
               'js/objects/o2tilt.js', 'js/elements/light.js',
               'js/decorlib.js', 'js/objects/decor.js'];
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
  check('lobe gaps are number pills + one slider, not a stack of rows',
        /heading\('Lobe Gaps'\)/.test(panel) &&
        /placeRangeBlock\(`\$\{key\}-lobeGap`/.test(panel) &&
        /All/.test(panel) && !/Lobe \$\{i \+ 1\} Gap/.test(panel));
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
      : p.type === 'lobeGaps'
        ? !(p.label && p.min < p.max && p.step > 0 && typeof p.value === 'number')
        : true;
  if (bad) { schemaOk = false; schemaWhy = `${k} (${JSON.stringify(p)})`; break; }
}
check('every param is a range or toggle with a label', schemaOk, schemaWhy);
check('state mirrors every param', Object.keys(model.params).every(k => k in model.state));
check('both slope directions are exposed as labelled ranges', (() => {
  const out = model.params.decline, inn = model.params.declineIn;
  return !!out && !!inn
    && out.type === 'range' && inn.type === 'range'
    && inn.min === 0 && inn.max === 100 && inn.step > 0
    && typeof inn.value === 'number'
    && /Centre → End/.test(out.label) && /End → Centre/.test(inn.label)
    && model.state.declineIn === inn.value;
})());
check('the Top Rail is a Settings (advanced) toggle, on by default', (() => {
  const r = model.params.rail;
  return !!r && r.type === 'toggle' && r.advanced === true
    && typeof r.value === 'boolean' && r.value === true
    && model.state.rail === true;
})());
check('unticking Top Rail never flag-hides the tubes - the drape covers them', (() => {
  const golds = () => {
    const out = [];
    model.object3D.traverse(o => {
      if (o.isMesh && o.material && o.material.color
          && o.material.color.getHex() === 0xd4af37) out.push(o);
    });
    return out;
  };
  model.build();
  const on = golds();
  if (on.length !== 2 || !on.every(m => m.visible)) return false;
  model.setParams({ rail: false });
  const wentDirty = model.dirty === true;
  model.build();
  const off = golds();
  // The rail stays rendered when unticked - the sleeved fabric is what
  // obscures it - so visible must never flip to false here.
  const kept = off.length === 2 && off.every(m => m.visible === true);
  model.setParams({ rail: true });
  model.build();
  return wentDirty && kept && golds().length === 2
    && golds().every(m => m.visible);
})());
check('unticked, the curtain sleeves over the round rail (still rendered)', (() => {
  // Fabric positions are (FABRIC_RES_X + 1) * (rows + 1) = 301 * 9 = 2709.
  const fabricOf = () => {
    const out = [];
    model.object3D.traverse(o => {
      if (o.isMesh && o.geometry && o.geometry.getAttribute('position')
          && o.geometry.getAttribute('position').count === 2709) out.push(o);
    });
    return out;
  };
  const maxOf = list => {
    let m = -Infinity;
    for (const mesh of list) {
      mesh.geometry.computeBoundingBox();
      m = Math.max(m, mesh.geometry.boundingBox.max.y);
    }
    return m;
  };
  const railMax = Math.max(
    ...mod.getStructuralPoints(model.state, true, 300).map(p => p.y));
  model.setParams({ fabric: true, rail: false });
  model.build();
  const offMax = maxOf(fabricOf());
  model.setParams({ rail: true });
  model.build();
  const onMax = maxOf(fabricOf());
  model.setParams({ fabric: false });
  model.build();
  // Unticked, the fold sleeves the tube (plain columns +0.14) and
  // swells into the holder hood at the bracket columns (crown +0.35
  // over the rail axis) - so the top sits in that window, never below
  // the sleeve or above the hood.
  return Math.abs(onMax - (railMax - 0.12)) < 1e-6
    && offMax <= railMax + 0.35 + 1e-6 && offMax >= railMax + 0.14 - 1e-6;
})());

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
check('has rail + pole + base + uplight + stripline anchors',
      kinds.join(',') === 'base,pole,rail,stripline,uplight', kinds.join(','));
check('every anchor has position/tangent/normal', anchors.every(a =>
  a.position && a.tangent && a.normal &&
  Number.isFinite(a.position.x) && Number.isFinite(a.position.y) && Number.isFinite(a.position.z)));
check('rail anchors lie on the rail (y within +/-1 of the pole height)',
      anchors.filter(a => a.kind === 'rail').every(a => a.position.y > 2 && a.position.y < 9));
check('base anchors sit on the floor', anchors.filter(a => a.kind === 'base').every(a => a.position.y === 0));
check('20 floor uplights (10 per wall), on the floor, clear of every stand plate', (() => {
  const ups = anchors.filter(a => a.kind === 'uplight');
  const bases = anchors.filter(a => a.kind === 'base');
  const xs = anchors.filter(a => a.kind === 'rail').map(r => r.position.x);
  let clear = true;
  for (const h of ups) {
    for (const b of bases) {
      if (Math.hypot(h.position.x - b.position.x, h.position.z - b.position.z) < 1.0) {
        clear = false;
      }
    }
  }
  return ups.length === 20
    && ups.filter(a => a.side === 'L').length === 10
    && ups.filter(a => a.side === 'R').length === 10
    && ups.every(a => a.position.y === 0
      && a.position.x >= Math.min(...xs) - 0.5
      && a.position.x <= Math.max(...xs) + 0.5)
    && clear;
})());
check('uplight hooks follow Swing Pan: front of the cloth, spread, aimed at it', (() => {
  // Each hook must sit in front of (along its own normal) the rail sample it
  // was sampled from - any pan sign, even 75 degrees where a pure -Z offset
  // would slip behind the curtain - stay spread, clear of plates, and aim
  // back at that same piece of cloth.
  const railsOn = (list, side, idx) => list.find(a =>
    a.kind === 'rail' && a.side === side && a.id === `rail-${side}-${idx}`);
  const samples = anchors.filter(a => a.kind === 'rail' && a.side === 'R').length - 1;
  for (const pan of [0, -75, 75]) {
    model.setParams({ pan });
    model.build();
    const swing = model.getAnchors();
    const ups = swing.filter(a => a.kind === 'uplight');
    const bases = swing.filter(a => a.kind === 'base');
    for (const h of ups) {
      const k = Number(/-(\d+)$/.exec(h.id)[1]);
      const rail = railsOn(swing, h.side, Math.max(0, Math.min(samples,
        Math.round(((k + 0.5) / 10) * samples))));
      const dx = h.position.x - rail.position.x;
      const dz = h.position.z - rail.position.z;
      if (dx * h.normal.x + dz * h.normal.z < 1.0) return false;
      const ax = h.position.x - h.normal.x;
      const az = h.position.z - h.normal.z;
      if (Math.hypot(ax - rail.position.x, az - rail.position.z)
          >= Math.hypot(dx, dz)) return false;
      for (const b of bases) {
        if (Math.hypot(h.position.x - b.position.x,
                       h.position.z - b.position.z) < 1.0) return false;
      }
      for (const o of ups) {
        if (o === h || o.side !== h.side) continue;
        if (Math.hypot(h.position.x - o.position.x,
                       h.position.z - o.position.z) < 0.8) return false;
      }
    }
  }
  model.setParams({ pan: 0 });
  model.build();
  return true;
})());
check('anchors are cached until rebuild', (() => {
  const first = model.getAnchors();
  return model.getAnchors() === first;
})());
check('strip lines ride the rail: top on the curve, hem at the foot', (() => {
  const lines = anchors.filter(a => a.kind === 'stripline');
  if (lines.length !== 4) return false;
  const rail = side => anchors.filter(a => a.kind === 'rail' && a.side === side);
  for (const a of lines) {
    if (!a.normal || !a.tangent || a.position.y === undefined) return false;
    if (a.mount !== 'top' && a.mount !== 'hem') return false;
    const row = rail(a.side);
    if (row.length < 2) return false;
    const xs = row.map(r => r.position.x);
    if (a.position.x < Math.min(...xs) - 0.5
        || a.position.x > Math.max(...xs) + 0.5) return false;
    if (a.mount === 'top') {
      const ys = row.map(r => r.position.y);
      if (a.position.y < Math.min(...ys) - 0.5
          || a.position.y > Math.max(...ys) + 0.5) return false;
    } else if (a.position.y !== 0.12) return false;
  }
  for (const side of ['L', 'R']) {
    const top = lines.find(a => a.side === side && a.mount === 'top');
    const hem = lines.find(a => a.side === side && a.mount === 'hem');
    if (Math.abs(top.position.x - hem.position.x) > 1e-9
        || Math.abs(top.position.z - hem.position.z) > 1e-9) return false;
  }
  return true;
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
  check('stands sit backstage of their rail point, hidden by the drape', (() => {
    const st = model.state;
    const ptsL = mod.getStructuralPoints(st, false, 300);
    const ptsR = mod.getStructuralPoints(st, true, 300);
    const BACK = 0.3; // STAND_BACK: drape hides its own uprights from the guest
    return s.every(g => {
      const isLeft = g.name.startsWith('stand-L');
      const pts = isLeft ? ptsL : ptsR;
      const i = Number(g.name.slice(-1));
      const idx = Math.floor((i / 2) * 300);
      const p = pts[idx];
      const jPrev = pts[Math.max(0, idx - 1)];
      const jNext = pts[Math.min(pts.length - 1, idx + 1)];
      const tan = jNext.clone().sub(jPrev);
      if (tan.lengthSq() < 1e-12) tan.set(1, 0, 0);
      tan.normalize();
      const n = new THREE.Vector3(-tan.z, 0, tan.x);
      if (isLeft) n.negate();
      if (n.lengthSq() < 1e-12) n.set(0, 0, 1);
      n.normalize();
      const ex = p.x + n.x * BACK, ez = p.z + n.z * BACK;
      const dist = Math.hypot(g.position.x - ex, g.position.z - ez);
      return dist < 1e-6;
    });
  })());
  check('every stand has an arm reaching back to its rail bracket', (() => {
    const arms = [];
    model.object3D.traverse(o => {
      if (o.type === 'Mesh' && /^stand-arm-[LR]-\d+$/.test(o.name)) arms.push(o);
    });
    return arms.length === 6;
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

// declineIn = 100 drops the centre stand instead of the far end - the
// second slope, from end to centre, must drive the same telescope split.
{
  model.setParams({ decline: 0, declineIn: 100 });
  model.build();
  const s = stands();
  const exp = idx => 8 - (1 - idx / 2) * 5; // drop anchored at the far end
  const worst = s.reduce((m, g) => Math.abs(
    part(g, 'stand-sleeve').scale.y
    + (part(g, 'stand-inner').visible ? part(g, 'stand-inner').scale.y : 0)
    - exp(standIndex(g))), 0);
  check('declineIn re-splits sleeve and inner centre-first', worst < 1e-9,
        `err ${worst}`);
  const near = s.filter(g => standIndex(g) === 0);
  check('the centre stand hides its inner tube once dropped',
        near.length === 2 && near.every(g => !part(g, 'stand-inner').visible));
  const far = s.filter(g => standIndex(g) === 2);
  check('the far stand still reaches full height',
        far.length === 2 && far.every(g =>
          Math.abs(part(g, 'stand-inner').scale.y - 3) < 1e-9));

  model.setParams({ declineIn: 0 });
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

console.log('\nStage 3: lighting element contract (universal model + type adaptors)');
{
  const lightFile = path.join(TMP, 'light.contract.mjs');
  fs.writeFileSync(lightFile, fs.readFileSync(path.join(DECOR, 'js/elements/light.js'), 'utf8')
    .replace("from 'three'", `from '${pathToFileURL(path.join(HERE, 'vendor', 'three160.js')).href}'`));
  const light = await import(pathToFileURL(lightFile).href);

  check('exports the three type adaptors',
        JSON.stringify(light.LIGHT_TYPES) === '["light-par","light-led","light-strip"]');
  check('every type has a human name',
        light.LIGHT_TYPES.every(t => typeof light.LIGHT_NAMES[t] === 'string'
          && light.LIGHT_NAMES[t]));
  check('every type has its own params schema',
        light.LIGHT_TYPES.every(t => light.LIGHT_PARAMS[t.slice(6)]
          && Object.keys(light.LIGHT_PARAMS[t.slice(6)]).length > 0));

  const spotsOf = m => {
    const out = [];
    m.object3D.traverse(o => { if (o.isSpotLight) out.push(o); });
    return out;
  };

  for (const type of light.LIGHT_TYPES) {
    const lm = light.createLightModel(type);
    check(`${type}: full model contract`, lm.id === type
      && typeof lm.name === 'string' && lm.subtitle
      && lm.object3D && lm.object3D.isObject3D && lm.params && lm.state
      && ['build', 'setTheme', 'setParams', 'dispose'].every(k => typeof lm[k] === 'function'));
    check(`${type}: params are ranges/toggles with labels, state mirrors params`,
          Object.entries(lm.params).every(([, p]) => p.type === 'toggle'
            ? (p.label && typeof p.value === 'boolean')
            : (p.type === 'range' && p.label
               && p.min < p.max && p.step > 0 && typeof p.value === 'number'))
          && Object.keys(lm.params).every(k => k in lm.state));

    lm.build();
    const spots = spotsOf(lm);
    if (type === 'light-strip') {
      check(`${type}: emissive only - no real light`, spots.length === 0,
            `${spots.length} spotlights`);
    } else {
      check(`${type}: exactly one bounded spotlight`, spots.length === 1,
            `${spots.length} spotlights`);
      check(`${type}: the spotlight never casts shadows`, spots[0].castShadow === false);
    }

    lm.setParams({ power: 40 });
    check(`${type}: setParams marks the model dirty`, lm.dirty === true);
    lm.build();
    check(`${type}: build() clears the dirty flag`, lm.dirty === false);
    if (spots.length) check(`${type}: power drives the spotlight`,
      Math.abs(spotsOf(lm)[0].intensity
        - (type === 'light-par' ? 0.4 * 2.2 : 0.4 * 1.4)) < 1e-9);

    // Show/hide: every fixture carries a Shown toggle, on by default; off
    // hides the whole group at once (housing, beam and real light alike -
    // three skips an invisible group's subtree) and survives a rebuild.
    check(`${type}: Shown is a toggle, defaults on, fixture visible`,
          lm.params.enabled && lm.params.enabled.type === 'toggle'
          && lm.params.enabled.value === true
          && lm.state.enabled === true && lm.object3D.visible === true);
    lm.setParams({ enabled: false });
    check(`${type}: Shown off hides the fixture in the same tick`,
          lm.object3D.visible === false && lm.dirty === true);
    lm.build();
    check(`${type}: a rebuild keeps it hidden and its parts intact`,
          lm.object3D.visible === false && lm.state.enabled === false
          && spotsOf(lm).length === spots.length);
    lm.setParams({ enabled: true });
    check(`${type}: Shown on shows it again`, lm.object3D.visible === true
          && lm.state.enabled === true);
    lm.build();
    check(`${type}: back on survives the rebuild too`, lm.object3D.visible === true);

    if (type === 'light-strip') {
      lm.setParams({ length: 11 });
      lm.build();
      check(`${type}: length changes the tube geometry`,
            lm.object3D.children.some(c => c.geometry && c.geometry.type === 'BoxGeometry'
              && Math.abs(c.geometry.parameters.width - 11) < 1e-9));
    } else {
      lm.setParams({ tilt: -60 });
      lm.build();
      const yoke = lm.object3D.children.find(c => c.type === 'Group');
      const head = yoke && yoke.children.find(c => c.type === 'Group');
      check(`${type}: tilt re-aims the head (-60 tilt = +60° up)`,
            !!head && Math.abs(head.rotation.x - Math.PI / 3) < 1e-9,
            head ? `rx=${head.rotation.x.toFixed(3)}` : 'no head group');
    }
    check(`${type}: RGBW mixing - hue and sat are in the schema`,
          lm.params.hue && lm.params.hue.min === 0 && lm.params.hue.max === 360
          && lm.params.hue.value === 40
          && lm.params.sat && lm.params.sat.max === 100
          && lm.params.sat.value === 35);
    const probeTint = m => {
      const s = spotsOf(m)[0];
      if (s) return s.color;
      let hit = null;
      m.object3D.traverse(o => {
        if (!hit && o.isMesh && o.material && o.material.emissive
          && o.material.emissive.getHex() !== 0) hit = o.material.emissive;
      });
      return hit;
    };
    lm.setParams({ hue: 0, sat: 100 });
    lm.build();
    const red = probeTint(lm);
    check(`${type}: hue/sat tint the emitted light (red at hue 0, sat 100)`,
          !!red && red.r > 0.5 && red.r > red.g && red.r > red.b,
          red ? `rgb(${red.r.toFixed(2)},${red.g.toFixed(2)},${red.b.toFixed(2)})` : 'no probe');
    lm.setParams({ sat: 0 });
    lm.build();
    const white = probeTint(lm);
    check(`${type}: saturation 0 is plain white`,
          !!white && Math.abs(white.r - white.g) < 1e-3
          && Math.abs(white.g - white.b) < 1e-3,
          white ? `rgb(${white.r.toFixed(2)},${white.g.toFixed(2)},${white.b.toFixed(2)})` : 'no probe');
    lm.setParams({ hue: 40, sat: 35 });
    lm.build();
    const warm = probeTint(lm);
    check(`${type}: the warm-white default reads warm (r > g > b)`,
          !!warm && warm.r > warm.g && warm.g > warm.b,
          warm ? `rgb(${warm.r.toFixed(2)},${warm.g.toFixed(2)},${warm.b.toFixed(2)})` : 'no probe');
    const spotD = spotsOf(lm)[0];
    if (type !== 'light-strip') {
      check(`${type}: the spot fades out at 12 ft (no spill past the wall)`,
            !!spotD && spotD.distance === 12,
            spotD ? `distance=${spotD.distance}` : 'no spot');
    }

    lm.setTheme(true);
    lm.setTheme(false);
    lm.dispose();
    check(`${type}: dispose() empties the root`, lm.object3D.children.length === 0);
  }

  check('a PAR beam follows its focus angle', (() => {
    const pm = light.createLightModel('light-par', { focus: 60 });
    let cone = null;
    pm.object3D.traverse(o => {
      if (o.isMesh && o.geometry && o.geometry.type === 'CylinderGeometry'
        && o.geometry.parameters.openEnded) cone = o;
    });
    if (!cone) return false;
    const wideR = cone.geometry.parameters.radiusTop;
    pm.setParams({ focus: 20 });
    pm.build();
    let narrow = null;
    pm.object3D.traverse(o => {
      if (o.isMesh && o.geometry && o.geometry.type === 'CylinderGeometry'
        && o.geometry.parameters.openEnded) narrow = o;
    });
    narrow = narrow && narrow.geometry.parameters.radiusTop;
    pm.dispose();
    return narrow && narrow < wideR;
  })());
}

console.log(fails === 0 ? '\nALL CHECKS PASSED' : `\n${fails} CHECK(S) FAILED`);
process.exit(fails ? 1 : 0);
