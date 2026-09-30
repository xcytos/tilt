import * as THREE from 'three';

export const MODEL_ID = 'o2tilt';
export const MODEL_NAME = 'O2-TILT Frame';
export const MODEL_SUBTITLE = 'Modular Control';

const POLE_MAX_HEIGHT = 8.0;
const RAIL_LENGTH = 12.0;
const WAVE_AMP = 1.0;
const RAIL_RADIUS = 0.12;
const POLE_RADIUS = 0.08;
const FABRIC_RES_X = 300;
const FABRIC_RES_Y = 8;
const POLE_COUNT = 4;
const MAX_DROP = 5.0;
const PLEAT_FREQ = 30;
const PLEAT_DEPTH = 0.12;
const ANCHOR_RAIL_SAMPLES = 24;

export const PARAMS = {
    gap:     { label: 'Center Gap',        type: 'range', min: 0, max: 6,   step: 0.1, value: 3,  unit: ' ft' },
    pan:     { label: 'Swing Pan (Arc)',   type: 'range', min: 0, max: 90,  step: 1,   value: 0,  unit: '°' },
    pitch:   { label: 'Pitch (Rail Tilt)', type: 'range', min: 0, max: 20,  step: 1,   value: 0,  unit: '°' },
    decline: { label: 'Decline (Slope)',   type: 'range', min: 0, max: 100, step: 1,   value: 0,  unit: '%' },
    fabric:  { label: 'Curtains',          type: 'toggle', value: false }
};

const MODEL_THEME = {
    light: { fabric: 0xffffff, fabricEnv: 0.15, metalEnv: 1.0 },
    dark:  { fabric: 0xd4d4d8, fabricEnv: 0.08, metalEnv: 0.4 }
};

export function createBaseFrame(bMat) {
    const group = new THREE.Group();
    const w = 1.6, d = 1.6, thick = 0.12, h = 0.12;

    const mark = m => { m.castShadow = true; m.receiveShadow = true; return m; };

    // 1. Square base frame
    const geoX = new THREE.BoxGeometry(w, h, thick);
    const geoZ = new THREE.BoxGeometry(thick, h, d - thick * 2);

    const b1 = new THREE.Mesh(geoX, bMat); b1.position.set(0, h / 2, d / 2 - thick / 2);
    const b2 = new THREE.Mesh(geoX, bMat); b2.position.set(0, h / 2, -d / 2 + thick / 2);
    const b3 = new THREE.Mesh(geoZ, bMat); b3.position.set(w / 2 - thick / 2, h / 2, 0);
    const b4 = new THREE.Mesh(geoZ, bMat); b4.position.set(-w / 2 + thick / 2, h / 2, 0);
    [b1, b2, b3, b4].forEach(m => group.add(mark(m)));

    // 2. Pole base plate + collar (the pole foot the braces anchor into)
    const PLATE_R = 0.30, PLATE_H = 0.10;
    const COLLAR_R = 0.14, COLLAR_TOP = 0.66;
    const plate = mark(new THREE.Mesh(
        new THREE.CylinderGeometry(PLATE_R, PLATE_R, PLATE_H, 24), bMat));
    plate.position.y = PLATE_H / 2;
    const collar = mark(new THREE.Mesh(
        new THREE.CylinderGeometry(COLLAR_R, COLLAR_R, COLLAR_TOP - PLATE_H, 24), bMat));
    collar.position.y = (PLATE_H + COLLAR_TOP) / 2;
    group.add(plate, collar);

    // 3. Four diagonal braces, each embedded at BOTH ends
    const a = new THREE.Vector3(0.06, 0.58, 0);
    const b = new THREE.Vector3(w / 2 - thick / 2, h / 2, 0);
    const dir = b.clone().sub(a);
    const gLen = dir.length();
    const braceGeo = new THREE.CylinderGeometry(0.045, 0.045, gLen, 8);
    braceGeo.translate(0, gLen / 2, 0);
    const braceQ = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0), dir.normalize());

    for (let i = 0; i < 4; i++) {
        const holder = new THREE.Group();
        const g = mark(new THREE.Mesh(braceGeo, bMat));
        g.position.copy(a);
        g.quaternion.copy(braceQ);
        holder.add(g);
        holder.rotation.y = (Math.PI / 2) * i;
        group.add(holder);
    }
    return group;
}

