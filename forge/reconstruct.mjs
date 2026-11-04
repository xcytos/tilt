import * as THREE from '../render-lab/vendor/three160.js';
import { createO2TiltModel } from '../render-lab/o2tilt.js';
import { buildBallroom, computeStageSize } from '../render-lab/ballroom.js';
import { OBJExporter } from '../render-lab/vendor/OBJExporter.js';
import fs from 'node:fs';

const [payloadPath, outDir] = process.argv.slice(2);
const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
const scene = payload.scene || 'ballroom';

let size = payload.size;
const root = new THREE.Group();

if (scene === 'scurve') {
    const model = createO2TiltModel({ fabric: true });
    if (typeof model.build === 'function') model.build();
    const rig = model.object3D;
    rig.updateMatrixWorld(true);
    let rc = 0;
    rig.traverse((o) => {
        if (o.isMesh && o.geometry?.attributes?.position) {
            rc++;
            const c = o.material?.color ? o.material.color.getHexString() : 'unknown';
            if (!o.name) o.name = `${c}-${rc}`;
        }
    });
    root.add(rig);
    size = size || null; // studio profile has its own room conventions
} else {
    const model = createO2TiltModel({ fabric: true });
    if (typeof model.build === 'function') model.build();
    const rig = model.object3D;
    rig.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(rig);
    const fp = size ? null : {
        minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z
    };
    size = size || computeStageSize(fp);
    let rc = 0;
    rig.traverse((o) => {
        if (o.isMesh && o.geometry?.attributes?.position) {
            rc++;
            const c = o.material?.color ? o.material.color.getHexString() : 'unknown';
            if (!o.name) o.name = `${c}-${rc}`;
        }
    });
    root.add(rig);
    const { lamps, mood } = buildBallroom(root, size);
    let i = 0;
    root.traverse((o) => {
        if (o.isMesh && o.geometry?.attributes?.position) {
            if (o.userData.n !== undefined) o.name = `${o.name}-${o.userData.n}`;
            if (!o.name) o.name = `m-${i++}`;
        }
    });
    fs.writeFileSync(outDir.endsWith('/') ? outDir + 'scene_data.json' : outDir + '\\scene_data.json',
        JSON.stringify({ scene, size, lamps, mood }, null, 2));
    console.log('scene_data.json written, lamps:', lamps.length);
}

let meshes = 0, tris = 0;
root.traverse((o) => {
    if (o.isMesh && o.geometry?.attributes?.position) {
        meshes++;
        const t = (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
        tris += t;
        if (!o.name) o.name = `m-${meshes}`;
        else o.name = o.name.replace(/\s+/g, '_');
    }
});

const obj = new OBJExporter().parse(root);
const objPath = outDir.endsWith('/') ? outDir + 'scene.obj' : outDir + '\\scene.obj';
fs.writeFileSync(objPath, obj, 'utf8');
console.log(`forge reconstruct: scene=${scene} meshes=${meshes} tris=${tris} obj=${objPath}`);
if (scene !== 'ballroom') {
    // neutral studio fallback data so render_ballroom.py can still run (no lamps)
    fs.writeFileSync(outDir.endsWith('/') ? outDir + 'scene_data.json' : outDir + '\\scene_data.json',
        JSON.stringify({ scene, size: size || null, lamps: [], mood: {
            background: 0xefe6d6,
            ambient: { color: 0xfff6ea, intensity: 0.65 },
            key: { color: 0xfff2e0, intensity: 1.25 },
            fill: { color: 0xffe9cf, intensity: 0.4 } } }, null, 2));
}
