import * as THREE from 'three';

export const MODEL_ID = 'o2tilt';
export const MODEL_NAME = 'S Curve';
export const MODEL_SUBTITLE = 'Modular Control';

const POLE_MAX_HEIGHT = 8.0;
const RAIL_LENGTH = 12.0;
const WAVE_AMP = 1.0;
const RAIL_RADIUS = 0.12;
const FABRIC_RES_X = 300;
const FABRIC_RES_Y = 8;
const POLE_COUNT = 3;
const MAX_DROP = 5.0;
const PLEAT_FREQ = 30;
const PLEAT_DEPTH = 0.12;
const ANCHOR_RAIL_SAMPLES = 24;

// A stand is telescoping: a fixed sleeve standing out of the floor, with a
// slimmer inner tube running out of its open top and on up to the rail.
const POLE_SECTION = 0.16;      // outer tube across flats, in feet
const MM_PER_FOOT = 304.8;
const NEST_CLEARANCE = 0.002;   // gap between inner tube and sleeve bore, feet
const INNER_HIDE = 0.02;        // below this the inner tube is not drawn

// The stand-to-rail joint is a sleeve coupler: the round rail pole passes
// through a fatter coupling sleeve that the stand top rises into. Because
// the sleeve is round, the rail can be rotated (pitched) and locked in
// place - the tilt lives in this joint, like a set-screw EMT coupling on
// a pipe-and-rail build.
const Y_AXIS = new THREE.Vector3(0, 1, 0);

// Pivot-bracket dimensions (feet), scaled from the DIY spec:
// round sleeve 70-100 mm long, side plates 4-5 mm x 60-70 mm,
// M8/M10 pivot bolt, M6/M8 locking bolt.
const BR_SLEEVE_LEN = 0.25;
const BR_SLEEVE_OUTER_R = RAIL_RADIUS + 0.017;
const BR_PLATE_THICK = 0.015;
const BR_PLATE_HEIGHT = 0.22;
const BR_PLATE_WIDTH = 0.1;
const BR_PIVOT_R = 0.014;
const BR_PIVOT_HEAD_R = 0.025;
const BR_PIVOT_HEAD_H = 0.012;
const BR_LOCK_R = 0.01;
const BR_LOCK_LEN = 0.06;
const BR_PLATE_OFFSET = BR_SLEEVE_OUTER_R + BR_PLATE_THICK / 2 + 0.005;
const BR_BOLT_LEN = 2 * BR_PLATE_OFFSET + BR_PLATE_THICK + 0.02;


