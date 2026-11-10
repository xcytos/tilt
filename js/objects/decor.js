// The three manufactured decor assets from
// plans/decor_element_library_3d_assets.json: two lattice rails and the
// arch-panel sheet. The overall structure follows the shipped shape
// specs - plans/pillar-rail-spec.png and plans/arch-panel-spec.png -
// while the catalog pins the dimensions. Scene units are feet (sizeFt in
// js/decorlib.js - the plan records metres; TILT lays out in feet).
// Geometry is built at final size: the small rail is its own model with
// its own lattice count, never a scaled copy of the large one (the plan
// forbids deriving it that way).
//
// Depth / cross-sections are not_measured in the plan - every such number
// below is a commented visual estimate for the preview, never a
// tolerance. The sheet ships this procedural cutwork stand-in until the
// real GLB lands at models/decor/decorative_arch_panel_sheet.glb; the
// loader swaps it in (and warns when the file is off catalog by >5%).

import * as THREE from 'three';
import { decorAsset, M_PER_FT } from '../decorlib.js';

// Visual estimates for the unmeasured cross-sections (feet), read off
// the pillar-rail spec: box beam with a cap, round rod lattice, layered
// plate ends that staircase past the beams.
const RAIL = {
    beamF: 0.17,     // beam height as a fraction of the rail height
    insetF: 0.055,   // how far the end plates stand past the beams
    webF: 0.62,      // web's share of the beam (rest = the cap lip)
    beamZ: 0.13,     // beam web depth into Z
    capZ: 0.17,      // cap depth into Z (the widest part)
    rod: 0.045,      // lattice rod diameter - round MS rod (~0.55 in)
    endW: 0.13,      // one layered plate's width along X
    endGap: 0.025,   // gap between the layered plates
    endT: 0.15,      // plate thickness into Z
    // Outer plate full height, stepping down inwards: the spec's
    // staircase silhouette, centred on the rail's mid-line.
    endHeights: [1, 0.78, 0.58],
    // Diamond counts chosen per size: same design family, independently
    // modelled - this is what keeps the small rail a real second asset.
    latticeCols: { large: 12, small: 7 }
};

// The arch spec states 6 mm (0.24 in); the catalog still records
// thickness as not_measured, so this value is the stand-in only - it
// exists until the supplied GLB replaces it.
const SHEET_T = 0.006 / M_PER_FT;
const SHEET_URL = 'models/decor/decorative_arch_panel_sheet.glb';

function disposeParts(root) {
    const mats = new Set();
    root.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
            for (const m of Array.isArray(o.material) ? o.material : [o.material]) mats.add(m);
        }
    });
    for (const m of mats) m.dispose();
}

// Clip the line y = m*x + c (m = +/-1) against the inner rectangle and
// return the segment endpoints, or null when it misses.
function latticeSegment(m, c, halfW, halfH) {
    let lo = -halfW, hi = halfW;
    const yLo = m === 1 ? -halfH - c : c - halfH;
    const yHi = m === 1 ? halfH - c : c + halfH;
    lo = Math.max(lo, yLo);
    hi = Math.min(hi, yHi);
    if (hi - lo < 1e-6) return null;
    return [[lo, m * lo + c], [hi, m * hi + c]];
}

