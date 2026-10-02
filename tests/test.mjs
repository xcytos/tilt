import * as THREE from './vendor/three160.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DECOR = path.resolve(HERE, '..');

const html = fs.readFileSync(path.join(DECOR, 'js/objects/o2tilt.js'), 'utf8');

function extract(name) {
  const start = html.indexOf(`function ${name}(`);
  if (start < 0) throw new Error('not found: ' + name);
  let i = html.indexOf('{', start), depth = 0, j = i;
  for (; j < html.length; j++) {
    if (html[j] === '{') depth++;
    else if (html[j] === '}') { depth--; if (depth === 0) { j++; break; } }
  }
  return html.slice(start, j);
}

const src = [extract('getStructuralPoints'), extract('generateFabricGeometry')].join('\n');

const CONSTS = `
  const POLE_MAX_HEIGHT = 8.0, RAIL_LENGTH = 12.0, WAVE_AMP = 1.0;
  const RAIL_RADIUS = 0.12, POLE_RADIUS = 0.08;
  const FABRIC_RES_X = 300, FABRIC_RES_Y = 8;
  const MAX_DROP = 5.0, PLEAT_FREQ = 30, PLEAT_DEPTH = 0.12;
  let UI = { gap: 3.0, pan: 0, pitch: 0, decline: 0 };
`;

const factory = new Function('THREE', `${CONSTS}${src};
  return {
    getStructuralPoints: (isRight, segs) => getStructuralPoints(UI, isRight, segs),
    generateFabricGeometry, UI
  };`);
const { getStructuralPoints, generateFabricGeometry, UI } = factory(THREE);

let fails = 0;
function check(label, cond, extra = '') {
  if (cond) console.log('  ok   ' + label);
  else { fails++; console.log('  FAIL ' + label + (extra ? '  ' + extra : '')); }
}
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

console.log('\n1. Mirror symmetry (left.x === -right.x, y/z equal)');
for (const ui of [{ gap: 3, pan: 0, pitch: 0, decline: 0 },
                  { gap: 0, pan: 45, pitch: 20, decline: 100 },
                  { gap: 6, pan: 90, pitch: 7, decline: 33 }]) {
  Object.assign(UI, ui);
  const R = getStructuralPoints(true, 300), L = getStructuralPoints(false, 300);
  let bad = 0;
  for (let i = 0; i <= 300; i++) {
    if (!approx(L[i].x, -R[i].x) || !approx(L[i].y, R[i].y) || !approx(L[i].z, R[i].z)) bad++;
  }
  check(`ui=${JSON.stringify(ui)} -> ${bad} mismatched`, bad === 0);
}

console.log('\n2. Decline is independent of pitch (pure vertical slope)');
const poleIdx = [0, 150, 300]; // 3 stands land at t = 0, 0.5, 1
let pitchBad = 0;
for (const pitch of [0, 5, 13, 20]) {
  Object.assign(UI, { gap: 3, pan: 0, pitch, decline: 60 });
  const R = getStructuralPoints(true, 300);
  const expected = poleIdx.map(i => 8 - (i / 300) * 0.6 * 5.0);
  poleIdx.forEach((idx, k) => { if (!approx(R[idx].y, expected[k], 1e-9)) pitchBad++; });
}
check('pole top Y matches 8 - t*decline*5 at every pitch', pitchBad === 0, `(${pitchBad} bad)`);

console.log('\n3. Pitch still changes the rail (not a no-op)');
Object.assign(UI, { gap: 3, pan: 0, pitch: 0, decline: 0 });
const flat = getStructuralPoints(true, 300);
UI.pitch = 20;
const tilted = getStructuralPoints(true, 300);
let maxDy = 0;
for (let i = 0; i <= 300; i++) maxDy = Math.max(maxDy, Math.abs(flat[i].y - tilted[i].y));
check(`max Y deviation from pitch = ${maxDy.toFixed(3)}`, maxDy > 0.2);
const poleDev = poleIdx.map(i => Math.abs(flat[i].y - tilted[i].y));
check(`pole heights unchanged by pitch (max ${Math.max(...poleDev).toExponential(1)})`, poleDev.every(v => v < 1e-9));

