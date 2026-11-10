import * as THREE from './vendor/three160.js';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

// Validation for the manufactured decor inventory: the runtime catalog
// (js/decorlib.js) against the authored plan (plans JSON), then the
// factories' geometry against the catalog's bounding boxes - the plan's
// own runtime_import_checks. Modules are copied into a temp tree with
// their bare 'three' import rewritten to the vendored file (node has no
// import maps).

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DECOR = path.resolve(HERE, '..');
const TMP = path.join(HERE, '.tmp', 'decor');
const VENDOR = pathToFileURL(path.join(HERE, 'vendor', 'three160.js')).href;

let fails = 0;
const check = (l, c, x = '') => {
  if (c) console.log('  ok   ' + l);
  else { fails++; console.log('  FAIL ' + l + (x ? '  ' + x : '')); }
};

const read = rel => fs.readFileSync(path.join(DECOR, rel), 'utf8');

// ------------------------------------------------- 1. catalog vs the plan
console.log('\ndecor catalog: parity with the authored plan');
const plans = JSON.parse(read('plans/decor_element_library_3d_assets.json'));
const { DECOR_ASSETS, DECOR_BY_ID, M_PER_FT } =
  await import(pathToFileURL(path.join(DECOR, 'js', 'decorlib.js')).href);

check('every planned asset is in the runtime catalog',
  plans.assets.length === DECOR_ASSETS.length
  && plans.assets.every(a => !!DECOR_BY_ID[a.asset_id]));
check('names, categories, quantities and defaults match the plan',
  plans.assets.every(a => {
    const d = DECOR_BY_ID[a.asset_id];
    const rule = plans.scene_assembly_rules[a.asset_id];
    return d && d.name === a.display_name
      && d.category === a.category_id
      && d.qty === a.inventory.quantity
      && d.defaults === rule.default_instance_count;
  }), JSON.stringify(DECOR_ASSETS.map(a => [a.id, a.qty, a.defaults])));
check('bounding boxes match the plan in metres',
  plans.assets.every(a => {
    const d = DECOR_BY_ID[a.asset_id];
    const bb = a.dimensions.bounding_box_m;
    return d.sizeM.every((v, i) =>
      bb[i] === null ? v === null : Math.abs(v - bb[i]) < 1e-9);
  }));
check('foot sizes are the plan source values',
  plans.assets.every(a => {
    const d = DECOR_BY_ID[a.asset_id];
    const len = a.dimensions.length || a.dimensions.width;
    return d.sizeFt[0] === parseFloat(len.source_value)
      && d.sizeFt[1] === parseFloat(a.dimensions.height.source_value);
  }));
check('metres and feet agree to a nanometre',
  DECOR_ASSETS.every(a =>
    Math.abs(a.sizeFt[0] * M_PER_FT - a.sizeM[0]) < 1e-9
    && Math.abs(a.sizeFt[1] * M_PER_FT - a.sizeM[1]) < 1e-9));
check('depth stays unknown, exactly as the plan records it',
  DECOR_ASSETS.every(a => a.sizeM[2] === null && a.sizeFt[2] === null));
check('the catalog keeps the plan category for every asset',
  plans.categories.every(c =>
    c.asset_ids.every(id => DECOR_BY_ID[id] && DECOR_BY_ID[id].category === c.category_id)));

// ----------------------------------------------------- 2. factory geometry
console.log('\ndecor factories: bounding boxes and conventions');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(path.join(TMP, 'js', 'objects'), { recursive: true });
fs.copyFileSync(path.join(DECOR, 'js', 'decorlib.js'),
  path.join(TMP, 'js', 'decorlib.js'));
fs.copyFileSync(path.join(DECOR, 'js', 'objects', 'decor.js'),
  path.join(TMP, 'js', 'objects', 'decor.js'));
{
  const f = path.join(TMP, 'js', 'objects', 'decor.js');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8')
    .replaceAll("from 'three'", `from '${VENDOR}'`));
}

const { createDecorModel, createPillarRailModel, createArchPanelModel } =
  await import(pathToFileURL(path.join(TMP, 'js', 'objects', 'decor.js')).href);

const sizeOf = m => new THREE.Box3().setFromObject(m.object3D)
  .getSize(new THREE.Vector3());
const boxOf = m => new THREE.Box3().setFromObject(m.object3D);
const near = (a, b, eps = 1e-4) => Math.abs(a - b) <= eps;
// The scene is feet; the plan is metres.
const toM = v => v * M_PER_FT;

const large = createPillarRailModel('large');
const small = createPillarRailModel('small');
const sheet = createArchPanelModel();

check('factories export a stable id, object3D, params and state',
  [large, small, sheet].every(m =>
    typeof m.id === 'string' && typeof m.name === 'string'
    && m.object3D && m.object3D.isObject3D
    && !!m.params && typeof m.params === 'object'
    && !!m.state && typeof m.state === 'object'));
check('each model builds real content on create',
  [large, small, sheet].every(m => m.object3D.children.length > 0),
  JSON.stringify([large, small, sheet].map(m => m.object3D.children.length)));

