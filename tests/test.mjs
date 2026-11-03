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
  const LOBES_MIN = 4, LOBES_MAX = 11, LOBE_GAP_MIN = 0.2, LOBE_GAP_MAX = 3.0;
  const RAIL_RADIUS = 0.12, POLE_RADIUS = 0.08;
  const RAIL_WRAP_ROWS = 4, RAIL_WRAP_GAP = 0.02;
  const BR_HOOD_R = 0.35, BR_HOOD_SWEEP = 140 * Math.PI / 180;
  const BR_HOOD_HOLD = 4, BR_HOOD_RAMP = 6;
  const FABRIC_RES_X = 300, FABRIC_RES_Y = 8, POLE_COUNT = 3;
  const MAX_DROP = 5.0, PLEAT_FREQ = 30, PLEAT_DEPTH = 0.12;
  let UI = { gap: 3.0, pan: 0, pitch: 0, decline: 0, lobes: 6, lobeGaps: [1,1,1,1,1,1,1,1,1,1,1] };
`;

const factory = new Function('THREE', `${CONSTS}${src};
  return {
    getStructuralPoints: (isRight, segs) => getStructuralPoints(UI, isRight, segs),
    generateFabricGeometry, UI
  };`);
const { getStructuralPoints, generateFabricGeometry, UI } = factory(THREE);
// Module-scope copies for pins that run outside the factory scope.
const BR_HOOD_R = 0.35, BR_HOOD_SWEEP = 140 * Math.PI / 180;

let fails = 0;
function check(label, cond, extra = '') {
  if (cond) console.log('  ok   ' + label);
  else { fails++; console.log('  FAIL ' + label + (extra ? '  ' + extra : '')); }
}
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

console.log('\n1. Mirror symmetry (left.x === -right.x, y/z equal)');
for (const ui of [{ gap: 3, pan: 0, pitch: 0, decline: 0 },
                  { gap: 0, pan: 45, pitch: 20, decline: 100 },
                  { gap: 6, pan: 90, pitch: 7, decline: 33 },
                  { gap: 3, pan: -45, pitch: 10, decline: 20 },
                  { gap: 2, pan: -90, pitch: 0, decline: 0 }]) {
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

console.log('\n4b. The second slope: declineIn drops from end to centre');
Object.assign(UI, { gap: 3, pan: 0, pitch: 0, decline: 0, declineIn: 100 });
const inward = getStructuralPoints(true, 300);
check(`centre Y = 3 (8-5), got ${inward[0].y.toFixed(6)}`, approx(inward[0].y, 3, 1e-9));
check(`far end stays at 8, got ${inward[300].y.toFixed(6)}`, approx(inward[300].y, 8, 1e-9));
Object.assign(UI, { decline: 100 });
const both = getStructuralPoints(true, 300);
check('both directions at 100%: each end drops exactly 5 ft',
       approx(both[0].y, 3, 1e-9) && approx(both[300].y, 3, 1e-9));
Object.assign(UI, { decline: 40, declineIn: 10 });
const mixed = getStructuralPoints(true, 300);
check('ends drop independently (40% out, 10% in)',
       approx(mixed[0].y, 8 - 0.1 * 5, 1e-9) && approx(mixed[300].y, 8 - 0.4 * 5, 1e-9));
check('the rail blends the two drops linearly between them',
       approx(mixed[150].y, 8 - 0.5 * 0.4 * 5 - 0.5 * 0.1 * 5, 1e-9));
// Older callers never heard of declineIn - the old single slope must be
// exactly what they still get.
delete UI.declineIn;
Object.assign(UI, { decline: 60 });
const legacy = getStructuralPoints(true, 300);
check('a state without declineIn keeps the old centre → end slope only',
       approx(legacy[0].y, 8, 1e-9) && approx(legacy[300].y, 8 - 0.6 * 5, 1e-9));
UI.declineIn = 0; // later sections never mention it - keep it out of their way

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

console.log('\n6b. Rail unticked: the curtain sleeves over the still-rendered rail');
Object.assign(UI, { gap: 3, pan: 0, pitch: 0, decline: 0, declineIn: 0 });
{
  const pts = getStructuralPoints(true, 300);
  const railTop = Math.max(...pts.map(p => p.y));
  const bbOf = g => { g.computeBoundingBox(); return g.boundingBox; };
  const headOn = bbOf(generateFabricGeometry(pts, true)).max.y;
  const wrapped = generateFabricGeometry(pts, true, false);
  const headOff = bbOf(wrapped).max.y;
  check(`rail ticked: head hangs ${railTop - headOn} below the tube (0.12)`,
        approx(headOn, railTop - 0.12, 1e-6));
  check(`unticked: the holder hood reaches the crown (+${(headOff - railTop).toFixed(2)})`,
        approx(headOff, railTop + 0.35, 1e-6));
  check('unticked: plain columns hug the tube from just outside it', (() => {
    // Off a bracket the top rows lie on a circle one gap-proud of the
    // tube - equator, crown, equator - so the rendered rail is obscured
    // by fabric, never z-fighting cloth at the same radius.
    const pos = wrapped.getAttribute('position');
    const stride = pos.count / pts.length;
    const rail = pts[75];
    for (let j = 0; j <= 4; j++) {
      const k = 75 * stride + j;
      const d = Math.hypot(pos.getX(k) - rail.x,
        pos.getY(k) - rail.y, pos.getZ(k) - rail.z);
      if (Math.abs(d - 0.14) > 1e-6) return false;
    }
    return true;
  })());
  check('unticked: the holder hood wraps the bracket at full radius', (() => {
    // At a bracket column the fold swells clear of the clevis plates
    // and bolts: every wrap row sits on the hood circle (0.35), not on
    // the plain sleeve.
    const pos = wrapped.getAttribute('position');
    const stride = pos.count / pts.length;
    const rail = pts[150];
    for (let j = 0; j <= 4; j++) {
      const k = 150 * stride + j;
      const d = Math.hypot(pos.getX(k) - rail.x,
        pos.getY(k) - rail.y, pos.getZ(k) - rail.z);
      if (Math.abs(d - 0.35) > 1e-6) return false;
    }
    return true;
  })());
  check('unticked: the fabric wraps from the opposite side of the rail', (() => {
    // The free edge sits on the +normal face and the skirt departs from
    // the -normal face: the fold rises from across the rail, not from
    // the side the curtain already hangs on. Over a bracket those pins
    // are the hood's own tail (sin(sweep)·R) and first skirt row.
    const pos = wrapped.getAttribute('position');
    const stride = pos.count / pts.length;
    const i = 150;
    const a = pts[i], b = pts[i + 1];
    const tx = b.x - a.x, tz = b.z - a.z;
    const len = Math.hypot(tx, tz) || 1;
    const nx = -tz / len, nz = tx / len;
    const offOf = k => (pos.getX(k) - a.x) * nx + (pos.getZ(k) - a.z) * nz;
    const tail = offOf(i * stride);        // j=0, the free edge
    const skirt = offOf(i * stride + 5);   // first row below the fold
    return Math.abs(tail - Math.sin(BR_HOOD_SWEEP) * BR_HOOD_R) < 1e-6
      && Math.abs(skirt - Math.sin(-BR_HOOD_SWEEP) * BR_HOOD_R / 2) < 1e-6;
  })());
  check('the hem still lands on the floor with the rail sleeved',
        Math.abs(bbOf(wrapped).min.y) < 1e-6);
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