export const PARAMS = {
    gap:     { label: 'Center Gap',        type: 'range', min: 0, max: 10,  step: 0.1, value: 3,  unit: ' ft' },
    pan:     { label: 'Swing Pan (Arc)',   type: 'range', min: -90, max: 90,  step: 1,   value: 0,  unit: '°' },
    pitch:   { label: 'Pitch (Rail Tilt)', type: 'range', min: 0, max: 20,  step: 1,   value: 0,  unit: '°' },
    decline: { label: 'Decline (Slope)',   type: 'range', min: 0, max: 100, step: 1,   value: 0,  unit: '%' },
    fabric:  { label: 'Curtains',          type: 'toggle', value: false },

    poleShape: { label: 'Square Poles',    type: 'toggle', value: true, advanced: true },
    poleInner: { label: 'Inner Wall',      type: 'range', min: 0.8, max: 3, step: 0.1,
                 value: 1,   unit: ' mm', advanced: true },
    poleOuter: { label: 'Outer Wall',      type: 'range', min: 1,   max: 4, step: 0.1,
                 value: 1.5, unit: ' mm', advanced: true },
    sleeve:    { label: 'Sleeve Height',   type: 'range', min: 3, max: 10, step: 0.1,
                 value: 5,   unit: ' ft', advanced: true }
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

// Cross-section of a real tube: a square (or round) ring extruded along Y
// over a unit height, so scaling Y sets the length while the wall thickness
// stays in X/Z. Solid-looking but genuinely hollow - the wall number in the
// Advanced settings is a real dimension.
function tubeGeometry(square, section, wall) {
    const outer = section / 2;
    const inner = Math.max(outer * 0.15, outer - wall);
    let shape, hole;

    if (square) {
        shape = new THREE.Shape();
        shape.moveTo(-outer, -outer).lineTo(outer, -outer)
             .lineTo(outer, outer).lineTo(-outer, outer).closePath();
        hole = new THREE.Path();
        // Opposite winding so the ring triangulates as a hole.
        hole.moveTo(-inner, -inner).lineTo(-inner, inner)
             .lineTo(inner, inner).lineTo(inner, -inner).closePath();
    } else {
        shape = new THREE.Shape();
        shape.absarc(0, 0, outer, 0, Math.PI * 2, false);
        hole = new THREE.Path();
        hole.absarc(0, 0, inner, 0, Math.PI * 2, true);
    }
    shape.holes.push(hole);

    const geo = new THREE.ExtrudeGeometry(shape, {
        depth: 1, bevelEnabled: false, steps: 1, curveSegments: square ? 1 : 24
    });
    geo.rotateX(-Math.PI / 2);
    return geo;
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

    const matRail = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.9, roughness: 0.28 });
    const matPole = new THREE.MeshStandardMaterial({ color: 0x9ca3af, metalness: 0.4, roughness: 0.4 });
    const matBase = new THREE.MeshStandardMaterial({ color: 0x374151, metalness: 0.7, roughness: 0.2 });
    const matJoint = new THREE.MeshStandardMaterial({ color: 0x6b7280, metalness: 0.75, roughness: 0.3 });
    const matFabric = new THREE.MeshStandardMaterial({
        color: 0xffffff, roughness: 0.9, metalness: 0.1,
        side: THREE.DoubleSide, envMapIntensity: 0.15
    });

    const state = {};
    for (const k of Object.keys(PARAMS)) state[k] = PARAMS[k].value;
    Object.assign(state, initial);

    const polesL = [], polesR = [], basesL = [], basesR = [];
    for (let i = 0; i < POLE_COUNT; i++) {
        for (const [pArr, bArr, tag] of [
            [polesL, basesL, 'L'], [polesR, basesR, 'R']
        ]) {
            const stand = new THREE.Group();
            stand.name = `stand-${tag}-${i}`;

            const sleeve = new THREE.Mesh(new THREE.BufferGeometry(), matPole);
            const inner = new THREE.Mesh(new THREE.BufferGeometry(), matPole);
            sleeve.name = 'stand-sleeve';
            inner.name = 'stand-inner';
            sleeve.castShadow = inner.castShadow = true;
            inner.visible = false;
            stand.add(sleeve, inner);

            const base = createBaseFrame(matBase);
            base.name = 'stand-base';
            root.add(stand, base);

            pArr.push({ group: stand, sleeve, inner, height: 0 });
            bArr.push(base);
        }
    }

    // One shared geometry per part; rebuilt only when the advanced tube
    // settings actually change, not on every slider tick.
    let sleeveGeo = null, innerGeo = null, tubeKey = '';

    function ensureTubeGeometry() {
        const wallOut = state.poleOuter / MM_PER_FOOT;
        const wallIn = state.poleInner / MM_PER_FOOT;
        const key = `${state.poleShape ? 'square' : 'round'}|${wallOut.toFixed(5)}|${wallIn.toFixed(5)}`;
        if (key === tubeKey) return;
        tubeKey = key;

        // The inner tube has to nest inside the sleeve bore with room to slide.
        const bore = POLE_SECTION / 2 - wallOut;
        const innerSection = Math.max(0.02, (bore - NEST_CLEARANCE) * 2);

        if (sleeveGeo) sleeveGeo.dispose();
        if (innerGeo) innerGeo.dispose();
        sleeveGeo = tubeGeometry(state.poleShape, POLE_SECTION, wallOut);
        innerGeo = tubeGeometry(state.poleShape, innerSection, wallIn);

        for (const arr of [polesL, polesR]) {
            for (const p of arr) {
                p.sleeve.geometry = sleeveGeo;
                p.inner.geometry = innerGeo;
            }
        }
    }

    let railL = null, railR = null, fabricL = null, fabricR = null;
    let anchors = [];
    let anchorsStale = true;

    // The coupling sleeves joining each stand top to the rail. They follow
    // the rail's own tangent so the rail runs through them, and they are
    // round so the rail can be pitched inside them.
    const joints = [];
    // Shared pivot-bracket geometries (one set for all six brackets).
    const brSleeveGeo = new THREE.CylinderGeometry(BR_SLEEVE_OUTER_R, BR_SLEEVE_OUTER_R, BR_SLEEVE_LEN, 16);
    const brPlateGeo = new THREE.BoxGeometry(BR_PLATE_WIDTH, BR_PLATE_HEIGHT, BR_PLATE_THICK);
    const brBoltGeo = new THREE.CylinderGeometry(BR_PIVOT_R, BR_PIVOT_R, BR_BOLT_LEN, 8);
    const brHeadGeo = new THREE.CylinderGeometry(BR_PIVOT_HEAD_R, BR_PIVOT_HEAD_R, BR_PIVOT_HEAD_H, 6);
    const brLockGeo = new THREE.CylinderGeometry(BR_LOCK_R, BR_LOCK_R, BR_LOCK_LEN, 8);
    const brLockHeadGeo = new THREE.CylinderGeometry(BR_LOCK_R * 1.8, BR_LOCK_R * 1.8, BR_LOCK_R * 2, 6);

    function release(mesh) {
        if (!mesh) return;
        root.remove(mesh);
        mesh.geometry.dispose();
    }

    function build() {
        const ptsL = getStructuralPoints(state, false, FABRIC_RES_X);
        const ptsR = getStructuralPoints(state, true, FABRIC_RES_X);
        const panRad = state.pan * (Math.PI / 180);

        ensureTubeGeometry();

        for (const j of joints) root.remove(j);
        joints.length = 0;

        for (let i = 0; i < POLE_COUNT; i++) {
            const idx = Math.floor((i / (POLE_COUNT - 1)) * FABRIC_RES_X);

            for (const [pts, stands, bases, turn] of [
                [ptsR, polesR, basesR, 1],
                [ptsL, polesL, basesL, -1]
            ]) {
                const p = pts[idx];
                const railY = Math.max(0.05, p.y);
                const stand = stands[i];

                // The sleeve is the pole's retracted length; the inner tube
                // takes up the rest of the way to the rail, and neither is
                // ever allowed to poke through it.
                const sleeveH = Math.min(Math.max(0.05, state.sleeve), railY);
                const innerH = railY - sleeveH;

                // The stand rises straight up under the rail point - the
                // sleeve on top of it holds the rail, so the rail sits
                // exactly on the vertical tube with no sideways offset.
                const bx = p.x;
                const bz = p.z;

                // Rail tangent at this point, for bracket orientation.
                const jPrev = pts[Math.max(0, idx - 1)];
                const jNext = pts[Math.min(pts.length - 1, idx + 1)];
                const tan = jNext.clone().sub(jPrev);
                tan.y = 0;
                if (tan.lengthSq() < 1e-12) tan.set(1, 0, 0);
                tan.normalize();

                stand.group.position.set(bx, 0, bz);
                stand.group.rotation.y = turn * panRad;
                stand.sleeve.position.set(0, 0, 0);
                stand.sleeve.scale.set(1, sleeveH, 1);
                stand.inner.position.set(0, sleeveH, 0);
                stand.inner.scale.set(1, Math.max(0.02, innerH), 1);
                stand.inner.visible = innerH > INNER_HIDE;
                stand.height = railY;

                bases[i].position.set(bx, 0, bz);
                bases[i].rotation.y = turn * panRad;

                // Pivot bracket: sits ON the stand top, directly under the
                // rail. The round sleeve holds the rail, two side plates
                // (clevis ears) hang down onto the stand, and a pivot bolt
                // through plates and sleeve lets the rail tilt. A smaller
                // locking bolt clamps the chosen angle.
                const bracket = new THREE.Group();
                bracket.position.set(bx, railY, bz);
                bracket.rotation.y = Math.atan2(-tan.z, tan.x);

                // Round sleeve along the rail tangent - right on the rail.
                const sleeve = new THREE.Mesh(brSleeveGeo, matJoint);
                sleeve.rotation.z = Math.PI / 2;
                sleeve.castShadow = true;
                bracket.add(sleeve);

                // Two side plates (clevis ears) on either side of the
                // sleeve along the pivot axis (local Z), hanging down
                // onto the stand top.
                for (const side of [-1, 1]) {
                    const plate = new THREE.Mesh(brPlateGeo, matJoint);
                    plate.position.set(0, -BR_PLATE_HEIGHT / 2,
                        side * BR_PLATE_OFFSET);
                    plate.castShadow = true;
                    bracket.add(plate);
                }

                // Pivot bolt through the plates and sleeve (local Z).
                const bolt = new THREE.Mesh(brBoltGeo, matJoint);
                bolt.rotation.x = Math.PI / 2;
                bolt.castShadow = true;
                bracket.add(bolt);

                // Hex heads at both ends of the bolt.
                for (const end of [-1, 1]) {
                    const head = new THREE.Mesh(brHeadGeo, matJoint);
                    head.rotation.x = Math.PI / 2;
                    head.position.z = end * (BR_BOLT_LEN / 2);
                    head.castShadow = true;
                    bracket.add(head);
                }

                // Locking bolt on one plate (secures the tilt angle).
                const lock = new THREE.Mesh(brLockGeo, matJoint);
                lock.rotation.x = Math.PI / 2;
                lock.position.set(0, -BR_PLATE_HEIGHT * 0.3,
                    BR_PLATE_OFFSET + BR_PLATE_THICK / 2 + BR_LOCK_LEN / 2);
                lock.castShadow = true;
                bracket.add(lock);

                const lockHead = new THREE.Mesh(brLockHeadGeo, matJoint);
                lockHead.rotation.x = Math.PI / 2;
                lockHead.position.set(0, -BR_PLATE_HEIGHT * 0.3,
                    BR_PLATE_OFFSET + BR_PLATE_THICK / 2 + BR_LOCK_LEN);
                lockHead.castShadow = true;
                bracket.add(lockHead);

                root.add(bracket);
                joints.push(bracket);
            }
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
                const stand = pArr[i];
                anchors.push({
                    id: `pole-${tag}-${i}`,
                    kind: 'pole',
                    side: tag,
                    position: new THREE.Vector3(
                        stand.group.position.x, stand.height, stand.group.position.z),
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
        matJoint.envMapIntensity = t.metalEnv;
    }

    // The chosen fabric palette. setTheme resets the fabric to its own white
    // or grey, so the composition root applies the colorway after the theme.
    function setColorway(hex) {
        if (!Number.isFinite(hex)) return;
        matFabric.color.setHex(hex);
    }

    function dispose() {
        release(railL); release(railR); release(fabricL); release(fabricR);
        railL = railR = fabricL = fabricR = null;
        root.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
        root.clear();
        sleeveGeo = innerGeo = null;
        tubeKey = '';
        [matRail, matPole, matBase, matFabric, matJoint].forEach(m => m.dispose());
        anchors = [];
        anchorsStale = true;
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
        setColorway,
        setParams(partial) { Object.assign(state, partial); model.dirty = true; },
        dispose
    };

    build();
    return model;
}