function buildRailContent(asset, kind) {
    const [L, H] = asset.sizeFt;
    const cols = RAIL.latticeCols[kind] || RAIL.latticeCols.large;
    const gold = new THREE.MeshStandardMaterial({
        color: 0xd9a441, metalness: 0.85, roughness: 0.3
    });
    const content = new THREE.Group();

    const beamH = H * RAIL.beamF;
    const inset = H * RAIL.insetF;
    const webH = beamH * (1 - RAIL.webF);
    const capH = beamH - webH;
    const endAsmW = 3 * RAIL.endW + 2 * RAIL.endGap;
    const span = L - 2 * endAsmW;

    // main_frame: top and bottom box beams, each a web under a wider cap
    // lip (the spec's box/angle section), butt-jointed into the end
    // plates and inset so the plates staircase past them.
    const frame = new THREE.Group();
    frame.name = 'main_frame';
    const beam = sign => {
        const g = new THREE.Group();
        const edge = sign * (H / 2 - inset);
        const web = new THREE.Mesh(
            new THREE.BoxGeometry(span, webH, RAIL.beamZ), gold);
        web.position.y = edge - sign * (capH + webH / 2);
        const cap = new THREE.Mesh(
            new THREE.BoxGeometry(span, capH, RAIL.capZ), gold);
        cap.position.y = edge - sign * (capH / 2);
        g.add(web, cap);
        return g;
    };
    frame.add(beam(1), beam(-1));
    content.add(frame);

    // diamond_lattice: two clipped diagonal families of round rods -
    // real rods, real gaps, no backing.
    const lattice = new THREE.Group();
    lattice.name = 'diamond_lattice';
    const halfW = span / 2 - 0.012;
    const halfH = H / 2 - inset - beamH - 0.012;
    const cMax = halfW + halfH;
    const rodR = RAIL.rod / 2;
    for (let i = 0; i < cols; i++) {
        const c = cols === 1 ? 0 : -cMax + i * (2 * cMax / (cols - 1));
        for (const m of [1, -1]) {
            const seg = latticeSegment(m, c, halfW, halfH);
            if (!seg) continue;
            const [[x0, y0], [x1, y1]] = seg;
            const len = Math.hypot(x1 - x0, y1 - y0);
            const rod = new THREE.Mesh(
                new THREE.CylinderGeometry(rodR, rodR, len + rodR, 6), gold);
            rod.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0);
            rod.rotation.z = Math.atan2(y1 - y0, x1 - x0) - Math.PI / 2;
            lattice.add(rod);
        }
    }
    content.add(lattice);

    // end supports: three layered plates per end, heights stepping down
    // towards the middle - the spec's staircase, kept inside the
    // catalog length.
    const addEnd = sign => {
        const g = new THREE.Group();
        g.name = sign < 0 ? 'left_end_support' : 'right_end_support';
        RAIL.endHeights.forEach((frac, i) => {
            const outer = L / 2 - i * (RAIL.endW + RAIL.endGap) - RAIL.endW / 2;
            const plate = new THREE.Mesh(
                new THREE.BoxGeometry(RAIL.endW, H * frac, RAIL.endT), gold);
            plate.position.x = sign * outer;
            g.add(plate);
        });
        return g;
    };
    content.add(addEnd(-1), addEnd(1));
    return content;
}

/* ---------------------------------------------------- the arch sheet */

// One scalloped-circle hole: an eight-petal daisy, as the side strips
// carry in the spec.
function daisyPath(cx, cy, rOut, rIn, petals) {
    const p = new THREE.Path();
    const N = petals * 8;
    for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2;
        const lobe = 0.5 + 0.5 * Math.cos(petals * a);
        const r = rIn + (rOut - rIn) * Math.pow(lobe, 0.75);
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        if (i === 0) p.moveTo(x, y); else p.lineTo(x, y);
    }
    p.closePath();
    return p;
}

