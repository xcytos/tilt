// S-curve shape params -> rig-only OBJ (delta-update input for render-lab).
// Single source of truth for the shape is o2tilt.js createO2TiltModel;
// this wrapper is what forge and the Render Studio UI call.
//
// Usage:
//   node scurve_params.mjs --dump
//       -> JSON {params: {key: {label,type,min,max,step,value,unit,advanced}},
//                blend: {exists,size,mtime,version}}
//   node scurve_params.mjs <params.json> <out.obj>
//       -> builds the rig (fabric always on), writes the OBJ, prints one
//          SCURFE_JSON line with mesh/tri/fabric counts + blend version.
//
// Naming follows export_ballroom.mjs exactly: every rig mesh is counted,
// only unnamed meshes get `<hex>-<n>` (the fabric panels land on
// ffffff-129/130), named stand-* meshes keep their names so
// render_ballroom.py's material loop (and update_scurve.py's copy of it)
// applies the same wall_* fallback as the full build.
import * as THREE from 'three';
import { createO2TiltModel, PARAMS } from './o2tilt.js';
import { OBJExporter } from './vendor/OBJExporter.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LAB = path.dirname(fileURLToPath(import.meta.url));
const BLEND = path.join(LAB, 'out', 'ballroom_scene.blend');
const FABRIC_KEY = 'fabric'; // render-lab always builds the curtains

function blendInfo() {
    try {
        const st = fs.statSync(BLEND);
        const sha = crypto.createHash('sha256')
            .update(fs.readFileSync(BLEND)).digest('hex').slice(0, 12);
        return { exists: true, size: st.size, mtime: st.mtimeMs, version: sha };
    } catch {
        return { exists: false };
    }
}

function dump() {
    const params = {};
    for (const [k, m] of Object.entries(PARAMS)) {
        params[k] = JSON.parse(JSON.stringify(m));
    }
    process.stdout.write(JSON.stringify({ params, blend: blendInfo() }));
}

function build(pfile, outobj) {
    const raw = JSON.parse(fs.readFileSync(pfile, 'utf8'));
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new Error('params file must be a JSON object');
    }
    const params = {};
    const unknown = [];
    for (const [k, v] of Object.entries(raw)) {
        if (k === FABRIC_KEY) continue;            // curtains always on
        if (!(k in PARAMS)) { unknown.push(k); continue; }
        let val = v;
        if (k === 'lobeGaps' && typeof val === 'number') {
            val = Array(PARAMS.lobeGaps.count || 11).fill(val);
        }
        if (typeof val !== typeof PARAMS[k].value
            && !(PARAMS[k].type === 'lobeGaps' && Array.isArray(val))) {
            throw new Error(`param ${k}: expected ${typeof PARAMS[k].value}, got ${typeof val}`);
        }
        params[k] = val;
    }

    const model = createO2TiltModel({ fabric: true, ...params });
    if (typeof model.build === 'function') model.build();
    const scene = model.object3D;
    scene.updateMatrixWorld(true);

    // export_ballroom.mjs naming: count every rig mesh, rename only the
    // unnamed ones so stand-* keeps its names (render_ballroom parity).
    let rc = 0;
    const fabrics = [];
    scene.traverse((o) => {
        if (o.isMesh && o.geometry && o.geometry.attributes
            && o.geometry.attributes.position) {
            rc++;
            const c = o.material && o.material.color
                ? o.material.color.getHexString() : 'unknown';
            if (!o.name) o.name = `${c}-${rc}`;
            if (/^ffffff-\d+$/.test(o.name)) fabrics.push(o.name);
        }
    });
    if (fabrics.length !== 2) {
        throw new Error('expected 2 fabric drape panels, got ' + fabrics.length);
    }

    scene.updateMatrixWorld(true);
    const exporter = new OBJExporter();
    const obj = exporter.parse(scene);
    fs.writeFileSync(outobj, obj, 'utf8');

    let tris = 0;
    scene.traverse((o) => {
        if (o.isMesh && o.geometry && o.geometry.attributes
            && o.geometry.attributes.position) {
            tris += (o.geometry.index ? o.geometry.index.count
                : o.geometry.attributes.position.count) / 3;
        }
    });
    process.stdout.write(JSON.stringify({
        obj: outobj, bytes: Buffer.byteLength(obj), meshes: rc, tris,
        fabrics: fabrics.sort(),
        params: Object.keys(params), unknown,
        blend: blendInfo()
    }));
}

const argv = process.argv.slice(2);
if (argv[0] === '--dump') {
    dump();
} else if (argv.length === 2) {
    try {
        build(path.resolve(argv[0]), path.resolve(argv[1]));
    } catch (e) {
        console.error(String(e && e.stack || e));
        process.exit(1);
    }
} else {
    console.error('usage: node scurve_params.mjs --dump | <params.json> <out.obj>');
    process.exit(2);
}
