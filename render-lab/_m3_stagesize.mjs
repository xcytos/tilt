// M3: stage-size recalculation check after the origin-extents + front
// furniture band fix. Run from render-lab: node _m3_stagesize.mjs
import * as THREE from 'three';
import fs from 'node:fs';
import { createO2TiltModel } from './o2tilt.js';
import { computeStageSize as labSize } from './ballroom.js';

// scenes.js only imports 'three', but its home js/ has no node_modules -
// stage a copy beside this script so the bare specifier resolves here.
let viewerSize = null;
try {
    fs.copyFileSync(new URL('../js/scenes.js', import.meta.url),
                    new URL('./_scenes_view.mjs', import.meta.url));
    const s = await import('./_scenes_view.mjs');
    viewerSize = s.computeStageSize;
} catch (e) {
    console.log('scenes.js import failed (viewer parity skipped):',
        String(e).slice(0, 160));
}

const SHAPES = [
    ['defaults', {}],
    ['gap10', { gap: 10 }],
    ['decline100', { decline: 100 }],
    ['declineIn100', { declineIn: 100 }],
    ['pitch45', { pitch: 45 }],
    ['pan25', { pan: 25 }],
    ['pan45', { pan: 45 }],
    ['pan90', { pan: 90 }],
];

let bad = 0;
if (!viewerSize) bad++;
for (const [name, params] of SHAPES) {
    const model = createO2TiltModel({ fabric: true, ...params });
    if (typeof model.build === 'function') model.build();
    const rig = model.object3D;
    rig.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(rig);
    const fp = { minX: box.min.x, maxX: box.max.x,
                 minZ: box.min.z, maxZ: box.max.z };
    const size = labSize(fp);
    const vs = viewerSize ? viewerSize(fp) : null;
    const parity = vs ? (vs.w === size.w && vs.d === size.d) : null;
    if (parity === false) bad++;
    console.log(
        `${name.padEnd(13)} fp x[${fp.minX.toFixed(2)},${fp.maxX.toFixed(2)}]`
        + ` z[${fp.minZ.toFixed(2)},${fp.maxZ.toFixed(2)}]`
        + ` -> lab ${size.w}x${size.d}`
        + (vs ? ` viewer ${vs.w}x${vs.d} parity=${parity}` : ' (no viewer)'));
}
console.log(bad === 0 ? 'PARITY OK (lab == viewer for every shape)'
                      : `PARITY FAIL x${bad}`);
process.exit(bad === 0 ? 0 : 1);
