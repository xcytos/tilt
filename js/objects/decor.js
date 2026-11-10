// The three manufactured decor assets from
// plans/decor_element_library_3d_assets.json: two lattice rails and the
// arch-panel sheet. Scene units are feet (sizeFt in js/decorlib.js - the
// plan records metres; TILT lays out in feet). Geometry is built at final
// size: the small rail is its own model with its own lattice count, never
// a scaled copy of the large one (the plan forbids deriving it that way).
//
// Depth / cross-sections are not_measured in the plan - every such number
// below is a commented visual estimate for the preview, never a
// tolerance. The sheet ships a placeholder box until the real GLB lands
// at models/decor/decorative_arch_panel_sheet.glb; the loader swaps it in
// (and warns when the file is off catalog by more than 5%).

import * as THREE from 'three';
import { decorAsset, M_PER_FT } from '../decorlib.js';

// Visual estimates for the unmeasured cross-sections (feet).
const RAIL = {
    member: 0.16,   // frame member width        (~2 in)
    depth: 0.15,    // rail depth into Z         (~1.8 in)
    rod: 0.04,      // lattice rod thickness     (~1/2 in)
    rodZ: 0.08,     // lattice rod depth into Z
    endW: 0.22,     // end-support plate width
    endGap: 0.02,   // gap between layered plates
    endZ: 0.09,     // end-support plate depth into Z (inside the frame)
    endHeights: [1, 0.7, 0.45],  // stepped layered silhouette, per end
    // Diamond counts chosen per size: same design family, independently
    // modelled - this is what keeps the small rail a real second asset.
    latticeCols: { large: 7, small: 5 }
};

// 6 mm was the plan's previous working thickness assumption; the catalog
// records thickness as not_measured, so this box alone may use it - it
// exists only until the supplied GLB replaces it.
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

    // main_frame: four members, horizontals abutting the full-height
    // verticals so no two faces share a plane.
    const frame = new THREE.Group();
    frame.name = 'main_frame';
    const horiz = new THREE.BoxGeometry(L - 2 * RAIL.member, RAIL.member, RAIL.depth);
    const top = new THREE.Mesh(horiz, gold);
    top.position.y = H / 2 - RAIL.member / 2;
    const bot = new THREE.Mesh(horiz, gold);
    bot.position.y = -(H / 2 - RAIL.member / 2);
    const vert = new THREE.BoxGeometry(RAIL.member, H, RAIL.depth);
    const left = new THREE.Mesh(vert, gold);
    left.position.x = -(L / 2 - RAIL.member / 2);
    const right = new THREE.Mesh(vert, gold);
    right.position.x = L / 2 - RAIL.member / 2;
    frame.add(top, bot, left, right);
    content.add(frame);

    // diamond_lattice: two clipped diagonal families - real rods, real
    // gaps, no backing.
    const lattice = new THREE.Group();
    lattice.name = 'diamond_lattice';
    const halfW = (L - 2 * (RAIL.member + 0.01)) / 2;
    const halfH = (H - 2 * (RAIL.member + 0.01)) / 2;
    const cMax = halfW + halfH;
    for (let i = 0; i < cols; i++) {
        const c = cols === 1 ? 0 : -cMax + i * (2 * cMax / (cols - 1));
        for (const m of [1, -1]) {
            const seg = latticeSegment(m, c, halfW, halfH);
            if (!seg) continue;
            const [[x0, y0], [x1, y1]] = seg;
            const len = Math.hypot(x1 - x0, y1 - y0);
            const rod = new THREE.Mesh(
                new THREE.BoxGeometry(len, RAIL.rod, RAIL.rodZ), gold);
            rod.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0);
            rod.rotation.z = Math.atan2(y1 - y0, x1 - x0);
            lattice.add(rod);
        }
    }
    content.add(lattice);

    // end supports: three stepped plates per end, layered along X and
    // kept inside the catalog length.
    const addEnd = sign => {
        const g = new THREE.Group();
        g.name = sign < 0 ? 'left_end_support' : 'right_end_support';
        RAIL.endHeights.forEach((frac, i) => {
            const outer = L / 2 - i * (RAIL.endW + RAIL.endGap) - RAIL.endW / 2;
            const plate = new THREE.Mesh(
                new THREE.BoxGeometry(RAIL.endW, H * frac, RAIL.endZ), gold);
            plate.position.x = sign * outer;
            g.add(plate);
        });
        return g;
    };
    content.add(addEnd(-1), addEnd(1));
    return content;
}

// The sheet's GLB attempt: one per session, failures resolve null so the
// placeholder stays. Dynamic import keeps the static import graph (and
// node-based tests) free of the addons loader.
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
        const ph = new THREE.Mesh(new THREE.BoxGeometry(W, H, SHEET_T), white);
        ph.name = 'arch_panel_sheet';
        root.add(ph);
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
                // Recentre on the local origin, then swap for the placeholder.
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