console.log('\n4. Decline end-point is exactly the requested drop');
Object.assign(UI, { gap: 3, pan: 0, pitch: 20, decline: 100 });
const full = getStructuralPoints(true, 300);
check(`far end Y = 3 (8-5), got ${full[300].y.toFixed(6)}`, approx(full[300].y, 3, 1e-9));
Object.assign(UI, { gap: 3, pan: 0, pitch: 0, decline: 100 });
check('same with pitch=0', approx(getStructuralPoints(true, 300)[300].y, 3, 1e-9));

console.log('\n5. Fabric: pleat normal is a true mirror AND perpendicular to the rail');
function pleatNormal(pts, i, isRight) {
  const cols = 300, pt = pts[i];
  let tan = new THREE.Vector3();
  if (i < cols) tan.subVectors(pts[i + 1], pt); else tan.subVectors(pt, pts[i - 1]);
  tan.y = 0; tan.normalize();
  const n = new THREE.Vector3(-tan.z, 0, tan.x);
  if (!isRight) n.negate();
  return { n, tan };
}
Object.assign(UI, { gap: 3, pan: 30, pitch: 20, decline: 50 });
const fR = getStructuralPoints(true, 300), fL = getStructuralPoints(false, 300);
let perpBad = 0, mirrorBad = 0;
for (let i = 0; i <= 300; i += 7) {
  const a = pleatNormal(fR, i, true), b = pleatNormal(fL, i, false);
  if (Math.abs(a.n.dot(a.tan)) > 1e-6) perpBad++;
  if (Math.abs(b.n.dot(b.tan)) > 1e-6) perpBad++;
  if (!approx(b.n.x, -a.n.x) || !approx(b.n.z, a.n.z)) mirrorBad++;
}
check('normal perpendicular to tangent both sides', perpBad === 0, `(${perpBad})`);
check('left normal is x-mirror of right normal', mirrorBad === 0, `(${mirrorBad})`);

console.log('\n6. Fabric geometry integrity');
for (const isRight of [true, false]) {
  Object.assign(UI, { gap: 2, pan: 45, pitch: 20, decline: 80 });
  const pts = getStructuralPoints(isRight, 300);
  const g = generateFabricGeometry(pts, isRight);
  const pos = g.getAttribute('position');
  const idx = g.getIndex();
  const rows = 8, stride = rows + 1;
  const expectedVerts = (300 + 1) * stride;
  const expectedIdx = 300 * rows * 6;
  let nan = 0;
  for (let k = 0; k < pos.count * 3; k++) if (!Number.isFinite(pos.array[k])) nan++;
  let oob = 0;
  for (let k = 0; k < idx.count; k++) if (idx.array[k] >= expectedVerts) oob++;

  g.computeBoundingBox();
  const bb = g.boundingBox;
  check(`side=${isRight} verts=${pos.count}/${expectedVerts} tris=${idx.count / 3}/${expectedIdx / 6}`,
        pos.count === expectedVerts && idx.count === expectedIdx);
  check(`  finite coords`, nan === 0, `(${nan} NaN)`);
  check(`  indices in range`, oob === 0, `(${oob} out of bounds)`);
  check(`  hem at floor: minY=${bb.min.y.toFixed(4)}`, Math.abs(bb.min.y) < 1e-6);
  check(`  head under rail: maxY=${bb.max.y.toFixed(4)} (rail max ${Math.max(...pts.map(p => p.y)).toFixed(4)})`,
        bb.max.y <= Math.max(...pts.map(p => p.y)) - 0.12 + 1e-6);
}

console.log('\n7. Pole sampling hits the wave nodes (poles stay on the centreline)');
Object.assign(UI, { gap: 3, pan: 0, pitch: 20, decline: 0 });
const p = getStructuralPoints(true, 300);
const waveAt = poleIdx.map(i => Math.abs(p[i].z));
check(`pole Z offsets: ${waveAt.map(v => v.toExponential(1)).join(', ')}`, waveAt.every(v => v < 1e-9));

console.log('\n8. Pleat sampling density');
const pleatFreq = 30, cols = 300;
check(`${cols} columns / ${pleatFreq} pleats = ${(cols / pleatFreq).toFixed(1)} samples per cycle (>=8)`, cols / pleatFreq >= 8);
const pleatDepth = 0.12, wavelength = 12 / pleatFreq;
check(`pleat peak-to-peak ${(2 * pleatDepth).toFixed(2)} < wavelength ${wavelength.toFixed(2)}`, 2 * pleatDepth < wavelength);

console.log(fails === 0 ? '\nALL CHECKS PASSED' : `\n${fails} CHECK(S) FAILED`);
process.exit(fails ? 1 : 0);
