import * as THREE from 'three';
import { createO2TiltModel } from './o2tilt.js';
import { OBJExporter } from './vendor/OBJExporter.js';
import fs from 'node:fs';

const model = createO2TiltModel({ fabric: true });
if (typeof model.build === 'function') model.build();
const scene = model.object3D;
scene.updateMatrixWorld(true);

let meshes = 0, tris = 0;
const named = [];
scene.traverse((o) => {
  if (o.isMesh && o.geometry && o.geometry.attributes && o.geometry.attributes.position) {
    meshes++;
    const t = (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
    tris += t;
    const c = o.material && o.material.color ? o.material.color.getHexString() : 'unknown';
    o.name = `${c}-${meshes}`;
    named.push(`${o.name} [${o.geometry.type}] tris=${t}`);
  }
});
console.log(`meshes=${meshes} tris=${tris}`);
console.log(named.join('\n'));

const exporter = new OBJExporter();
const obj = exporter.parse(scene);
fs.writeFileSync('./out/scurve.obj', obj, 'utf8');
console.log('wrote out/scurve.obj bytes=' + obj.length);
