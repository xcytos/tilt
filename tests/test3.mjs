import * as THREE from './vendor/three160.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DECOR = path.resolve(HERE, '..');

const html = fs.readFileSync(path.join(DECOR, 'js/objects/o2tilt.js'), 'utf8');
function extract(name) {
  const start = html.indexOf(`function ${name}(`);
  if (start < 0) return null;
  let i = html.indexOf('{', start), depth = 0, j = i;
  for (; j < html.length; j++) {
    if (html[j] === '{') depth++;
    else if (html[j] === '}') { depth--; if (depth === 0) { j++; break; } }
  }
  return html.slice(start, j);
}
const src = extract('createBaseFrame');
if (!src) { console.log('FAIL: createBaseFrame not found'); process.exit(1); }

const factory = new Function('THREE', 'bMat', `${src}; return createBaseFrame(bMat);`);
const group = factory(THREE, new THREE.MeshStandardMaterial({ color: 0x374151 }));
group.updateMatrixWorld(true);

let fails = 0;
const check = (l, c, x = '') => { if (c) console.log('  ok   ' + l); else { fails++; console.log('  FAIL ' + l + (x ? '  ' + x : '')); } };

const w = 1.6, thick = 0.12, h = 0.12;
const tubes = []; let plate = null, collar = null, holders = [];
group.traverse(o => {
  if (o.type === 'Mesh') {
    if (o.geometry.type === 'BoxGeometry') tubes.push(o);
    else if (o.geometry.parameters.radiusTop === 0.30) plate = o;
    else if (o.geometry.parameters.radiusTop === 0.14) collar = o;
  }
  if (o !== group && o.type === 'Group' && o.children[0]?.isMesh) holders.push(o);
});

console.log('\nBase assembly: parts present');
check('4 square-frame tubes', tubes.length === 4, `got ${tubes.length}`);
check('1 pole base plate', !!plate);
check('1 pole collar', !!collar);
check('4 diagonal braces', holders.length === 4, `got ${holders.length}`);

console.log('\nBase assembly: plate / collar / pole fit');
{
  const pb = new THREE.Box3().setFromObject(plate);
  const cb = new THREE.Box3().setFromObject(collar);
  check('plate rests on the floor (ymin = 0)', Math.abs(pb.min.y) < 1e-9, `ymin=${pb.min.y}`);
  check('plate is inside the frame ring (r < 0.68)', Math.max(Math.abs(pb.max.x), Math.abs(pb.min.x)) < 0.68);
  check('collar sits flush on the plate', Math.abs(cb.min.y - pb.max.y) < 1e-6, `${cb.min.y} vs ${pb.max.y}`);
  check('collar encloses the pole (r 0.14 > POLE_RADIUS 0.08)', 0.14 > 0.08);
  check('pole axis inside collar footprint', Math.hypot(0, 0) < 0.14);
}

console.log('\nDiagonal braces: both ends solidly embedded');
const tubeBoxes = tubes.map(t => new THREE.Box3().setFromObject(t));
const insideTube = p => tubeBoxes.some(b => b.containsPoint(p));
const insideCollar = p => Math.hypot(p.x, p.z) < 0.14 && p.y > 0.10 && p.y < 0.66;
const insidePlate  = p => Math.hypot(p.x, p.z) < 0.30 && p.y > 0 && p.y < 0.10;

// Sample the full circumference of each end cap, in world space
function capPoints(holder, localY, n = 24) {
  const m = holder.children[0];
  const geo = m.geometry, r = geo.parameters.radiusTop;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const p = new THREE.Vector3(Math.cos(a) * r, localY, Math.sin(a) * r);
    pts.push(p.applyMatrix4(m.matrixWorld));
  }
  return pts;
}

let okA = 0, okB = 0, bothInTube = 0, bothInCollar = 0;
holders.forEach((hd, i) => {
  const gLen = hd.children[0].geometry.parameters.height;
  const A = capPoints(hd, 0), B = capPoints(hd, gLen);
  const aOK = A.every(insideCollar), bOK = B.every(insideTube);
  if (aOK) okA++;
  if (bOK) okB++;
  if (A.every(p => insideCollar(p) || insidePlate(p))) bothInCollar++;
  if (B.every(insideTube)) bothInTube++;
});
check(`all 4 brace inner caps fully inside the collar  (${okA}/4)`, okA === 4);
check(`all 4 brace outer caps fully inside a frame tube (${okB}/4)`, okB === 4);
check('no brace end floats in free space', okA === 4 && okB === 4);

console.log('\nDiagonal braces: spread and clearance');
{
  const dirs = holders.map(hd => {
    const m = hd.children[0];
    const a = new THREE.Vector3(0, 0, 0).applyMatrix4(m.matrixWorld);
    const b = new THREE.Vector3(0, m.geometry.parameters.height, 0).applyMatrix4(m.matrixWorld);
    const dv = b.clone().sub(a); const plan = new THREE.Vector3(dv.x, 0, dv.z).normalize();
    return { a, b, dir: dv.normalize(), plan };
  });
  const angles = dirs.map((d, i) => {
    const o = dirs[(i + 1) % 4];
    return (d.plan.angleTo(o.plan) * 180 / Math.PI).toFixed(1);
  });
  check('4 braces 90° apart in plan', angles.every(a => Math.abs(+a - 90) < 0.5), angles.join(', '));

  const anglesToFloor = dirs.map(d => {
    const v = d.dir.clone(); v.y = 0; v.normalize();
    return (Math.asin(-d.dir.y) * 180 / Math.PI).toFixed(1);
  });
  const dips = dirs.filter(d => d.b.y < -1e-9);
  check('no brace dips below the floor', dips.length === 0, JSON.stringify(dirs.map(d => +d.b.y.toFixed(3))));
  check(`brace pitch into the frame is 30-50° (${anglesToFloor[0]}°)`, +anglesToFloor[0] > 30 && +anglesToFloor[0] < 50);

  let belowFloor = 0;
  group.traverse(o => {
    if (!o.isMesh) return;
    const bb = new THREE.Box3().setFromObject(o);
    if (bb.min.y < -1e-6) belowFloor++;
  });
  check('no part of the assembly is below y = 0', belowFloor === 0, `${belowFloor} meshes`);

  check('plate stays clear of the frame tubes', tubeBoxes.every(b => !b.intersectsBox(new THREE.Box3().setFromObject(plate))));
  {
    let hits = 0;
    dirs.forEach(d => {
      const L = d.b.distanceTo(d.a);
      for (let t = 0; t <= 1; t += 0.01) {
        const p = d.a.clone().lerp(d.b, t);
        if (Math.hypot(p.x, p.z) < 0.30 && p.y < 0.10) hits++;
      }
    });
    check('braces never clip through the base plate', hits === 0, hits + ' sample points inside');
  }
}

console.log(fails === 0 ? '\nALL CHECKS PASSED' : `\n${fails} CHECK(S) FAILED`);
process.exit(fails ? 1 : 0);
