// Software room renderer: no WebGL, no browser. Walks SceneRig's scene
// graph, rasterizes triangles with a z-buffer and a lambert-ish shader
// (ambient + key/fill directionals + point lamps + emissive, ACES-ish
// tonemap), and writes PNGs to tests/.tmp/renders/ that the agent can
// read and analyse directly.
//
//   node tools/render-rooms.mjs [scene-id ...]
//
// Fidelity note: canvas textures need a 2D canvas this environment
// doesn't have, so surfaces render at their base colour - geometry,
// placement, lighting balance and emissives are exact, texture pattern
// detail is not.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = path.join(ROOT, 'tests/vendor/three160.js');
const OUT = path.join(ROOT, 'tests/.tmp/renders');

// ---------------------------------------------------------------- PNG
const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        t[n] = c >>> 0;
    }
    return t;
})();

function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'ascii');
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
}

function writePng(file, w, h, rgb) {
    const raw = Buffer.alloc(h * (1 + w * 3));
    for (let y = 0; y < h; y++) {
        raw[y * (1 + w * 3)] = 0;
        Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3)
            .copy(raw, y * (1 + w * 3) + 1);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0);
    ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8;
    ihdr[9] = 2;                          // 8-bit RGB
    const png = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        pngChunk('IHDR', ihdr),
        pngChunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
        pngChunk('IEND', Buffer.alloc(0))
    ]);
    fs.writeFileSync(file, png);
}

// ------------------------------------------------------------- three
const scenesSrc = fs.readFileSync(path.join(ROOT, 'js/scenes.js'), 'utf8')
    .replace("from 'three'", `from '${pathToFileURL(VENDOR).href}'`);
const tmp = path.join(ROOT, 'tests/.tmp/scenes.render.mjs');
fs.writeFileSync(tmp, scenesSrc);
const THREE = await import(pathToFileURL(VENDOR).href);
const scenes = await import(pathToFileURL(tmp).href);

