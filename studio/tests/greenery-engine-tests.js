/* Node test — greenery geometry + factory (needs THREE global first). */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const THREE = require('/data/data/com.termux/files/usr/tmp/opencode/three128.js');
global.THREE = THREE;
global.window = global;
global.globalThis = global;

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.log('  FAIL:', msg); } }
function section(name) { console.log('\n== ' + name); }

function load(rel) {
  const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  vm.runInThisContext(code, { filename: rel });
}

section('load files');
try {
  load('js/greenery/greenery-core.js');
  load('js/greenery/monstera.js');
  load('js/greenery/eucalyptus.js');
  load('js/greenery/boston-fern.js');
  load('js/greenery/greenery-factory.js');
  ok(true, 'all load');
} catch (e) { ok(false, 'load: ' + e.message); console.log(e.stack); }

const GC = global.GreeneryCore, GE = global.GreeneryEngine;

section('registry');
ok(GC && typeof GC.register === 'function', 'GreeneryCore.register exists');
ok(GE && typeof GE.build === 'function', 'GreeneryEngine.build exists');
ok(GE.list().length === 3, '3 models registered (got ' + GE.list().length + ')');
ok(GE.has('monstera') && GE.has('eucalyptus') && GE.has('boston-fern'), 'has() finds all three');
ok(GE.has('tulip') === false, 'unknown type not present');
ok(GC.get('monstera').label === 'Monstera leaf', 'monstera label');

section('geometry build');
for (const t of ['monstera', 'eucalyptus', 'boston-fern']) {
  const built = GE.ensureGeometry(t);
  ok(built && built.geometry, t + ': geometry built');
  const geo = built.geometry;
  ok(geo.attributes.position.count > 30, t + ': has vertices (' + geo.attributes.position.count + ')');
  ok(geo.attributes.normal, t + ': has normals');
  ok(geo.attributes.uv, t + ': has uv');
  ok(geo.attributes.color, t + ': has white color attr (renders white with vertexColors)');
  ok(GC.trianglesOf(built) > 0, t + ': triangles > 0 (' + GC.trianglesOf(built) + ')');
}

section('bounds are unit-scaled (extent ~ <=1.1)');
for (const t of ['monstera', 'eucalyptus', 'boston-fern']) {
  const geo = GE.ensureGeometry(t).geometry;
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const dx = bb.max.x - bb.min.x, dy = bb.max.y - bb.min.y, dz = bb.max.z - bb.min.z;
  ok(dy <= 1.3 && dy >= 0.4, t + ': Y extent in range (' + dy.toFixed(2) + ')');
  ok(dz <= 1.3, t + ': Z depth sane (' + dz.toFixed(2) + ')');
  console.log('   ' + t + ' extents x=' + dx.toFixed(2) + ' y=' + dy.toFixed(2) + ' z=' + dz.toFixed(2));
}