// A teardrop hole centred at (cx, cy): round bulb, pointed tip, local
// outline rotated by rot about the centre. Inputs to map/put are offsets
// from (cx, cy), never absolute sheet coordinates.
function dropPath(cx, cy, w, h, tipDown, rot) {
    const r = w / 2;
    const cos = Math.cos(rot || 0), sin = Math.sin(rot || 0);
    const map = (dx, dy) =>
        [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
    const p = new THREE.Path();
    const put = (dx, dy) => p.lineTo(...map(dx, dy));
    // Tip at one end, bulb at the other; outline runs tip -> around the
    // bulb -> back to the tip (lineTo closes onto the moveTo start).
    const top = h / 2, bot = -h / 2;
    const tipY = tipDown ? bot : top;
    const bulbY = tipDown ? top - r : bot + r;
    p.moveTo(...map(0, tipY));
    const dir = tipDown ? 1 : -1;
    p.quadraticCurveTo(...map(-r, tipY + dir * h * 0.3), ...map(-r, bulbY));
    // Sample the bulb arc away from the tip: over the top when the bulb
    // is up (PI -> 0), under the bottom when it is down (PI -> 2PI).
    // Both run left -> right so the closing curve starts at (+r, bulbY).
    const steps = 12;
    for (let i = 1; i <= steps; i++) {
        const ang = Math.PI + (tipDown ? -(i / steps) : (i / steps)) * Math.PI;
        put(Math.cos(ang) * r, bulbY + Math.sin(ang) * r);
    }
    p.quadraticCurveTo(...map(r, tipY + dir * h * 0.3), ...map(0, tipY));
    p.closePath();
    return p;
}

// The sheet's outline: outer rectangle minus the cusped arch, the daisy
// columns, the drops, the lotus fans and the scroll ornaments. Returns
// the shape for ExtrudeGeometry - real through-cuts, no backing.
function sheetShape(W, H) {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(W, 0);
    shape.lineTo(W, H);
    shape.lineTo(0, H);
    shape.closePath();

    const cx = W / 2;
    const xL = 0.5, xR = W - 0.5;      // arch jambs (border 0.16 + strip)
    const y0 = 0.36;                   // top of the solid bottom rail
    const yS = 3.8, yA = 5.3;          // spring line and apex
    const n = 3, amp = 0.16;           // scallop lobes per rise

    // The dominant void: a cusped Mughal arch with a pendant drop at
    // the apex. Wound against the outer rectangle (up the left, down
    // the right, back along the bottom).
    const arch = new THREE.Path();
    arch.moveTo(xL, y0);
    arch.lineTo(xL, yS);
    const endX = cx - 0.1, endY = yA - 0.07;
    for (let k = 1; k <= n; k++) {
        const t0 = (k - 1) / n, t1 = k / n;
        const xa = xL + (endX - xL) * t0, ya = yS + (endY - yS) * t0;
        const xb = xL + (endX - xL) * t1, yb = yS + (endY - yS) * t1;
        arch.quadraticCurveTo((xa + xb) / 2 + amp, (ya + yb) / 2, xb, yb);
    }
    // Pendant finial hanging from the apex into the opening.
    arch.quadraticCurveTo(cx - 0.03, yA - 0.16, cx, yA - 0.27);
    arch.quadraticCurveTo(cx + 0.03, yA - 0.16, cx + 0.1, yA - 0.07);
    // Mirror the scalloped rise down the right jamb.
    for (let k = 1; k <= n; k++) {
        const t0 = (k - 1) / n, t1 = k / n;
        const xa = (cx + 0.1) + (xR - (cx + 0.1)) * t0;
        const ya = (yA - 0.07) + (yS - (yA - 0.07)) * t0;
        const xb = (cx + 0.1) + (xR - (cx + 0.1)) * t1;
        const yb = (yA - 0.07) + (yS - (yA - 0.07)) * t1;
        arch.quadraticCurveTo((xa + xb) / 2 - amp, (ya + yb) / 2, xb, yb);
    }
    arch.lineTo(xR, y0);
    arch.lineTo(xL, y0);
    arch.closePath();
    shape.holes.push(arch);

    // Side strips: a hanging drop under the spring, five daisies down
    // the column, a lotus fan sitting on the bottom rail.
    const strip = 0.33;
    for (const sx of [strip, W - strip]) {
        shape.holes.push(dropPath(sx, 4.12, 0.2, 0.5, true, 0));
        for (const fy of [3.5, 2.95, 2.4, 1.85, 1.3]) {
            shape.holes.push(daisyPath(sx, fy, 0.13, 0.06, 8));
        }
        // Lotus fan: scalloped dome opening upward.
        const fan = new THREE.Path();
        const fw = 0.3, fh = 0.42, fyc = 0.62;
        const N = 36;
        for (let i = 0; i <= N; i++) {
            const t = i / N;
            const ang = Math.PI * t;
            const lobe = 0.78 + 0.22 * Math.sin(t * Math.PI * 5);
            const x = sx - Math.cos(ang) * (fw / 2) * lobe;
            const y = fyc + Math.sin(ang) * fh * lobe;
            if (i === 0) fan.moveTo(x, y); else fan.lineTo(x, y);
        }
        fan.closePath();
        shape.holes.push(fan);

        // Spandrel scrolls beside the arch head.
        shape.holes.push(dropPath(sx + (sx < cx ? 0.05 : -0.05), 4.62, 0.16, 0.42, false,
            sx < cx ? -0.5 : 0.5));
        shape.holes.push(dropPath(sx + (sx < cx ? 0.08 : -0.08), 5.08, 0.13, 0.34, false,
            sx < cx ? -0.3 : 0.3));
    }

    // Top ornament: a central upright leaf flanked by two scroll drops.
    shape.holes.push(daisyPath(cx, 5.72, 0.16, 0.05, 6));
    shape.holes.push(dropPath(cx - 0.42, 5.66, 0.14, 0.36, false, -0.7));
    shape.holes.push(dropPath(cx + 0.42, 5.66, 0.14, 0.36, false, 0.7));

    return shape;
}

// The sheet's GLB attempt: one per session, failures resolve null so the
// procedural stand-in stays. Dynamic import keeps the static import graph
// (and node-based tests) free of the addons loader.
let sheetLoad = null;
function loadSheetGltf() {
    if (!sheetLoad) {
        sheetLoad = import('three/addons/loaders/GLTFLoader.js')
            .then(({ GLTFLoader }) => new Promise(resolve => {
                try {
                    new GLTFLoader().load(SHEET_URL, g => resolve(g),
                        undefined, () => resolve(null));
                } catch { resolve(null); }
            }))
            .catch(() => null);
    }
    return sheetLoad;
}

export function createPillarRailModel(kind) {
    const small = kind === 'small';
    const asset = decorAsset(small ? 'pillar_rail_small' : 'pillar_rail_large');
    const H = asset.sizeFt[1];
    const root = new THREE.Group();
    root.name = asset.id;
    const state = { kind: small ? 'small' : 'large' };

    function build() {
        disposeParts(root);
        root.clear();
        // Local geometry is centred (the plan's origin), the node lifts
        // by half a height so the bottom sits on the ground.
        root.position.y = H / 2;
        root.add(buildRailContent(asset, small ? 'small' : 'large'));
    }
    build();

    return {
        id: asset.id,
        name: asset.name,
        object3D: root,
        params: {},
        state,
        build,
        dispose() { disposeParts(root); root.clear(); }
    };
}

export function createArchPanelModel() {
    const asset = decorAsset('decorative_arch_panel_sheet');
    const [W, H] = asset.sizeFt;
    const root = new THREE.Group();
    root.name = asset.id;
    const state = { modelStatus: 'placeholder' };
    let token = 0;
    let dead = false;

    function build() {
        const mine = ++token;
        disposeParts(root);
        root.clear();
        root.position.y = H / 2;
        const white = new THREE.MeshStandardMaterial({
            color: 0xf5f5f0, metalness: 0, roughness: 0.8
        });
        // Real through-cuts: the shape minus its holes, extruded 6 mm.
        const geo = new THREE.ExtrudeGeometry(sheetShape(W, H), {
            depth: SHEET_T, bevelEnabled: false, curveSegments: 10
        });
        geo.translate(-W / 2, -H / 2, -SHEET_T / 2);
        const sheet = new THREE.Mesh(geo, white);
        sheet.name = 'arch_panel_sheet';
        root.add(sheet);
        state.modelStatus = 'placeholder';
        loadSheetGltf().then(gltf => {
            if (dead || mine !== token || !gltf || !gltf.scene) return;
            try {
                const scene = gltf.scene;
                scene.updateMatrixWorld(true);
                const box = new THREE.Box3().setFromObject(scene);
                if (box.isEmpty()) return;
                const size = box.getSize(new THREE.Vector3());
                const tol = 0.05;
                if (Math.abs(size.x - W) / W > tol || Math.abs(size.y - H) / H > tol) {
                    console.warn('[decor] sheet file is off catalog by more than 5%',
                        { got: [size.x, size.y], want: [W, H] });
                }
                // Recentre on the local origin, then swap for the stand-in.
                scene.position.sub(box.getCenter(new THREE.Vector3()));
                disposeParts(root);
                root.clear();
                root.add(scene);
                state.modelStatus = 'loaded';
            } catch (err) {
                console.warn('[decor] sheet swap failed:', err);
            }
        });
    }
    build();

    return {
        id: asset.id,
        name: asset.name,
        object3D: root,
        params: {},
        state,
        build,
        dispose() { dead = true; disposeParts(root); root.clear(); }
    };
}

// One dispatcher for the tray preview and the editor's free-place mount.
export function createDecorModel(assetId) {
    if (assetId === 'pillar_rail_large') return createPillarRailModel('large');
    if (assetId === 'pillar_rail_small') return createPillarRailModel('small');
    if (assetId === 'decorative_arch_panel_sheet') return createArchPanelModel();
    return null;
}
