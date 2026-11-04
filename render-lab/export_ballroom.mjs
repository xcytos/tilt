import * as THREE from 'three';
import { createO2TiltModel } from './o2tilt.js';
import { buildBallroom, computeStageSize } from './ballroom.js';
import { OBJExporter } from './vendor/OBJExporter.js';
import fs from 'node:fs';

// S-curve rig (untouched geometry) + ballroom room around it
const model = createO2TiltModel({ fabric: true });
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

fs.writeFileSync('./out/ballroom_data.json', JSON.stringify({ size, lamps, mood }, null, 2), 'utf8');
console.log('wrote out/ballroom_data.json');