export function getStructuralPoints(state, isRight, segments) {
    const pts = [];
    const panRad = state.pan * (Math.PI / 180);
    const pitchRad = state.pitch * (Math.PI / 180);
    const halfGap = state.gap / 2.0;

    const sinP = Math.sin(pitchRad), cosP = Math.cos(pitchRad);
    const sinA = Math.sin(panRad),   cosA = Math.cos(panRad);

    for (let i = 0; i <= segments; i++) {
        const t = i / segments;

        const localX = t * RAIL_LENGTH;
        const wave = Math.sin(t * Math.PI * 6) * WAVE_AMP;

        // Decline: a pure vertical drop, independent of pitch.
        const dropY = -t * (state.decline / 100) * MAX_DROP;

        // Pitch: roll the serpentine about the rail's own X axis. Poles sit
        // where wave === 0, so their heights are unaffected by pitch.
        const pitchedY = -wave * sinP;
        const pitchedZ =  wave * cosP;

        // Pan: yaw the whole rail about Y, anchored at the centre gap
        const panX = localX * cosA + pitchedZ * sinA;
        const panZ = -localX * sinA + pitchedZ * cosA;

        let wX = halfGap + panX;
        let wY = POLE_MAX_HEIGHT + dropY + pitchedY;
        let wZ = panZ;

        if (!isRight) wX = -wX;

        pts.push(new THREE.Vector3(wX, wY, wZ));
    }
    return pts;
}

export function generateFabricGeometry(curvePts, isRight) {
    const cols = FABRIC_RES_X, rows = FABRIC_RES_Y;
    const verts = [], uvs = [], indices = [];
    const rowStride = rows + 1;

    for (let i = 0; i <= cols; i++) {
        const t = i / cols;
        const pt = curvePts[i];

        let tan = new THREE.Vector3();
        if (i < cols) tan.subVectors(curvePts[i + 1], pt);
        else tan.subVectors(pt, curvePts[i - 1]);
        tan.y = 0;
        if (tan.lengthSq() < 1e-12) tan.set(1, 0, 0);
        tan.normalize();

        const normal = new THREE.Vector3(-tan.z, 0, tan.x);
        if (!isRight) normal.negate();

        const phase = t * Math.PI * 2 * PLEAT_FREQ;

        for (let j = 0; j <= rows; j++) {
            const v = j / rows;
            const y = THREE.MathUtils.lerp(pt.y - RAIL_RADIUS, 0, v);
            const amp = PLEAT_DEPTH * (0.55 + 0.45 * v);
            const off = Math.sin(phase) * amp;
            verts.push(pt.x + normal.x * off, y, pt.z + normal.z * off);
            uvs.push(t, 1 - v);
        }
    }

    for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
            const a = i * rowStride + j;
            const b = a + 1;
            const c = (i + 1) * rowStride + j;
            const d = c + 1;
            indices.push(a, b, d);
            indices.push(a, d, c);
        }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
}

