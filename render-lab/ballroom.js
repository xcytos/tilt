import * as THREE from 'three';

// Parameter-faithful reconstruction of the TILT "Ballroom Stage" scene
// (js/scenes.js -> buildBallroom path). Product code is read-only; this
// file is agent-side tooling in render-lab. All sizes in FEET, stage
// drops below y=0 exactly like the original (model ground stays at y=0).

export const DEFAULT_STAGE_SIZE = { w: 60, d: 16, h: 1.2, wallX: 30, wallZ: 16, wallH: 26 };
const SIZE_MARGIN_X = 3.5, SIZE_MARGIN_Z = 3;
const SIZE_W_MIN = 44, SIZE_W_MAX = 140, SIZE_D_MIN = 18, SIZE_D_MAX = 60;
// Front wedding-furniture band - parity with js/scenes.js computeStageSize
// (thrones/sofas clear the rig by ~2 ft, 4.86 ft loveseat depth, 1 ft spare).
const FURN_GAP_Z = 1.99;
const FURN_DEPTH_Z = 4.86;
const FURN_CLEAR_Z = 1;

// Extents measured from the stage CENTRE (the stage is origin-centred) plus
// the front furniture band, so an off-centre rig cannot hang off an edge.
export function computeStageSize(fp) {
    if (!fp || !Number.isFinite(fp.minX) || !Number.isFinite(fp.maxX)
        || !Number.isFinite(fp.minZ) || !Number.isFinite(fp.maxZ)) {
        return { ...DEFAULT_STAGE_SIZE };
    }
    const spanW = (Math.max(Math.abs(fp.minX), Math.abs(fp.maxX)) + SIZE_MARGIN_X) * 2;
    const furnD = -fp.minZ + FURN_GAP_Z + FURN_DEPTH_Z + FURN_CLEAR_Z;
    const spanD = Math.max(Math.max(Math.abs(fp.minZ), Math.abs(fp.maxZ)) + SIZE_MARGIN_Z, furnD) * 2;
    const w = Math.min(SIZE_W_MAX, Math.max(SIZE_W_MIN, Math.ceil(spanW / 2) * 2));
    const d = Math.min(SIZE_D_MAX, Math.max(SIZE_D_MIN, Math.ceil(spanD / 2) * 2));
    return {
        w, d, h: DEFAULT_STAGE_SIZE.h,
        wallX: w / 2 + 8,
        wallZ: Math.max(16, d / 2 + 8),
        wallH: Math.min(40, Math.max(24, Math.round(w / 2.3)))
    };
}

const MAT_T = 0.08;

// sceneMat parity: rough 0.9/env 0.3 by default; emissive as separate key.
function mat(hex, extra) {
    return Object.assign({ hex, roughness: 0.9, metalness: 0, emissive: 0x000000, emissiveIntensity: 0 }, extra || {});
}