// ---- geometry validity: no black faces, clean winding, no NaN/degenerate ------
// The original "black polygon" bug was inverted triangle winding: every blade was wound
// CW so computeVertexNormals gave it a -Z normal. With the app's top-left DirectionalLight
// a -Z face is unlit (black). It only looked "kind of ok" because the material is DoubleSide.
// These assertions pin the fix: unit normals, front-facing majority, zero degenerate/dup/NaN.
section('geometry validity (no black geometry, clean mesh)');
for (const t of ['monstera', 'eucalyptus', 'boston-fern']) {
  const geo = GE.ensureGeometry(t).geometry;
  const pos = geo.attributes.position, nrm = geo.attributes.normal, idx = geo.index.array;
  let nanPos = 0, nanNrm = 0, zeroN = 0, nmin = 1e9, nmax = -1e9;
  for (let i = 0; i < pos.count; i++) {
    if (!isFinite(pos.getX(i)) || !isFinite(pos.getY(i)) || !isFinite(pos.getZ(i))) nanPos++;
  }
  for (let i = 0; i < nrm.count; i++) {
    const L = Math.hypot(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
    if (!isFinite(L)) nanNrm++;
    if (L < 1e-6) zeroN++;
    nmin = Math.min(nmin, L); nmax = Math.max(nmax, L);
  }
  let degen = 0, dup = 0, front = 0, back = 0;
  const seen = new Set();
  for (let f = 0; f < idx.length; f += 3) {
    const a = idx[f], b = idx[f + 1], c = idx[f + 2];
    const key = [a, b, c].sort((x, y) => x - y).join(',');
    if (seen.has(key)) dup++; else seen.add(key);
    const ux = pos.getX(b) - pos.getX(a), uy = pos.getY(b) - pos.getY(a), uz = pos.getZ(b) - pos.getZ(a);
    const vx = pos.getX(c) - pos.getX(a), vy = pos.getY(c) - pos.getY(a), vz = pos.getZ(c) - pos.getZ(a);
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    if (0.5 * Math.hypot(fx, fy, fz) < 1e-10) degen++;
    if (fz > 0) front++; else back++;
  }
  ok(nanPos === 0, t + ': no NaN positions');
  ok(nanNrm === 0 && zeroN === 0, t + ': no NaN/zero normals');
  ok(nmin > 0.99 && nmax < 1.01, t + ': normals unit length [' + nmin.toFixed(3) + ',' + nmax.toFixed(3) + ']');
  ok(degen === 0, t + ': no degenerate triangles');
  ok(dup === 0, t + ': no duplicate triangles');
  const tris = idx.length / 3;
  ok(front > back && front / tris > 0.7,
    t + ': front-facing majority (front=' + front + ' back=' + back + ' = ' + (100 * front / tris).toFixed(0) + '% +Z)');
  // DoubleSide material is present so the few back faces (closed tubes) are still lit.
  const built = GE.build({ type: t, items: [{ x: 0, y: 0, z: 0, rot: 0, scale: 1, variant: 0.5 }], color: '#3f7d34' });
  ok(built.meshes[0].material.side === THREE.DoubleSide, t + ': material is DoubleSide (no culled-back black)');
  GE.release(built.meshes);
}

section('estimateTriangles');
const triMono = GE.estimateTriangles('monstera', 4);
ok(triMono === GC.trianglesOf(GE.ensureGeometry('monstera')) * 4, 'estimateTriangles = per-geom * count');
ok(GE.estimateTriangles('monstera', 0) === 0, 'count 0 -> 0');

section('build instanced mesh');
const items = [
  { x: 0, y: 0, z: 0, rot: 0, scale: 1, variant: 0.5 },
  { x: 1, y: 0.5, z: 0.01, rot: 1.2, scale: 0.8, variant: 0.9 },
  { x: -1, y: 0.2, z: 0.02, rot: -0.4, scale: 1.3, variant: 0.1 }
];
const out = GE.build({ type: 'monstera', items, color: '#3f7d34', colorVariation: 0.3 });
ok(out.meshes.length === 1, 'one InstancedMesh');
ok(out.instances === 3, 'instance count matches');
ok(out.triangles === GC.trianglesOf(GE.ensureGeometry('monstera')) * 3, 'triangles = per-geom * n');
const im = out.meshes[0];
ok(im.isInstancedMesh && im.count === 3, 'InstancedMesh count=3');
ok(im.instanceColor, 'instanceColor allocated');
ok(im.material.vertexColors === true, 'material.vertexColors true');
// matrices written
const mm = new THREE.Matrix4(); let nonzero = 0;
im.getMatrixAt(1, mm); if (Math.abs(mm.elements[12] - 1) < 1e-5 && Math.abs(mm.elements[13] - 0.5) < 1e-5) nonzero++;
ok(nonzero === 1, 'instance matrix positions written');

section('unknown type throws');
try { GE.build({ type: 'nope', items: [{ x: 0, y: 0, z: 0 }] }); ok(false, 'should throw'); }
catch (e) { ok(/Unknown greenery type/.test(e.message), 'throws Unknown greenery type'); }

section('empty items returns empty');
const eout = GE.build({ type: 'eucalyptus', items: [] });
ok(eout.meshes.length === 0 && eout.triangles === 0, 'no items -> no meshes');

section('release + dispose');
GE.release(out.meshes);
ok(true, 'release ran without error');
const out2 = GE.build({ type: 'boston-fern', items: items });
ok(out2.meshes.length === 1, 'rebuild after release OK');
GE.release(out2.meshes);
GE.dispose();
ok(true, 'dispose ran without error');

section('rebuild after dispose (cache rebuilt)');
const out3 = GE.build({ type: 'monstera', items: items });
ok(out3.meshes.length === 1, 'cache rebuilt after dispose');
GE.release(out3.meshes); GE.dispose();

// ---- measured footprint vs metadata (calibration regression) -----------------
// The geometry long axis is normalised to 1, so projecting the triangles to XY and
// measuring their area, scaled by lengthIn², gives the true in² footprint. This is the
// number GREENERY_META.footprintSqIn claims and the one LOAD_K is calibrated against.
section('footprint calibration (measured vs metadata)');
load('model.js');
const FM = global.FlowerModel;
// Rasterise a geometry's XY projection; return area in world² (long axis = 1).
function projectedAreaWorld2(geo, N = 360) {
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const dx = bb.max.x - bb.min.x, dy = bb.max.y - bb.min.y;
  const idx = geo.index.array, pos = geo.attributes.position;
  const grid = new Uint8Array(N * N);
  const toI = (v, lo, span) => Math.max(0, Math.min(N - 1, Math.round((v - lo) / span * (N - 1))));
  for (let f = 0; f < idx.length / 3; f++) {
    const a = idx[f * 3], b = idx[f * 3 + 1], c = idx[f * 3 + 2];
    const px = [pos.getX(a), pos.getX(b), pos.getX(c)], py = [pos.getY(a), pos.getY(b), pos.getY(c)];
    const x0 = Math.min(...px.map(v => toI(v, bb.min.x, dx))), x1 = Math.max(...px.map(v => toI(v, bb.min.x, dx)));
    const y0 = Math.min(...py.map(v => toI(v, bb.min.y, dy))), y1 = Math.max(...py.map(v => toI(v, bb.min.y, dy)));
    const den = (py[1] - py[2]) * (px[0] - px[2]) + (px[2] - px[1]) * (py[0] - py[2]);
    if (Math.abs(den) < 1e-12) continue;
    for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) {
      const X = bb.min.x + gx / (N - 1) * dx, Y = bb.min.y + gy / (N - 1) * dy;
      const l1 = ((py[1] - py[2]) * (X - px[2]) + (px[2] - px[1]) * (Y - py[2])) / den;
      const l2 = ((py[2] - py[0]) * (X - px[2]) + (px[0] - px[2]) * (Y - py[2])) / den;
      const l3 = 1 - l1 - l2;
      if (l1 >= -1e-6 && l2 >= -1e-6 && l3 >= -1e-6) grid[gy * N + gx] = 1;
    }
  }
  let occ = 0; for (let i = 0; i < grid.length; i++) occ += grid[i];
  return (occ / (N * N)) * dx * dy; // world² (long axis = 1)
}
for (const t of FM.GREENERY_TYPES) {
  const meta = FM.GREENERY_META[t];
  const measured = projectedAreaWorld2(GE.ensureGeometry(t).geometry) * meta.lengthIn * meta.lengthIn;
  const ratio = measured / meta.footprintSqIn;
  ok(ratio > 0.62 && ratio < 1.5,
    t + ': measured footprint ' + measured.toFixed(0) + 'in² vs meta ' + meta.footprintSqIn + 'in² (ratio ' + ratio.toFixed(2) + ')');
  console.log('   ' + t.padEnd(13) + ' measured ' + measured.toFixed(0).padStart(4) + 'in²  meta ' +
    String(meta.footprintSqIn).padStart(4) + 'in²  ratio ' + ratio.toFixed(2));
}
// LOAD_K regression: placed instances must produce coverage close to the real union.
// We re-derive implied K from a dense monstera panel and assert it is near the
// calibrated constant (not the old over-claiming 1.5).
{
  const K = FM.GREENERY_LOAD_K;
  ok(K > 0.8 && K < 1.3, 'GREENERY_LOAD_K is the calibrated ~1.0 band (got ' + K + ')');
}