export function createO2TiltModel(initial = {}) {
    const root = new THREE.Group();
    root.name = MODEL_ID;

    const matRail = new THREE.MeshStandardMaterial({ color: 0x4b5563, metalness: 0.6, roughness: 0.3 });
    const matPole = new THREE.MeshStandardMaterial({ color: 0x9ca3af, metalness: 0.4, roughness: 0.4 });
    const matBase = new THREE.MeshStandardMaterial({ color: 0x374151, metalness: 0.7, roughness: 0.2 });
    const matFabric = new THREE.MeshStandardMaterial({
        color: 0xffffff, roughness: 0.9, metalness: 0.1,
        side: THREE.DoubleSide, envMapIntensity: 0.15
    });

    const state = {};
    for (const k of Object.keys(PARAMS)) state[k] = PARAMS[k].value;
    Object.assign(state, initial);

    const polesL = [], polesR = [], basesL = [], basesR = [];
    for (let i = 0; i < POLE_COUNT; i++) {
        for (const [pArr, bArr] of [[polesL, basesL], [polesR, basesR]]) {
            const pole = new THREE.Mesh(
                new THREE.CylinderGeometry(POLE_RADIUS, POLE_RADIUS, 1, 16), matPole);
            pole.geometry.translate(0, 0.5, 0);
            pole.castShadow = true;
            const base = createBaseFrame(matBase);
            root.add(pole, base);
            pArr.push(pole);
            bArr.push(base);
        }
    }

    let railL = null, railR = null, fabricL = null, fabricR = null;
    let anchors = [];
    let anchorsStale = true;

    function release(mesh) {
        if (!mesh) return;
        root.remove(mesh);
        mesh.geometry.dispose();
    }

    function build() {
        const ptsL = getStructuralPoints(state, false, FABRIC_RES_X);
        const ptsR = getStructuralPoints(state, true, FABRIC_RES_X);

        for (let i = 0; i < POLE_COUNT; i++) {
            const idx = Math.floor((i / (POLE_COUNT - 1)) * FABRIC_RES_X);

            const pR = ptsR[idx];
            polesR[i].position.set(pR.x, 0, pR.z);
            polesR[i].scale.set(1, Math.max(0.1, pR.y), 1);
            basesR[i].position.set(pR.x, 0, pR.z);
            basesR[i].rotation.y = state.pan * (Math.PI / 180);

            const pL = ptsL[idx];
            polesL[i].position.set(pL.x, 0, pL.z);
            polesL[i].scale.set(1, Math.max(0.1, pL.y), 1);
            basesL[i].position.set(pL.x, 0, pL.z);
            basesL[i].rotation.y = -state.pan * (Math.PI / 180);
        }

        release(railR); release(railL); railR = railL = null;
        const rCurv = new THREE.CatmullRomCurve3(ptsR);
        const lCurv = new THREE.CatmullRomCurve3(ptsL);
        rCurv.arcLengthDivisions = lCurv.arcLengthDivisions = Math.max(200, FABRIC_RES_X);
        railR = new THREE.Mesh(new THREE.TubeGeometry(rCurv, FABRIC_RES_X, RAIL_RADIUS, 12, false), matRail);
        railL = new THREE.Mesh(new THREE.TubeGeometry(lCurv, FABRIC_RES_X, RAIL_RADIUS, 12, false), matRail);
        railR.castShadow = railL.castShadow = true;
        root.add(railR, railL);

        release(fabricR); release(fabricL); fabricR = fabricL = null;
        if (state.fabric) {
            fabricR = new THREE.Mesh(generateFabricGeometry(ptsR, true), matFabric);
            fabricL = new THREE.Mesh(generateFabricGeometry(ptsL, false), matFabric);
            fabricR.castShadow = fabricL.castShadow = true;
            root.add(fabricR, fabricL);
        }

        anchorsStale = true;
        model.dirty = false;
    }

    // Anchors are where ELEMENTS (curtain, flowers, balloons) may attach.
    // kind: 'rail'  - along the serpentine rail, with tangent + outward normal
    //       'pole'  - top of each pole
    //       'base'  - floor plate of each base
    function getAnchors() {
        if (!anchorsStale) return anchors;
        anchors = [];

        for (const side of [false, true]) {
            const pts = getStructuralPoints(state, side, ANCHOR_RAIL_SAMPLES);
            for (let i = 0; i < pts.length; i++) {
                const prv = pts[Math.max(i - 1, 0)];
                const nxt = pts[Math.min(i + 1, pts.length - 1)];
                const tangent = nxt.clone().sub(prv).normalize();
                const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
                if (!side) normal.negate();
                anchors.push({
                    id: `rail-${side ? 'R' : 'L'}-${i}`,
                    kind: 'rail',
                    side: side ? 'R' : 'L',
                    position: pts[i].clone(),
                    tangent,
                    normal
                });
            }
        }

        for (const [tag, pArr, bArr] of [['L', polesL, basesL], ['R', polesR, basesR]]) {
            for (let i = 0; i < pArr.length; i++) {
                anchors.push({
                    id: `pole-${tag}-${i}`,
                    kind: 'pole',
                    side: tag,
                    position: new THREE.Vector3(pArr[i].position.x, pArr[i].scale.y, pArr[i].position.z),
                    tangent: new THREE.Vector3(0, 1, 0),
                    normal: new THREE.Vector3(1, 0, 0)
                });
                anchors.push({
                    id: `base-${tag}-${i}`,
                    kind: 'base',
                    side: tag,
                    position: bArr[i].position.clone(),
                    tangent: new THREE.Vector3(1, 0, 0),
                    normal: new THREE.Vector3(0, 1, 0)
                });
            }
        }

        anchorsStale = false;
        return anchors;
    }

    function setTheme(isDark) {
        const t = isDark ? MODEL_THEME.dark : MODEL_THEME.light;
        matFabric.color.setHex(t.fabric);
        matFabric.envMapIntensity = t.fabricEnv;
        matRail.envMapIntensity = t.metalEnv;
        matPole.envMapIntensity = t.metalEnv;
        matBase.envMapIntensity = t.metalEnv;
    }

    function dispose() {
        release(railL); release(railR); release(fabricL); release(fabricR);
        railL = railR = fabricL = fabricR = null;
        root.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
        root.clear();
        [matRail, matPole, matBase, matFabric].forEach(m => m.dispose());
        anchors = [];
    }

    const model = {
        id: MODEL_ID,
        name: MODEL_NAME,
        subtitle: MODEL_SUBTITLE,
        object3D: root,
        params: PARAMS,
        state,
        dirty: true,
        build,
        getAnchors,
        setTheme,
        setParams(partial) { Object.assign(state, partial); model.dirty = true; },
        dispose
    };

    build();
    return model;
}