function boxShadow(group, label, w, h, d, matSpec, x, y, z) {
    const g = new THREE.BoxGeometry(w, h, d);
    const m = new THREE.MeshStandardMaterial({
        color: matSpec.hex, roughness: matSpec.roughness, metalness: matSpec.metalness,
        emissive: matSpec.emissive, emissiveIntensity: matSpec.emissiveIntensity,
        envMapIntensity: 0.3
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, y, z);
    mesh.name = label;
    group.add(mesh);
    return mesh;
}

function lamp(list, x, y, z, watts, color) {
    list.push({ x, y, z, watts, color });
}

export function buildBallroom(group, size, opts) {
    const lamps = [];
    // slab edge lands 1 ft past the front table rows (-d/2-19), parity with
    // js/scenes.js sceneCofferedCeiling
    const footFront = -(size.d / 2 + 18.5);
    // side walls run to (or past) the front table row at any stage depth
    const wallLen = Math.max(size.wallZ + 28, size.d + 27);

    // sceneRoom: plank ground, cream walls, skirt volume, carpet on the stage
    boxShadow(group, 'floor', Math.max(170, size.wallX * 2 + 50), 0.12, Math.max(120, size.wallZ * 2 + 40),
        mat(0xcbb694, { roughness: 0.9 }), 0, -size.h - 0.06, 0);
    boxShadow(group, 'wall', size.wallX * 2 + 6, size.wallH, 0.12,
        mat(0xefe6d6, { roughness: 0.95 }), 0, size.wallH / 2 - size.h, size.wallZ);
    boxShadow(group, 'wall', 0.12, size.wallH, wallLen,
        mat(0xefe6d6, { roughness: 0.95 }), -size.wallX, size.wallH / 2 - size.h, -6);
    boxShadow(group, 'wall', 0.12, size.wallH, wallLen,
        mat(0xefe6d6, { roughness: 0.95 }), size.wallX, size.wallH / 2 - size.h, -6);
    // stage skirt: plausible plank-infill block sunk below y=0, top just under the carpet
    boxShadow(group, 'skirt', size.w, size.h - MAT_T, size.d,
        mat(0xf3ead9, { roughness: 0.85 }), 0, -MAT_T - (size.h - MAT_T) / 2, 0);
    // stage carpet
    boxShadow(group, 'carpet', size.w - 1.4, MAT_T, size.d - 1.4,
        mat(0xb98a56, { roughness: 0.96 }), 0, -MAT_T / 2, 0);

    // coffered ceiling, from sceneCofferedCeiling
    const ceilY = size.wallH - size.h;
    const back = size.wallZ, front = footFront;
    const depth = back - front, cz = (back + front) / 2;
    const w = size.wallX * 2;
    boxShadow(group, 'cream', w + 4, 0.3, depth + 2, mat(0xf7f1e4, { roughness: 0.95 }), 0, ceilY + 0.95, cz);
    const cols = Math.max(4, Math.round(w / 12));
    const rows = Math.max(3, Math.round(depth / 14));
    for (let i = 0; i <= cols; i++) {
        const x = -w / 2 + (w / cols) * i;
        boxShadow(group, 'cream', 0.7, 0.9, depth, mat(0xf7f1e4, { roughness: 0.95 }), x, ceilY + 0.35, cz);
        boxShadow(group, 'gold', 0.34, 0.07, depth, mat(0xd9b45c, { metalness: 0.9, roughness: 0.3 }), x, ceilY - 0.12, cz);
    }
    for (let j = 0; j <= rows; j++) {
        const z = front + (depth / rows) * j;
        boxShadow(group, 'cream', w, 0.9, 0.7, mat(0xf7f1e4, { roughness: 0.95 }), 0, ceilY + 0.35, z);
        boxShadow(group, 'gold', w, 0.07, 0.34, mat(0xd9b45c, { metalness: 0.9, roughness: 0.3 }), 0, ceilY - 0.12, z);
    }
    // warm cove line at the wall/ceiling junction
    boxShadow(group, 'cove', w, 0.14, 0.14,
        mat(0xfff2d8, { emissive: 0xffdfae, emissiveIntensity: 1.6, roughness: 0.6 }), 0, ceilY - 0.5, back - 0.35);
    for (const sx of [-1, 1]) {
        boxShadow(group, 'cove', 0.14, 0.14, depth,
            mat(0xfff2d8, { emissive: 0xffdfae, emissiveIntensity: 1.6, roughness: 0.6 }), sx * (size.wallX - 0.35), ceilY - 0.5, cz);
    }

    // dance floor in front of the stage: dark inlay border + parquet (node fallback color)
    const dz = -(size.d / 2 + 9);
    boxShadow(group, 'parquetBorder', 22, 0.06, 15, mat(0x5a4028, { roughness: 0.75 }), 0, -size.h + 0.03, dz);
    boxShadow(group, 'parquet', 20, 0.06, 13, mat(0xb5894f, { roughness: 0.72 }), 0, -size.h + 0.05, dz);

    // pilasters on the back wall + sconces between them
    const wx = size.wallX / 30;
    const backH = size.wallH - 3;
    for (const x of [-20, -8, 8, 20]) {
        const px = x * wx;
        boxShadow(group, 'pilaster', 1.6, backH, 0.5, mat(0xf3ecdc, { roughness: 0.7 }), px, -size.h + backH / 2, size.wallZ - 0.35);
        boxShadow(group, 'gold', 2.0, 0.5, 0.7, mat(0xd9b45c, { metalness: 0.85, roughness: 0.35 }), px, -size.h + backH - 0.2, size.wallZ - 0.35);
        boxShadow(group, 'pilaster', 2.0, 0.4, 0.7, mat(0xf3ecdc, { roughness: 0.7 }), px, -size.h + 0.18, size.wallZ - 0.35);
    }
    for (const x of [-14, -5, 5, 14]) {
        const sx = x * wx;
        boxShadow(group, 'sconce', 0.9, 1.8, 0.2,
            mat(0xfff6e2, { emissive: 0xffe7bd, emissiveIntensity: 1.2, roughness: 0.5 }), sx, 8.5, size.wallZ - 0.5);
        lamp(lamps, sx, 8.5, size.wallZ - 1.4, 6, 0xffdcae);
    }

    // chair-rail band + molding panels on both side walls
    for (const sx of [-1, 1]) {
        boxShadow(group, 'trim', 0.18, 0.35, size.wallZ + 20,
            mat(0xe8dcc2, { roughness: 0.7 }), sx * (size.wallX - 0.1), 3.2, size.wallZ / 2 - 4);
        const n = Math.max(2, Math.round(size.wallZ / 9));
        for (let i = 0; i < n; i++) {
            const z = -size.d / 2 - 6 + i * ((size.wallZ + 12) / n);
            const px = sx * (size.wallX - 0.12);
            boxShadow(group, 'trim', 0.1, 5.6, 5.5, mat(0xe8dcc2, { roughness: 0.7 }), px, 6.6, z);
            boxShadow(group, 'panelIn', 0.06, 5.05, 4.95, mat(0xe6dcc6, { roughness: 0.85 }), px + sx * 0.02, 6.6, z);
        }
    }

    // three chandeliers (only centre carries the lamp)
    const s = Math.max(0.7, Math.min(1.35, size.w / 70));
    const y = size.wallH * 0.6;
    const chandSpec = { gold: mat(0xd9b45c, { metalness: 0.9, roughness: 0.3 }), glass: mat(0xfff4dd, { emissive: 0xffe3ae, emissiveIntensity: 5, roughness: 0.3 }) };
    function chandelier(cx, cz, sc, withLamp) {
        const r1 = new THREE.TorusGeometry(3.2 * sc, 0.18 * sc, 8, 40);
        const m1 = new THREE.Mesh(r1, new THREE.MeshStandardMaterial({ color: chandSpec.gold.hex, roughness: 0.3, metalness: 0.9, envMapIntensity: 0.3 }));
        m1.rotation.x = Math.PI / 2; m1.position.set(cx, y, cz); m1.name = 'gold'; group.add(m1);
        const r2 = new THREE.TorusGeometry(2.0 * sc, 0.13 * sc, 8, 32);
        const m2 = new THREE.Mesh(r2, m1.material); m2.rotation.x = Math.PI / 2; m2.position.set(cx, y - 1.2 * sc, cz); m2.name = 'gold'; group.add(m2);
        const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, ceilY - y - 0.2, 6), m1.material);
        chain.position.set(cx, y + (ceilY - y - 0.2) / 2, cz); chain.name = 'gold'; group.add(chain);
        const core = new THREE.Mesh(new THREE.SphereGeometry(1.05 * sc, 16, 12), new THREE.MeshStandardMaterial({ color: 0xfff4dd, emissive: 0xffe3ae, emissiveIntensity: 5, roughness: 0.3, envMapIntensity: 0.3 }));
        core.position.set(cx, y - 0.4 * sc, cz); core.name = 'glass'; group.add(core);
        const bulbMat = new THREE.MeshStandardMaterial({ color: 0x2b2b2b, emissive: 0xffe3ae, emissiveIntensity: 5, roughness: 0.4, envMapIntensity: 0.3 });
        for (let i = 0; i < 10; i++) {
            const a = (i / 10) * Math.PI * 2;
            const b = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), bulbMat);
            b.position.set(cx + Math.cos(a) * 3.2 * sc, y - 0.2 * sc, cz + Math.sin(a) * 3.2 * sc);
            b.name = 'bulb'; group.add(b);
        }
        const strandGeo = new THREE.CylinderGeometry(0.025 * sc, 0.05 * sc, 0.9 * sc, 5);
        const strandMat = new THREE.MeshStandardMaterial({ color: 0xfff8ea, emissive: 0xffedc8, emissiveIntensity: 1.4, roughness: 0.25, envMapIntensity: 0.3 });
        for (let i = 0; i < 16; i++) {
            const a = (i / 16) * Math.PI * 2 + 0.2;
            const st = new THREE.Mesh(strandGeo, strandMat);
            st.position.set(cx + Math.cos(a) * 2.5 * sc, y - 1.75 * sc, cz + Math.sin(a) * 2.5 * sc);
            st.name = 'strand'; group.add(st);
        }
        if (withLamp) lamp(lamps, cx, y - 0.5 * sc, cz, 45, 0xffe3b8);
    }
    chandelier(0, 4, s, true);
    if (size.w >= 56) {
        chandelier(-size.w * 0.28, 4, s * 0.62, false);
        chandelier(size.w * 0.28, 4, s * 0.62, false);
    }

    // gala dinner tables + chairs (canvas textures are null in node -> plain colors)
    // Rows anchor off the stage edge; row 1's stage-facing chair ring reaches
    // 1.08 ft past its centre - 5.25 ft out keeps chairs clear of the skirt.
    const rowsZ = [-size.d / 2 - 5.25, -size.d / 2 - 14.25];
    const xCol = Math.min(size.wallX - 8, size.w * 0.35);
    const sites = [];
    for (const sx of [-1, 1]) for (const z of rowsZ) sites.push({ x: sx * xCol, z });
    const clothMat = new THREE.MeshStandardMaterial({ color: 0xf2ead8, roughness: 0.95, envMapIntensity: 0.3 });
    const topMat = new THREE.MeshStandardMaterial({ color: 0xf6f0e2, roughness: 0.9, envMapIntensity: 0.3 });
    const goldRimMat = new THREE.MeshStandardMaterial({ color: 0xd9c48a, metalness: 0.55, roughness: 0.4, envMapIntensity: 0.3 });
    const bloomMat = new THREE.MeshStandardMaterial({ color: 0x7a1f2b, roughness: 0.85, envMapIntensity: 0.3 });
    const seatMat = new THREE.MeshStandardMaterial({ color: 0x6e5f4a, roughness: 0.9, envMapIntensity: 0.3 });
    const legMat = new THREE.MeshStandardMaterial({ color: 0x8f8574, metalness: 0.6, roughness: 0.4, envMapIntensity: 0.3 });
    let ci = 0;
    for (const t of sites) {
        const mk = (label, geo, m, yy, scl) => {
            const mesh = new THREE.Mesh(geo, m);
            mesh.position.set(t.x, -size.h + yy, t.z);
            if (scl) mesh.scale.set(scl, 1, scl);
            mesh.name = label; mesh.userData.n = ci; group.add(mesh);
        };
        mk('cloth', new THREE.CylinderGeometry(2.45, 2.68, 2.5, 24), clothMat, 1.25);
        mk('tableTop', new THREE.CylinderGeometry(2.5, 2.5, 0.12, 24), topMat, 2.56);
        mk('goldRim', new THREE.CylinderGeometry(2.53, 2.53, 0.08, 24), goldRimMat, 2.42);
        mk('goldRim', new THREE.CylinderGeometry(0.14, 0.2, 0.75, 10), goldRimMat, 3.0);
        mk('bloom', new THREE.SphereGeometry(0.38, 10, 8), bloomMat, 3.55);
        ci++;
        const chairR = 3.7;
        for (let k = 0; k < 8; k++) {
            const a = (k / 8) * Math.PI * 2;
            const cxK = t.x + Math.cos(a) * chairR, czK = t.z + Math.sin(a) * chairR;
            const ry = Math.atan2(-cxK, -czK) + ((((ci * 13) % 5) - 2) * 0.014);
            const cq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry);
            const siteMat = { x: cxK, z: czK };
            const place = (label, geo, m, lx, ly, lz) => {
                const mesh = new THREE.Mesh(geo, m);
                const v = new THREE.Vector3(lx, ly, lz).applyQuaternion(cq);
                mesh.position.set(siteMat.x + v.x, -size.h + 0.46 + ly, siteMat.z + v.z);
                mesh.rotation.y = ry; mesh.name = label; group.add(mesh);
            };
            place('seat', new THREE.BoxGeometry(1.6, 0.09, 1.5), seatMat, 0, 0, 0);
            place('seat', new THREE.BoxGeometry(1.6, 1.55, 0.09), seatMat, 0, 0.82, -0.7);
            for (const [lx, lz] of [[-0.7, -0.6], [0.7, -0.6], [-0.7, 0.6], [0.7, 0.6]]) {
                place('cframe', new THREE.CylinderGeometry(0.028, 0.028, 0.46, 6), legMat, lx, -0.23, lz);
            }
            ci++;
        }
    }

    // uplights on the stage front
    const upx = size.w * 0.117;
    lamp(lamps, -upx, 0.5, 2.5, 8, 0xffd7a8);
    lamp(lamps, upx, 0.5, 2.5, 8, 0xffd7a8);

    return {
        size, lamps,
        mood: {
            background: 0xefe6d6,
            ambient: { color: 0xfff6ea, intensity: 0.65 },
            key: { color: 0xfff2e0, intensity: 1.25 },
            fill: { color: 0xffe9cf, intensity: 0.4 }
        }
    };
}