// ------------------------------------------------------------- shader
const ACES = (x) => (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
const srgb = (c) => Math.max(0, Math.min(255, Math.round(
    Math.pow(Math.max(0, ACES(c)), 1 / 2.2) * 255)));

function gatherLights(scene) {
    const amb = { r: 0, g: 0, b: 0 };
    const dirs = [];
    const points = [];
    let shadowCaster = null;
    scene.traverse((o) => {
        if (o.isAmbientLight) {
            amb.r += o.color.r * o.intensity;
            amb.g += o.color.g * o.intensity;
            amb.b += o.color.b * o.intensity;
        } else if (o.isDirectionalLight) {
            if (o.castShadow && !shadowCaster) shadowCaster = o;
            const dir = new THREE.Vector3()
                .subVectors(o.target.position, o.position).normalize();
            dirs.push({
                dir,
                r: o.color.r * o.intensity,
                g: o.color.g * o.intensity,
                b: o.color.b * o.intensity,
                casts: false
            });
        } else if (o.isPointLight) {
            points.push({
                pos: new THREE.Vector3().setFromMatrixPosition(o.matrixWorld),
                r: o.color.r * o.intensity,
                g: o.color.g * o.intensity,
                b: o.color.b * o.intensity,
                dist: o.distance || Infinity
            });
        }
    });
    if (shadowCaster) {
        for (const d of dirs) {
            // same direction = the caster
            if (d.dir.dot(new THREE.Vector3()
                .subVectors(shadowCaster.target.position, shadowCaster.position)
                .normalize()) > 0.999) d.casts = true;
        }
    }
    return { amb, dirs, points, shadowCaster };
}

// Depth-only pass from the key light: an orthographic map the size of
// the viewer's shadow box (±56, near 2, far 160). Static scenes mean
// this runs once per room, not per view.
function rasterDepth(scene, light, S) {
    scene.updateMatrixWorld(true);
    const cam = new THREE.OrthographicCamera(-56, 56, 56, -56, 2, 160);
    cam.position.copy(light.position);
    cam.lookAt(light.target.position);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    const vp = new THREE.Matrix4()
        .multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    const depth = new Float32Array(S * S).fill(Infinity);

    const mvp = new THREE.Matrix4();
    const inst = new THREE.Matrix4();
    const v4 = new THREE.Vector4();
    const meshes = [];
    scene.traverse((o) => { if (o.isMesh || o.isInstancedMesh) meshes.push(o); });

    for (const mesh of meshes) {
        if (mesh.userData && mesh.userData.noShadow) continue;
        if (mesh.material && mesh.material.transparent
            && mesh.material.opacity < 0.5) continue;   // glass panes
        const geo = mesh.geometry;
        const posA = geo.attributes.position;
        if (!posA) continue;
        const idx = geo.index ? geo.index.array : null;
        const instCount = mesh.isInstancedMesh ? mesh.count : 1;
        for (let ii = 0; ii < instCount; ii++) {
            if (mesh.isInstancedMesh) {
                mesh.getMatrixAt(ii, inst);
                inst.premultiply(mesh.matrixWorld);
            } else {
                inst.copy(mesh.matrixWorld);
            }
            mvp.multiplyMatrices(vp, inst);
            const vc = posA.count;
            const sx = new Float64Array(vc), sy = new Float64Array(vc);
            const sz = new Float64Array(vc);
            const ok = new Uint8Array(vc);
            for (let vi = 0; vi < vc; vi++) {
                v4.set(posA.getX(vi), posA.getY(vi), posA.getZ(vi), 1)
                    .applyMatrix4(mvp);
                if (v4.w > 0) {
                    ok[vi] = 1;
                    const inv = 1 / v4.w;
                    sx[vi] = (v4.x * inv * 0.5 + 0.5) * S;
                    sy[vi] = (1 - (v4.y * inv * 0.5 + 0.5)) * S;
                    sz[vi] = v4.z * inv * 0.5 + 0.5;
                }
            }
            const triCount = idx ? idx.length / 3 : Math.floor(vc / 3);
            for (let t = 0; t < triCount; t++) {
                const a = idx ? idx[t * 3] : t * 3;
                const b = idx ? idx[t * 3 + 1] : t * 3 + 1;
                const c = idx ? idx[t * 3 + 2] : t * 3 + 2;
                if (!ok[a] || !ok[b] || !ok[c]) continue;
                const ax = sx[a], ay = sy[a], az = sz[a];
                const bx = sx[b], by = sy[b], bz = sz[b];
                const cx = sx[c], cy = sy[c], cz = sz[c];
                const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
                if (area === 0) continue;
                const invArea = 1 / area;
                const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
                const maxX = Math.min(S - 1, Math.ceil(Math.max(ax, bx, cx)));
                const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
                const maxY = Math.min(S - 1, Math.ceil(Math.max(ay, by, cy)));
                for (let py = minY; py <= maxY; py++) {
                    for (let px = minX; px <= maxX; px++) {
                        const X = px + 0.5, Y = py + 0.5;
                        const ea = ((cx - bx) * (Y - by) - (cy - by) * (X - bx)) * invArea;
                        const eb = ((ax - cx) * (Y - cy) - (ay - cy) * (X - cx)) * invArea;
                        const ec = 1 - ea - eb;
                        if (ea < 0 || eb < 0 || ec < 0) continue;
                        const z = ea * az + eb * bz + ec * cz;
                        const pi = py * S + px;
                        if (z < depth[pi]) depth[pi] = z;
                    }
                }
            }
        }
    }
    return { vp, tex: depth, S };
}

function renderView(scene, camera, w, h, shadow) {
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    const vp = new THREE.Matrix4()
        .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const camPos = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    const { amb, dirs, points } = gatherLights(scene);

    const img = new Uint8Array(w * h * 3);
    const zbuf = new Float32Array(w * h).fill(Infinity);
    let bg = { r: 0.05, g: 0.06, b: 0.08 };
    if (scene.background && scene.background.isColor) {
        bg = { r: scene.background.r, g: scene.background.g, b: scene.background.b };
    }
    for (let i = 0; i < w * h; i++) {
        img[i * 3] = srgb(bg.r);
        img[i * 3 + 1] = srgb(bg.g);
        img[i * 3 + 2] = srgb(bg.b);
    }

    const meshes = [];
    scene.traverse((o) => { if (o.isMesh || o.isInstancedMesh) meshes.push(o); });

    const mvp = new THREE.Matrix4();
    const nMat = new THREE.Matrix3();
    const inst = new THREE.Matrix4();
    const v4 = new THREE.Vector4();
    const tmpV = new THREE.Vector3();
    const view = new THREE.Vector3();

    // 1 = lit, 0 = occluded from the key light. Same ortho box and bias
    // feel as the viewer's PCF map, minus the filtering.
    const shadowAt = (p) => {
        v4.set(p.x, p.y, p.z, 1).applyMatrix4(shadow.vp);
        if (v4.w <= 0) return 1;
        const u = (v4.x / v4.w) * 0.5 + 0.5;
        const v = (v4.y / v4.w) * 0.5 + 0.5;
        const z = (v4.z / v4.w) * 0.5 + 0.5;
        if (u < 0 || u > 1 || v < 0 || v > 1) return 1;
        const px = Math.min(shadow.S - 1, Math.max(0, Math.floor(u * shadow.S)));
        const py = Math.min(shadow.S - 1, Math.max(0, Math.floor(v * shadow.S)));
        const d = shadow.tex[py * shadow.S + px];
        return (z - 0.0025) > d ? 0 : 1;
    };

    const shade = (mat, p, nx, ny, nz, out) => {
        view.subVectors(camPos, p).normalize();
        let ax = nx, ay = ny, az = nz;
        if (ax * view.x + ay * view.y + az * view.z < 0) {
            ax = -ax; ay = -ay; az = -az;               // two-sided lighting
        }
        let r = amb.r, g = amb.g, b = amb.b;
        for (const d of dirs) {
            const nd = Math.max(0, ax * d.dir.x + ay * d.dir.y + az * d.dir.z);
            if (nd <= 0) continue;
            const lit = d.casts && shadow ? shadowAt(p) : 1;
            r += d.r * nd * lit;
            g += d.g * nd * lit;
            b += d.b * nd * lit;
        }
        for (const L of points) {
            const dx = L.pos.x - p.x, dy = L.pos.y - p.y, dz = L.pos.z - p.z;
            const d2 = dx * dx + dy * dy + dz * dz;
            const dist = Math.sqrt(d2);
            if (dist > L.dist || dist < 1e-4) continue;
            const nd = Math.max(0, (ax * dx + ay * dy + az * dz) / dist);
            const att = 1 / (1 + d2);               // decay-2, like the lamps
            r += L.r * nd * att;
            g += L.g * nd * att;
            b += L.b * nd * att;
        }
        const c = mat.color;
        const e = mat.emissive;
        const ei = mat.emissiveIntensity !== undefined ? mat.emissiveIntensity : 1;
        out[0] = c.r * r + (e ? e.r * ei : 0);
        out[1] = c.g * g + (e ? e.g * ei : 0);
        out[2] = c.b * b + (e ? e.b * ei : 0);
    };

    const col = [0, 0, 0];
    let tris = 0;

    for (const mesh of meshes) {
        const geo = mesh.geometry;
        const posA = geo.attributes.position;
        const norA = geo.attributes.normal;
        if (!posA) continue;
        const idx = geo.index ? geo.index.array : null;
        const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        if (!mat || !mat.color) continue;
        const instCount = mesh.isInstancedMesh ? mesh.count : 1;

        for (let ii = 0; ii < instCount; ii++) {
            if (mesh.isInstancedMesh) {
                mesh.getMatrixAt(ii, inst);
                inst.premultiply(mesh.matrixWorld);
            } else {
                inst.copy(mesh.matrixWorld);
            }
            mvp.multiplyMatrices(vp, inst);
            nMat.getNormalMatrix(inst);

            const vc = posA.count;
            const sx = new Float64Array(vc), sy = new Float64Array(vc), sz = new Float64Array(vc);
            const ok = new Uint8Array(vc);
            const wx = new Float64Array(vc), wy = new Float64Array(vc), wz = new Float64Array(vc);
            const nx = new Float64Array(vc), ny = new Float64Array(vc), nz = new Float64Array(vc);

            for (let vi = 0; vi < vc; vi++) {
                const px = posA.getX(vi), py = posA.getY(vi), pz = posA.getZ(vi);
                v4.set(px, py, pz, 1).applyMatrix4(mvp);
                if (v4.w > 0) {
                    ok[vi] = 1;
                    const inv = 1 / v4.w;
                    sx[vi] = (v4.x * inv * 0.5 + 0.5) * w;
                    sy[vi] = (1 - (v4.y * inv * 0.5 + 0.5)) * h;
                    sz[vi] = v4.z * inv * 0.5 + 0.5;
                }
                tmpV.set(px, py, pz).applyMatrix4(inst);
                wx[vi] = tmpV.x; wy[vi] = tmpV.y; wz[vi] = tmpV.z;
                if (norA) {
                    tmpV.set(norA.getX(vi), norA.getY(vi), norA.getZ(vi))
                        .applyMatrix3(nMat).normalize();
                    nx[vi] = tmpV.x; ny[vi] = tmpV.y; nz[vi] = tmpV.z;
                }
            }

            const triCount = idx ? idx.length / 3 : Math.floor(vc / 3);
            for (let t = 0; t < triCount; t++) {
                const a = idx ? idx[t * 3] : t * 3;
                const b = idx ? idx[t * 3 + 1] : t * 3 + 1;
                const c = idx ? idx[t * 3 + 2] : t * 3 + 2;
                if (!ok[a] || !ok[b] || !ok[c]) continue;

                const ax = sx[a], ay = sy[a], az = sz[a];
                const bx = sx[b], by = sy[b], bz = sz[b];
                const cx = sx[c], cy = sy[c], cz = sz[c];
                const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
                if (area === 0) continue;
                tris++;

                const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
                const maxX = Math.min(w - 1, Math.ceil(Math.max(ax, bx, cx)));
                const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
                const maxY = Math.min(h - 1, Math.ceil(Math.max(ay, by, cy)));
                if (minX > maxX || minY > maxY) continue;

                // Barycentric via edge functions; weights land on a, b, c.
                const invArea = 1 / area;

                for (let py = minY; py <= maxY; py++) {
                    for (let px = minX; px <= maxX; px++) {
                        const X = px + 0.5, Y = py + 0.5;
                        // weight of A is signed area of PBC, of B of
                        // PCA, of C of PAB, all over ABC.
                        const ea = ((cx - bx) * (Y - by) - (cy - by) * (X - bx)) * invArea;
                        const eb = ((ax - cx) * (Y - cy) - (ay - cy) * (X - cx)) * invArea;
                        const ec = 1 - ea - eb;
                        if (ea < 0 || eb < 0 || ec < 0) continue;
                        const z = ea * az + eb * bz + ec * cz;
                        const pi = py * w + px;
                        if (z >= zbuf[pi]) continue;
                        zbuf[pi] = z;
                        // per-fragment world position and normal, so the
                        // shadow test lands where the viewer's would
                        const px3 = ea * wx[a] + eb * wx[b] + ec * wx[c];
                        const py3 = ea * wy[a] + eb * wy[b] + ec * wy[c];
                        const pz3 = ea * wz[a] + eb * wz[b] + ec * wz[c];
                        const nnx = ea * nx[a] + eb * nx[b] + ec * nx[c];
                        const nny = ea * ny[a] + eb * ny[b] + ec * ny[c];
                        const nnz = ea * nz[a] + eb * nz[b] + ec * nz[c];
                        shade(mat, { x: px3, y: py3, z: pz3 }, nnx, nny, nnz, col);
                        img[pi * 3] = srgb(col[0]);
                        img[pi * 3 + 1] = srgb(col[1]);
                        img[pi * 3 + 2] = srgb(col[2]);
                    }
                }
            }
        }
    }
    return { img, tris };
}

// -------------------------------------------------------------- driver
const size = Object.assign({}, scenes.DEFAULT_STAGE_SIZE);

function views(s) {
    return [
        { name: 'house', pos: [0, 15, -(s.d / 2 + 30)], look: [0, 4, 0] },
        { name: 'stage', pos: [0, 5.5, 6], look: [0, 2.5, -(s.d / 2 + 22)] },
        { name: 'aisle', pos: [0, 5, -(s.d / 2 + 20)], look: [0, 3, 2] },
        { name: 'wall', pos: [s.wallX - 7, 9, -s.d / 2 - 4],
          look: [-s.wallX * 0.4, 4, -s.d / 2 - 8] }
    ];
}

const W = 640, H = 360;
const ALL = ['white-stage', 'ballroom', 'garden-night', 'terrace'];
const wanted = process.argv.slice(2).filter((a) => ALL.includes(a));
const rooms = wanted.length ? wanted : ALL;

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const cam = new THREE.PerspectiveCamera(50, W / H, 0.1, 500);

for (const id of rooms) {
    const scene = new THREE.Scene();
    const rig = new scenes.SceneRig();
    scene.add(rig.group);
    const s = rig.build(id, Object.assign({}, size));
    if (s) {
        scene.background = s.background;
        scene.fog = s.fog ? new THREE.Fog(s.fog.color, s.fog.near, s.fog.far) : null;
    }
    // Viewer light rig, so the render matches what the app shows.
    scene.add(new THREE.AmbientLight(
        s ? s.ambient.color : 0xffffff, s ? s.ambient.intensity : 0.8));
    const key = new THREE.DirectionalLight(
        s ? s.key.color : 0xffffff, s ? s.key.intensity : 1.5);
    key.position.set(15, 25, -20);
    key.castShadow = true;                 // viewer parity: key casts
    scene.add(key);
    const fill = new THREE.DirectionalLight(
        s ? s.fill.color : 0xffffff, s ? s.fill.intensity : 0.5);
    fill.position.set(-15, 10, 20);
    scene.add(fill);
    // One shadow map per room (the scene is static across views).
    const shadowMap = rasterDepth(scene, key, 1024);

    // Inventory: what the room actually contains.
    let meshes = 0, instanced = 0, instParts = 0, lamps = 0;
    scene.traverse((o) => {
        if (o.isInstancedMesh) { instanced++; instParts += o.count; meshes++; }
        else if (o.isMesh) meshes++;
        else if (o.isPointLight) lamps++;
    });
    console.log(`${id}: ${meshes} meshes (${instanced} instanced, `
        + `${instParts} parts), ${lamps} point lights`);

    for (const v of views(size)) {
        cam.position.set(v.pos[0], v.pos[1], v.pos[2]);
        cam.lookAt(v.look[0], v.look[1], v.look[2]);
        const { img, tris } = renderView(scene, cam, W, H, shadowMap);
        const file = path.join(OUT, `${id}-${v.name}.png`);
        writePng(file, W, H, img);
        console.log(`  ${id}-${v.name}.png  ${tris} tris  `
            + `${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
    }
}
console.log(`\nwrote ${rooms.length * 4} PNGs to tests/.tmp/renders/`);