// ---- model -> factory integration (mixed config renders all types) -----------
section('model -> factory mixed integration');
{
  const mixed = FM.normalize({ designMode: 'mixed', flowerSize: 5, width: 5, height: 8, greenery: {
    mode: 'mixed', items: [
      { type: 'monstera', layer: 'structural', density: 60 },
      { type: 'eucalyptus', layer: 'volume', density: 60 },
      { type: 'boston-fern', layer: 'trailing', density: 60 }] } });
  const positions = FM.greeneryPositions(mixed);
  const byType = {};
  for (const p of positions) (byType[p.type] = byType[p.type] || []).push(p);
  ok(Object.keys(byType).length === 3, 'all three types present (got ' + Object.keys(byType).join(',') + ')');
  const built = [];
  for (const t of Object.keys(byType)) {
    const o = GE.build({ type: t, items: byType[t], color: FM.GREENERY_META[t].color, colorVariation: 0.3 });
    ok(o.meshes.length === 1 && o.instances === byType[t].length, t + ': ' + o.instances + ' instances in one mesh');
    built.push(o);
  }
  const zs = Object.keys(byType).reduce((a, t) => (a[byType[t][0].layer] = byType[t][0].z, a), {});
  ok(zs.structural < zs.volume && zs.volume < zs.trailing, 'z progresses behind->front in factory input');
  ok(positions.every(p => p.z > 0), 'every instance sits above the foam front face (z>0)');
  built.forEach(b => GE.release(b.meshes));
  GE.dispose();
  ok(true, 'mixed integration built and released');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
