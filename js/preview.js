// The shared static-preview hub: one WebGL context renders any group into
// a transparent PNG data URL, one job per frame, cached per key. It is the
// pipeline behind home/models.js (catalog cards and the inspect sheet's
// fallback) and behind the Objects tray's card thumbnails in the editor
// (app.js owns the build callback, objectchip.js consumes the URLs).
//
// createPreviewHub({ build, width, height, tag }) =>
//   { ok(), cached(key), request(key, w?, h?), ready(), dispose() }
//
// - ready()/ok() lazily create the renderer on first use; no WebGL means
//   ok() stays false and every request resolves null (callers keep their
//   glyph/placeholder fallback).
// - cached(key) returns undefined on a miss, null for a known failure, or
//   the data URL - so a failed build is never retried within a session.
// - the framing is the models page's: log-span compression so a 0.06 ft
//   bloom and a 28 ft set both read at a comparable size in a small tile.

import * as THREE from 'three';

export function disposeTree(root) {
    root.traverse(o => {
        if (o.geometry) o.geometry.dispose();
    });
}

// Framing box: geometry only, skipping helpers flagged userData.noFraming
// (the PAR's 6.5 ft beam cone) - without that the beam would own the box
// and the fixture itself would shrink to a speck in the corner of the tile.
export function fitBox(root) {
    root.updateWorldMatrix(true, true);
    const box = new THREE.Box3();
    const part = new THREE.Box3();
    root.traverse(o => {
        if (!o.isMesh || !o.geometry || (o.userData && o.userData.noFraming)) return;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        if (!o.geometry.boundingBox) return;
        part.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
        box.union(part);
    });
    return box;
}

// Normalize scale so a PAR fixture and a full S-curve frame read at a
// comparable size, then frame the box on the given camera. (Named frameTile
// because viewer.js already owns a different top-level frameCamera in the
// bundled editor.)
export function frameTile(camera, group) {
    // Reset first so a re-frame (resize, pinch) measures the original
    // geometry instead of the already-scaled box - keeps this idempotent.
    group.scale.setScalar(1);
    let box = fitBox(group);
    if (box.isEmpty()) throw new Error('empty bounds');
    let size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;

    // Real spans run from a ~0.06 ft bloom (measured: dahlia 0.06, marigold
    // 0.10, rose 0.18) to a 28 ft set (par 0.62, strip 6, panel 8, set 28).
    // Above half a foot, compress through a log scale onto the fill depth -
    // card sizes keep the catalogue's ordering while staying legible.
    const SPAN_MIN = 0.5, SPAN_MAX = 30; // feet, main curve
    const FILL_MIN = 0.65, FILL_MAX = 1;  // fraction of the fit depth
    // Below that, come down steeply: the old 0.65 floor made a 2 inch rose
    // read as big as a PAR. Blooms land at ~17-26% of the tile instead.
    const TINY_MIN = 0.05, TINY_FILL = 0.2;
    const span = Math.min(SPAN_MAX, Math.max(TINY_MIN, maxDim));
    let fill;
    if (span >= SPAN_MIN) {
        const t = Math.log(span / SPAN_MIN) / Math.log(SPAN_MAX / SPAN_MIN);
        fill = FILL_MIN + (FILL_MAX - FILL_MIN) * t;
    } else {
        const t = (span - TINY_MIN) / (SPAN_MIN - TINY_MIN);
        fill = TINY_FILL + (FILL_MIN - TINY_FILL) * t;
    }
    group.scale.setScalar((2.6 * fill) / maxDim);

    box = fitBox(group);
    const center = box.getCenter(new THREE.Vector3());
    size = box.getSize(new THREE.Vector3());

    const fov = camera.fov * Math.PI / 180;
    const fit = Math.max(size.y / (2 * Math.tan(fov / 2)),
                         size.x / (2 * Math.tan(fov / 2) * camera.aspect)) * 1.25 + 0.2;
    const dir = group.userData.face
        ? new THREE.Vector3(0.35, 0.25, 1).normalize()
        : new THREE.Vector3(0.65, 0.45, 1).normalize();
    camera.position.copy(center).addScaledVector(dir, fit);
    camera.lookAt(center);
    camera.updateProjectionMatrix();
    // Base pose for pinch zoom: zoom scales the offset, never the framing.
    camera.userData.target = center;
    camera.userData.basePos = camera.position.clone();
}

// How a bare fixture schema should be seeded for a preview: floor uplights
// stand aimed AT the fabric, never at the ground (the entrance rig's own
// rule); the bare schema defaults point down.
export const PREVIEW_INIT = {
    'light-par': { tilt: -45 },
    'light-led': { tilt: -55 }
};

export function createPreviewHub({ build, width = 480, height = 360, tag = 'preview' }) {
    const state = {
        renderer: null, scene: null, camera: null,
        ok: false, inited: false,
        queue: [], running: false,
        cache: new Map()
    };

    function ready() {
        if (state.inited) return state.ok;
        state.inited = true;
        try {
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
            if (!gl) return state.ok;
            state.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
            state.renderer.setSize(width, height, false);
            state.renderer.setPixelRatio(1);
            state.renderer.setClearColor(0x000000, 0);
            state.scene = new THREE.Scene();
            state.camera = new THREE.PerspectiveCamera(32, 4 / 3, 0.05, 200);
            const hemi = new THREE.HemisphereLight(0xffffff, 0x9aa3b2, 1.15);
            const key = new THREE.DirectionalLight(0xffffff, 1.35);
            key.position.set(3, 6, 4);
            const rim = new THREE.DirectionalLight(0xdbeafe, 0.5);
            rim.position.set(-4, 2, -3);
            state.scene.add(hemi, key, rim);
            state.ok = true;
        } catch (err) {
            console.warn('[' + tag + '] preview renderer unavailable:', err);
            state.ok = false;
        }
        return state.ok;
    }

    function renderGroup(group, w, h) {
        state.renderer.setSize(w, h, false);
        state.camera.aspect = w / h;
        state.scene.add(group);
        try {
            state.renderer.render(state.scene, state.camera);
            return state.renderer.domElement.toDataURL('image/png');
        } finally {
            state.scene.remove(group);
        }
    }

    async function pump() {
        if (state.running || !state.ok) return;
        state.running = true;
        while (state.queue.length) {
            const job = state.queue.shift();
            let url = null;
            try {
                const group = await build(job.key);
                frameTile(state.camera, group);
                url = renderGroup(group, job.w, job.h);
                disposeTree(group);
            } catch (err) {
                console.warn('[' + tag + '] preview failed for', job.key, err);
            }
            state.cache.set(job.key, url);
            job.resolve(url);
            // One frame between jobs keeps the page responsive while the queue drains.
            await new Promise(r => setTimeout(r, 0));
        }
        state.running = false;
    }

    return {
        ready,
        ok: () => ready(),
        cached: key => (state.cache.has(key) ? state.cache.get(key) : undefined),
        request(key, w = width, h = height) {
            if (!ready()) return Promise.resolve(null);
            if (state.cache.has(key)) return Promise.resolve(state.cache.get(key));
            return new Promise(resolve => {
                state.queue.push({ key, w, h, resolve });
                pump();
            });
        },
        dispose() {
            if (state.renderer) {
                state.renderer.dispose();
                state.renderer.forceContextLoss && state.renderer.forceContextLoss();
            }
            state.renderer = null;
            state.scene = null;
            state.camera = null;
            state.ok = false;
            state.inited = false;
            state.queue.length = 0;
        }
    };
}