const lsz = sizeOf(large), ssz = sizeOf(small), wsz = sizeOf(sheet);
// Catalog length becomes shaft height; catalog height is the square
// face width. Caps step out past the walls, so the footprint is a bit
// wider than the face and the total height includes both caps.
const CAP_H = 0.16 + 0.14 + 0.12;
const largeBody = 5, largeFace = 1.25;
const smallBody = 3, smallFace = 1;
const largeCap = largeFace * 1.22;
const smallCap = smallFace * 1.22;
check('the large rail is a tall pillar: 5 ft body, 1.25 ft square face',
  near(lsz.y, largeBody + 2 * CAP_H, 1e-4)
  && near(lsz.x, largeCap, 1e-4) && near(lsz.z, largeCap, 1e-4)
  && lsz.y > 2 * lsz.x,
  JSON.stringify([lsz.x, lsz.y, lsz.z]));
check('the small rail is a tall pillar: 3 ft body, 1 ft square face',
  near(ssz.y, smallBody + 2 * CAP_H, 1e-4)
  && near(ssz.x, smallCap, 1e-4) && near(ssz.z, smallCap, 1e-4)
  && ssz.y > 2 * ssz.x,
  JSON.stringify([ssz.x, ssz.y, ssz.z]));
check('the sheet bbox is the catalog 2.5 ft x 6 ft',
  near(toM(wsz.x), 0.762, 1e-6) && near(toM(wsz.y), 1.8288, 1e-6),
  JSON.stringify([wsz.x, wsz.y]));
check('depth is a positive visual estimate, never the catalog null',
  lsz.z > 0 && ssz.z > 0 && wsz.z > 0
  && near(lsz.z, lsz.x, 1e-6) && near(ssz.z, ssz.x, 1e-6)
  && wsz.z < wsz.x,
  JSON.stringify([lsz.z, ssz.z, wsz.z]));

const lb = boxOf(large), sbb = boxOf(sheet);
check('bottom sits on the ground, centred in X and Z',
  near(lb.min.y, 0, 1e-6)
  && near((lb.min.x + lb.max.x) / 2, 0, 1e-6)
  && near((lb.min.z + lb.max.z) / 2, 0, 1e-6)
  && near(sbb.min.y, 0, 1e-6)
  && near((sbb.min.x + sbb.max.x) / 2, 0, 1e-6));

check('the required nodes exist under their plan names',
  ['main_frame', 'diamond_lattice', 'left_end_support', 'right_end_support']
    .every(n => !!large.object3D.getObjectByName(n))
  && !!sheet.object3D.getObjectByName('arch_panel_sheet'));

check('four identical faces close into a hollow shaft at 90 degrees',
  ['face_0', 'face_1', 'face_2', 'face_3']
    .every(n => !!large.object3D.getObjectByName(n))
  && large.object3D.getObjectByName('corner_borders').children.length === 4
  && [0, 1, 2, 3].every(i => {
    const f = large.object3D.getObjectByName(`face_${i}`);
    return near(f.rotation.y, i * Math.PI / 2, 1e-6);
  }),
  String(large.object3D.getObjectByName('corner_borders').children.length));

check('corner borders are continuous full-height frame, not free posts',
  (() => {
    const borders = large.object3D.getObjectByName('corner_borders');
    const totalH = largeBody + 2 * CAP_H;
    return borders.children.every(c =>
      c.isMesh && c.geometry.type === 'BoxGeometry'
      && near(c.geometry.parameters.height, totalH, 1e-4));
  })());

check('stepped square caps lock the top and bottom',
  !!large.object3D.getObjectByName('bottom_cap')
  && !!large.object3D.getObjectByName('top_cap')
  && large.object3D.getObjectByName('bottom_cap').children.length === 3
  && large.object3D.getObjectByName('top_cap').children.length === 3);

check('the small rail is its own model, not a scaled large one',
  // A uniform scale could never satisfy both catalog ratios (5/3 != 1.25),
  // and each size carries its own lattice rod count.
  !near(lsz.x / ssz.x, lsz.y / ssz.y, 0.01)
  && large.object3D.getObjectByName('diamond_lattice').children.length
    !== small.object3D.getObjectByName('diamond_lattice').children.length
  && [large, small].every(m => {
    let scaled = false;
    m.object3D.traverse(o => { if (!o.scale.equals(new THREE.Vector3(1, 1, 1))) scaled = true; });
    return !scaled;
  }),
  JSON.stringify({
    ratioX: lsz.x / ssz.x, ratioY: lsz.y / ssz.y,
    rodsLarge: large.object3D.getObjectByName('diamond_lattice').children.length,
    rodsSmall: small.object3D.getObjectByName('diamond_lattice').children.length
  }));

check('the lattice keeps open gaps - rods, not a texture plane',
  large.object3D.getObjectByName('diamond_lattice').children.length > 4,
  String(large.object3D.getObjectByName('diamond_lattice').children.length));

check('the sheet starts as the placeholder until its GLB lands',
  sheet.state.modelStatus === 'placeholder'
  && sheet.object3D.getObjectByName('arch_panel_sheet').isMesh);

check('build() is re-runnable and dispose() lets go cleanly',
  (() => {
    large.build();
    const ok = sizeOf(large).x === lsz.x;
    const m = createPillarRailModel('small');
    m.dispose();
    return ok && m.object3D.children.length === 0;
  })());

check('an unknown asset id yields no model',
  createDecorModel('not-an-asset') === null);

console.log(fails === 0 ? '\nALL CHECKS PASSED' : `\n${fails} CHECK(S) FAILED`);
process.exit(fails ? 1 : 0);
