import * as THREE from 'three';
import { createO2TiltModel, PARAMS } from './o2tilt.js';
import { buildBallroom, computeStageSize } from './ballroom.js';
import { OBJExporter } from './vendor/OBJExporter.js';
import fs from 'node:fs';
import path from 'node:path';

// Usage: node export_ballroom.mjs [params.json] [dataOut.json]
//   params.json  -> Shape params for createO2TiltModel (fabric always on);
//                   same validation as scurve_params.mjs. Omitted = defaults.
//   dataOut.json -> where ballroom_data.json lands (default ./out/ballroom_data.json)
//                   so a forge regen can stage data next to the candidate blend.
const paramsPath = process.argv[2];
const dataOut = process.argv[3] || './out/ballroom_data.json';

const opts = { fabric: true };
if (paramsPath) {
    const raw = JSON.parse(fs.readFileSync(paramsPath, 'utf8'));
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new Error('params file must be a JSON object');
    }
    for (const [k, v] of Object.entries(raw)) {
        if (k === 'fabric') continue;           // curtains always on
        if (!(k in PARAMS)) throw new Error('unknown param: ' + k);
        let val = v;
        if (k === 'lobeGaps' && typeof val === 'number') {
            val = Array(PARAMS.lobeGaps.count || 11).fill(val);
        }
        if (typeof val !== typeof PARAMS[k].value
            && !(PARAMS[k].type === 'lobeGaps' && Array.isArray(val))) {
            throw new Error(`param ${k}: expected ${typeof PARAMS[k].value}, got ${typeof val}`);
        }
        opts[k] = val;
    }
}

// S-curve rig (untouched geometry) + ballroom room around it
const model = createO2TiltModel(opts);
if (typeof model.build === 'function') model.build();
const rig = model.object3D;
rig.updateMatrixWorld(true);

// stage size from the rig footprint (computeStageSize parity)
const box = new THREE.Box3().setFromObject(rig);
console.log('rig footprint ft:', JSON.stringify({
    minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z
}));
const size = computeStageSize({
    minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z
});
console.log('stage size:', JSON.stringify(size));

const root = new THREE.Group();
root.name = 'root';
root.add(rig);

// rename rig meshes by material color (P-004 convention) so render.py maps them
let rc = 0;
rig.traverse((o) => {
    if (o.isMesh && o.geometry && o.geometry.attributes && o.geometry.attributes.position) {
        rc++;
        const c = o.material && o.material.color ? o.material.color.getHexString() : 'unknown';
        if (!o.name) o.name = `${c}-${rc}`;
    }
});
console.log('rig meshes named:', rc);

const { lamps, mood } = buildBallroom(root, size);
let meshes = 0, tris = 0;
root.traverse((o) => {
    if (o.isMesh && o.geometry && o.geometry.attributes && o.geometry.attributes.position) {
        meshes++;
        const t = (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
        tris += t;
        if (o.userData.n !== undefined) o.name = `${o.name}-${o.userData.n}`;
        const wp = new THREE.Vector3();
        o.getWorldPosition(wp);
        const wb = new THREE.Box3().setFromObject(o);
        if (!o.name) console.log('UNNAMED!', meshes, o.geometry.type);
        if (Math.abs(wp.x) < 2 && (o.geometry.type === 'BufferGeometry' || o.geometry.type === 'TubeGeometry')) {
            console.log(`center-lane candidate: name='${o.name}' geo=${o.geometry.type} z=${wp.z.toFixed(1)} y=${wp.y.toFixed(1)} dims=${JSON.stringify(wb.getSize(new THREE.Vector3()).toArray().map(v => +v.toFixed(1)))}`);
        }
    }
});
console.log(`meshes=${meshes} tris=${tris}`);

const exporter = new OBJExporter();
const obj = exporter.parse(root);
fs.writeFileSync('./out/ballroom.obj', obj, 'utf8');
console.log('wrote out/ballroom.obj bytes=' + obj.length);

fs.mkdirSync(path.dirname(path.resolve(dataOut)), { recursive: true });
fs.writeFileSync(dataOut, JSON.stringify({ size, lamps, mood }, null, 2), 'utf8');
console.log('wrote ' + dataOut);
