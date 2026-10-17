import * as THREE from './vendor/three160.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DECOR = path.resolve(HERE, '..');

const src = fs.readFileSync(path.join(DECOR, 'js/viewer.js'), 'utf8');

function extract(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error('not found: ' + name);
  let i = src.indexOf('{', start), depth = 0, j = i;
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) { j++; break; } }
  }
  return src.slice(start, j);
}

const dirLine = /const FRAME_DIR = [^\n]+/.exec(src)[0];
const body = dirLine + '\n' + extract('frameCamera');

const frameCamera = new Function('THREE', `${body}; return frameCamera;`)(THREE);

let fails = 0;
function check(label, cond, extra = '') {
  if (cond) console.log('  ok   ' + label);
  else { fails++; console.log('  FAIL ' + label + (extra ? '  ' + extra : '')); }
}

// Conservative world AABB of the curtain system for a given UI state
function boundsFor(ui) {
  const panRad = ui.pan * Math.PI / 180, pitchRad = ui.pitch * Math.PI / 180;
  const halfX = ui.gap / 2 + 12 * Math.cos(panRad) + 1 * Math.sin(panRad);
  const halfZ = 12 * Math.sin(panRad) + 1.3 * Math.cos(panRad);
  const topY = 8 + Math.sin(pitchRad) + 0.4;
  const c = new THREE.Vector3(0, topY / 2, 0);
  return new THREE.Box3(
    new THREE.Vector3(c.x - halfX, 0, c.z - halfZ),
    new THREE.Vector3(c.x + halfX, topY, c.z + halfZ));
}

function aim(aspect, bounds) {
  const camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
  const controls = { target: new THREE.Vector3(), update() { camera.lookAt(this.target); } };
  frameCamera(camera, controls, bounds);
  camera.updateMatrixWorld(true);
  return { camera, controls };
}

console.log('\nframeCamera: does the whole structure fit in the frustum?');
const aspects = [0.40, 0.45, 0.46, 0.60, 1.0, 1.33, 1.78, 2.4];
const uis = [
  { gap: 3, pan: 0, pitch: 0, label: 'defaults' },
  { gap: 6, pan: 0, pitch: 0, label: 'gap 6' },
  { gap: 3, pan: 45, pitch: 20, label: 'pan45 pitch20' },
  { gap: 6, pan: 90, pitch: 20, label: 'worst case' },
];

for (const ui of uis) {
  const bounds = boundsFor(ui);
  for (const aspect of aspects) {
    const { camera, controls } = aim(aspect, bounds);
    const frustum = new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));

    let outside = 0;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      const p = new THREE.Vector3(
        sx < 0 ? bounds.min.x : bounds.max.x,
        sy < 0 ? bounds.min.y : bounds.max.y,
        sz < 0 ? bounds.min.z : bounds.max.z);
      if (!frustum.containsPoint(p)) outside++;
    }
    const dist = camera.position.distanceTo(controls.target);
    check(`${ui.label.padEnd(15)} aspect ${aspect.toFixed(2)}  dist ${dist.toFixed(1).padStart(5)}  corners in frustum`,
          outside === 0, `(${outside}/8 outside)`);
  }
}

console.log('\nframeCamera: sanity');
{
  const d = a => { const b = boundsFor({ gap: 3, pan: 0, pitch: 0 }); const r = aim(a, b);
    return r.camera.position.distanceTo(r.controls.target); };
  const portrait = d(0.45), desktop = d(1.78);
  check(`portrait pulls back further than desktop (${portrait.toFixed(1)} > ${desktop.toFixed(1)})`, portrait > desktop);
  check(`desktop distance close to the original 25 (${desktop.toFixed(1)})`, desktop > 15 && desktop < 32);

  const b = boundsFor({ gap: 3, pan: 0, pitch: 0 });
  const { camera, controls } = aim(0.45, b);
  check('view direction preserved (same X, above target, behind target)',
        Math.abs(camera.position.x - controls.target.x) < 1e-6 &&
        camera.position.y > controls.target.y &&
        camera.position.z < controls.target.z);
}

console.log('\nframeCamera: multi-model (union of two boxes)');
{
  const a = boundsFor({ gap: 3, pan: 0, pitch: 0 });
  const b = boundsFor({ gap: 6, pan: 90, pitch: 20 });
  const union = a.clone().union(b);
  const { camera, controls } = aim(0.45, union);
  const frustum = new THREE.Frustum().setFromProjectionMatrix(
    new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  let outside = 0;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const p = new THREE.Vector3(sx < 0 ? union.min.x : union.max.x,
                                sy < 0 ? union.min.y : union.max.y,
                                sz < 0 ? union.min.z : union.max.z);
    if (!frustum.containsPoint(p)) outside++;
  }
  check(`union framed on portrait (${outside}/8 outside)`, outside === 0);
}

console.log(fails === 0 ? '\nALL CHECKS PASSED' : `\n${fails} CHECK(S) FAILED`);
process.exit(fails ? 1 : 0);
