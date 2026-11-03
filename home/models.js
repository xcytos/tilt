/* TILT models page. An ES module (unlike home.js) because it drives the same
   three.js factories the editor uses - the previews are the real assets, never
   stand-in images. The catalog itself comes from js/assetlib.js, fed by the
   authoritative registries: models/manifest.json + Registry types, plus the
   flower and greenery species engines. */
import * as THREE from 'three';
import { Registry } from '../js/registry.js';
import { createO2TiltModel, PARAMS as O2TILT_PARAMS } from '../js/objects/o2tilt.js';
import { createPillarModel, PILLAR_ID, PILLAR_NAME, PILLAR_SUBTITLE, PILLAR_PARAMS } from '../js/objects/pillar.js';
import { createFlowerPanelModel, FLOWERPANEL_ID, FLOWERPANEL_NAME, FLOWERPANEL_SUBTITLE, FLOWERPANEL_PARAMS } from '../js/objects/flowerpanel.js';
import { createLightModel, LIGHT_TYPES, LIGHT_NAMES, LIGHT_PARAMS } from '../js/elements/light.js';
import { FlowerEngine } from '../js/flowers/flower-factory.js';
import { GreeneryEngine } from '../js/greenery/greenery-factory.js';
import { buildCatalog, filterAssets, facetCounts, ASSET_TYPES } from './assetlib.js';

const $ = sel => document.querySelector(sel);

const state = {
    catalog: null,
    defs: {},
    query: '',
    type: 'all',
    category: 'all',
    sort: 'name',
    selected: null
};

/* ----------------------------------------------------------------- theme */
$('#btn-theme').addEventListener('click', () => {
    const dark = document.documentElement.classList.toggle('dark');
    try { localStorage.setItem('o2tilt-theme', dark ? 'dark' : 'light'); } catch (e) { /* private mode */ }
});

/* --------------------------------------------------------------- registry */
// Same registrations app.js performs - one source of factories, no copies.
async function loadSources() {
    const registry = new Registry('./models');
    registry.register('o2tilt-frame', createO2TiltModel, O2TILT_PARAMS);
    registry.register(PILLAR_ID, createPillarModel, PILLAR_PARAMS);
    registry.register(FLOWERPANEL_ID, createFlowerPanelModel, FLOWERPANEL_PARAMS);
    for (const t of LIGHT_TYPES) {
        const kind = t.slice(6);
        registry.register(t, p => createLightModel(t, p), LIGHT_PARAMS[kind]);
    }

    let entries = [];
    let manifestFailed = '';
    try {
        entries = await registry.loadManifest();
        for (const e of entries) {
            try { state.defs[e.id] = await registry.load(e.id); }
            catch (err) { manifestFailed += e.id + ': ' + err.message + ' '; }
        }
    } catch (err) {
        manifestFailed = err.message;
    }

    const types = [
        { type: 'o2tilt-frame', name: 'S Curve Frame', subtitle: '',
          source: { kind: 'file', path: 'js/objects/o2tilt.js' },
          params: Object.keys(O2TILT_PARAMS) },
        { type: PILLAR_ID, name: PILLAR_NAME, subtitle: PILLAR_SUBTITLE,
          source: { kind: 'file', path: 'js/objects/pillar.js' },
          params: Object.keys(PILLAR_PARAMS) },
        { type: FLOWERPANEL_ID, name: FLOWERPANEL_NAME, subtitle: FLOWERPANEL_SUBTITLE,
          source: { kind: 'file', path: 'js/objects/flowerpanel.js' },
          params: Object.keys(FLOWERPANEL_PARAMS) },
        ...LIGHT_TYPES.map(t => ({
            type: t, name: LIGHT_NAMES[t], subtitle: 'Anchor element',
            source: { kind: 'file', path: 'js/elements/light.js' },
            params: Object.keys(LIGHT_PARAMS[t.slice(6)])
        }))
    ];

    const flowers = FlowerEngine.list().map(s => ({ type: s.type, label: s.label }));
    const greenery = GreeneryEngine.list().map(s => ({ type: s.type, label: s.label }));

    const manifest = {
        entries: entries.map(e => ({ id: e.id, name: e.name, file: e.file, tags: e.tags })),
        defs: {}
    };
    for (const [id, def] of Object.entries(state.defs)) {
        manifest.defs[id] = {
            objects: (def.objects || []).map(o => ({ type: o.type })),
            elements: (def.objects || []).flatMap(o => (o.elements || []).map(e => ({ type: e.type })))
        };
    }

    return { registry, catalog: buildCatalog({ manifest, types, flowers, greenery }), manifestFailed };
}

/* ------------------------------------------------------------- previews */
// One shared renderer for the whole page: cards render on demand into a
// data URL, the GL context is never multiplied per card, and everything is
// disposed on pagehide. No WebGL (or a failed build) degrades to a labelled
// placeholder - the catalog stays browsable either way.
const previews = {
    renderer: null,
    scene: null,
    camera: null,
    ok: false,
    queue: [],
    running: false,
    cache: new Map()
};

function initPreviews() {
    try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
        if (!gl) return;
        previews.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
        previews.renderer.setSize(480, 360, false);
        previews.renderer.setPixelRatio(1);
        previews.renderer.setClearColor(0x000000, 0);
        previews.scene = new THREE.Scene();
        previews.camera = new THREE.PerspectiveCamera(32, 4 / 3, 0.05, 200);
        const hemi = new THREE.HemisphereLight(0xffffff, 0x9aa3b2, 1.15);
        const key = new THREE.DirectionalLight(0xffffff, 1.35);
        key.position.set(3, 6, 4);
        const rim = new THREE.DirectionalLight(0xdbeafe, 0.5);
        rim.position.set(-4, 2, -3);
        previews.scene.add(hemi, key, rim);
        previews.ok = true;
    } catch (err) {
        console.warn('[models] preview renderer unavailable:', err);
        previews.ok = false;
    }
}

function disposeTree(root) {
    root.traverse(o => {
        if (o.geometry) o.geometry.dispose();
    });
}

// Species previews: a handful of blooms / a few stems, built by the very
// engines the Studio uses. Flowers and greenery face +Z, so the camera
// comes from +Z; everything else is Y-up.
function buildSpecies(asset) {
    const group = new THREE.Group();
    if (asset.primaryCategory === 'Flowers') {
        const type = asset.id.slice('flower:'.length);
        // A compact sprig: three blooms spaced about one bloom-width apart,
        // through the same flowers[]/colors[] API the Studio builds with.
        const { meshes } = FlowerEngine.build({
            type,
            flowers: [
                { x: 0, y: 0.08, seed: 11, colorIndex: 0 },
                { x: 0.3, y: -0.08, seed: 4, colorIndex: 1 },
                { x: -0.28, y: -0.12, seed: 7, colorIndex: 0 }
            ],
            colors: [new THREE.Color(0xe8a4b8), new THREE.Color(0xf6c9d8)],
            S: 1.15,
            detail: 0.7
        });
        for (const m of meshes) group.add(m);
        group.userData.face = true;
    } else {
        const type = asset.id.slice('greenery:'.length);
        const { meshes } = GreeneryEngine.build({
            type,
            items: [
                { x: 0, y: 0, z: 0, rot: 0, scale: 1, variant: 0 },
                { x: 0.5, y: 0.3, z: -0.2, rot: 0.7, scale: 0.85, variant: 1 },
                { x: -0.45, y: -0.2, z: 0.1, rot: -0.5, scale: 0.9, variant: 0 }
            ],
            color: '#4a7c3f',
            detail: 0.7
        });
        for (const m of meshes) group.add(m);
        group.userData.face = true;
    }
    return group;
}

async function buildAssetGroup(asset) {
    if (asset.id.startsWith('flower:') || asset.id.startsWith('greenery:')) {
        return buildSpecies(asset);
    }
    if (asset.assetType === 'model') {
        const def = await previews.registry.load(asset.id);
        const { models } = await previews.registry.instantiate(def);
        const group = new THREE.Group();
        for (const m of models) if (m && m.object3D) group.add(m.object3D);
        return group;
    }
    const reg = previews.registry.types.get(asset.id);
    if (!reg) throw new Error('no factory for ' + asset.id);
    // Floor uplights stand aimed AT the fabric, never at the ground (the
    // entrance rig's own rule); the bare schema defaults point down.
    const init = {};
    if (asset.id === 'light-par') init.tilt = -45;
    else if (asset.id === 'light-led') init.tilt = -55;
    const model = reg.factory(init);
    const group = new THREE.Group();
    if (model && model.object3D) group.add(model.object3D);
    else if (model && model.isObject3D) group.add(model);
    return group;
}

// Framing box: geometry only, skipping helpers flagged userData.noFraming
// (the PAR's 6.5 ft beam cone) - without that the beam would own the box
// and the fixture itself would shrink to a speck in the corner of the tile.
function fitBox(root) {
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
// comparable size, then frame the box on the given camera.
function frameCamera(camera, group) {
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

function renderGroup(group, w, h) {
    previews.renderer.setSize(w, h, false);
    previews.camera.aspect = w / h;
    previews.scene.add(group);
    try {
        previews.renderer.render(previews.scene, previews.camera);
        return previews.renderer.domElement.toDataURL('image/png');
    } finally {
        previews.scene.remove(group);
    }
}

function enqueuePreview(asset, w, h) {
    const key = asset.id + '@' + w;
    if (previews.cache.has(key)) return Promise.resolve(previews.cache.get(key));
    return new Promise(resolve => {
        previews.queue.push({ asset, w, h, key, resolve });
        pumpQueue();
    });
}

async function pumpQueue() {
    if (previews.running || !previews.ok) return;
    previews.running = true;
    while (previews.queue.length) {
        const job = previews.queue.shift();
        let url = null;
        try {
            const group = await buildAssetGroup(job.asset);
            frameCamera(previews.camera, group);
            url = renderGroup(group, job.w, job.h);
            disposeTree(group);
        } catch (err) {
            console.warn('[models] preview failed for', job.asset.id, err);
        }
        previews.cache.set(job.key, url);
        job.resolve(url);
        // One frame between jobs keeps the page responsive while the queue drains.
        await new Promise(r => setTimeout(r, 0));
    }
    previews.running = false;
}

window.addEventListener('pagehide', () => {
    liveStop();
    if (previews.renderer) {
        previews.renderer.dispose();
        previews.renderer.forceContextLoss && previews.renderer.forceContextLoss();
    }
    previews.renderer = null;
    previews.ok = false;
});

/* -------------------------------------------------------------------- UI */
const TYPE_LABELS = { all: 'All assets', model: 'Models', object: 'Objects', element: 'Elements', component: 'Components' };

function visibleAssets() {
    const list = filterAssets(state.catalog.assets, state);
    const by = {
        name: (a, b) => a.name.localeCompare(b.name),
        type: (a, b) => (a.assetType + a.name).localeCompare(b.assetType + b.name),
        category: (a, b) => (a.primaryCategory + a.name).localeCompare(b.primaryCategory + b.name)
    };
    list.sort(by[state.sort] || by.name);
    return list;
}

function renderChips() {
    // Facet counts, not global ones: every option and chip counts under the
    // OTHER filters, so each number is a result you can actually reach. An
    // unselected option/chip with a zero count is disabled; the selected one
    // stays live so the filter can be switched back off.
    const facets = facetCounts(state.catalog.assets, state);
    const typeBox = $('#type-chips');
    typeBox.textContent = '';
    for (const key of ['all'].concat(ASSET_TYPES)) {
        const n = facets.types[key] || 0;
        const o = document.createElement('option');
        o.value = key;
        o.textContent = (TYPE_LABELS[key] || key) + ' (' + n + ')';
        o.disabled = state.type !== key && n === 0;
        typeBox.appendChild(o);
    }
    typeBox.value = state.type;

    const catBox = $('#cat-chips');
    catBox.textContent = '';
    const cats = [{ name: 'all', count: facets.categories.all || 0 }]
        .concat(state.catalog.categories.map(c => ({
            name: c.name, count: facets.categories[c.name] || 0
        })));
    for (const c of cats) {
        const selected = state.category === c.name;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip' + (selected ? ' is-on' : '');
        b.setAttribute('aria-pressed', String(selected));
        b.disabled = !selected && c.count === 0;
        const label = document.createElement('span');
        label.textContent = c.name === 'all' ? 'All categories' : c.name;
        const n = document.createElement('span');
        n.className = 'n';
        n.textContent = String(c.count);
        b.append(label, n);
        b.addEventListener('click', () => { state.category = selected ? 'all' : c.name; renderChips(); renderGrid(); });
        catBox.appendChild(b);
    }
}

const CUBE_SVG = () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.innerHTML = '<path d="M12 2 3 7v10l9 5 9-5V7l-9-5Z"></path><path d="M3 7l9 5 9-5M12 22V12"></path>';
    return svg;
};

function placeholder(text) {
    const ph = document.createElement('div');
    ph.className = 'ph';
    ph.appendChild(CUBE_SVG());
    const t = document.createElement('span');
    t.textContent = text;
    ph.appendChild(t);
    return ph;
}

function renderGrid() {
    const grid = $('#grid');
    const list = visibleAssets();
    grid.textContent = '';
    $('#empty').hidden = list.length > 0;
    $('#result').textContent = list.length === state.catalog.assets.length
        ? `${list.length} assets`
        : `${list.length} of ${state.catalog.assets.length} assets`;

    for (const asset of list) {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'card';
        card.setAttribute('aria-label', `Inspect ${asset.name}`);

        const thumb = document.createElement('div');
        thumb.className = 'thumb';
        if (previews.ok) {
            const spin = document.createElement('span');
            spin.className = 'spin';
            spin.textContent = 'loading';
            thumb.appendChild(spin);
            const io = new IntersectionObserver(entries => {
                if (!entries.some(e => e.isIntersecting)) return;
                io.disconnect();
                enqueuePreview(asset, 480, 360).then(url => {
                    spin.remove();
                    if (!url) { thumb.appendChild(placeholder('Preview unavailable')); return; }
                    const img = document.createElement('img');
                    img.alt = '';
                    img.src = url;
                    thumb.appendChild(img);
                });
            }, { rootMargin: '160px' });
            io.observe(card);
        } else {
            thumb.appendChild(placeholder('Preview unavailable'));
        }

        const body = document.createElement('div');
        body.className = 'card-body';
        const name = document.createElement('div');
        name.className = 'card-name';
        name.textContent = asset.name;
        const meta = document.createElement('div');
        meta.className = 'card-meta';
        const typePill = document.createElement('span');
        typePill.className = 'pill type';
        typePill.textContent = asset.assetType;
        meta.appendChild(typePill);
        const catPill = document.createElement('span');
        catPill.className = 'pill';
        catPill.textContent = asset.primaryCategory;
        meta.appendChild(catPill);
        if (asset.uncertain) {
            const warn = document.createElement('span');
            warn.className = 'pill warn';
            warn.textContent = 'review';
            meta.appendChild(warn);
        }
        body.append(name, meta);
        card.append(thumb, body);
        card.addEventListener('click', () => openSheet(asset));
        grid.appendChild(card);
    }
}

/* --------------------------------------------------------- inspect sheet */
function row(dl, label, valueNode) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    if (typeof valueNode === 'string') {
        const span = document.createElement('span');
        span.className = 'mono';
        span.textContent = valueNode;
        dd.appendChild(span);
    } else {
        dd.appendChild(valueNode);
    }
    dl.append(dt, dd);
}

/* ------------------------------------------------------- live sheet 3d
   Clicking a card opens a LIVE 3d preview: its own GL context (so a card
   thumbnail job can never resize this canvas), slow auto-rotation and drag
   to turn it, fully disposed when the sheet closes. If the build fails it
   falls back to the queued static render, then to the placeholder. */
const live = {
    renderer: null, scene: null, camera: null, group: null,
    canvas: null, asset: null, raf: 0, yaw: 0, auto: 0, drag: null, zoom: 1
};
const livePts = new Map(); // pointerId -> { x, y } for two-finger pinch
let pinch = null;          // { d0, zoom0 } while two fingers are down
let liveLast = 0;

function liveStop() {
    if (live.raf) cancelAnimationFrame(live.raf);
    live.raf = 0;
    window.removeEventListener('resize', onLiveResize);
    if (live.canvas) {
        live.canvas.removeEventListener('pointerdown', onLiveDown);
        live.canvas.removeEventListener('pointermove', onLiveMove);
        live.canvas.removeEventListener('pointerup', onLiveUp);
        live.canvas.removeEventListener('pointercancel', onLiveUp);
    }
    if (live.group) { disposeTree(live.group); live.group = null; }
    if (live.renderer) {
        live.renderer.dispose();
        if (live.renderer.forceContextLoss) live.renderer.forceContextLoss();
        live.renderer = null;
    }
    live.scene = null;
    live.camera = null;
    live.canvas = null;
    live.asset = null;
    live.drag = null;
    live.yaw = 0;
    live.auto = 0;
    live.zoom = 1;
    livePts.clear();
    pinch = null;
}

function applyZoom() {
    const cam = live.camera;
    const ud = cam && cam.userData;
    if (!ud || !ud.target || !ud.basePos) return;
    cam.position.copy(ud.target).addScaledVector(
        new THREE.Vector3().subVectors(ud.basePos, ud.target), live.zoom);
    cam.lookAt(ud.target);
}

// Orientation / keyboard-viewport changes: re-fit the canvas box and reframe
// without losing the pinch level.
function onLiveResize() {
    if (!live.renderer || !live.canvas || !live.group) return;
    const hero = live.canvas.parentElement;
    const w = hero.clientWidth || live.renderer.domElement.width;
    const h = hero.clientHeight || live.renderer.domElement.height;
    if (!w || !h) return;
    live.renderer.setSize(w, h, false);
    live.camera.aspect = w / h;
    frameCamera(live.camera, live.group);
    applyZoom();
    liveDraw();
}

function onLiveDown(e) {
    livePts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (live.canvas && live.canvas.setPointerCapture) {
        try { live.canvas.setPointerCapture(e.pointerId); } catch (err) { /* older */ }
    }
    if (livePts.size === 1) {
        live.drag = { x: e.clientX, yaw: live.yaw };
    } else if (livePts.size === 2) {
        // Second finger switches the gesture from rotate to pinch zoom.
        live.drag = null;
        const [a, b] = [...livePts.values()];
        pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom0: live.zoom };
    }
}

function onLiveMove(e) {
    const p = livePts.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX;
    p.y = e.clientY;
    if (pinch && livePts.size >= 2) {
        const [a, b] = [...livePts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        live.zoom = Math.min(2.4, Math.max(0.45, pinch.zoom0 * (d / pinch.d0)));
        applyZoom();
        if (!live.raf) liveDraw(); // reduced motion: redraw only on gesture
        return;
    }
    if (live.drag) {
        live.yaw = live.drag.yaw + (e.clientX - live.drag.x) * 0.012;
        // Reduced motion runs no frame loop - redraw only when the user drags.
        if (!live.raf) liveDraw();
    }
}

function onLiveUp(e) {
    livePts.delete(e.pointerId);
    if (livePts.size < 2) pinch = null;
    if (livePts.size === 1) {
        // One finger remains: pick rotation back up from where it is.
        const p = livePts.values().next().value;
        live.drag = { x: p.x, yaw: live.yaw };
    } else if (livePts.size === 0) {
        live.drag = null;
    }
}

function liveDraw() {
    if (!live.renderer || !live.group) return;
    const face = !!live.group.userData.face;
    live.group.rotation.y = live.yaw + (face ? Math.sin(live.auto) * 0.55 : live.auto);
    live.renderer.render(live.scene, live.camera);
}

function liveTick(now) {
    live.raf = requestAnimationFrame(liveTick);
    const dt = liveLast ? Math.min(0.05, (now - liveLast) / 1000) : 0;
    liveLast = now;
    if (!live.drag) live.auto += dt * 0.7;
    liveDraw();
}

function staticPreview(hero, asset) {
    if (!previews.ok) { hero.appendChild(placeholder('Preview unavailable')); return; }
    const spin = document.createElement('div');
    spin.className = 'ph';
    spin.textContent = 'Rendering…';
    hero.appendChild(spin);
    enqueuePreview(asset, 768, 480).then(url => {
        if (!hero.isConnected) return;
        spin.remove();
        if (!url) { hero.appendChild(placeholder('Preview unavailable')); return; }
        const img = document.createElement('img');
        img.alt = asset.name;
        img.src = url;
        hero.appendChild(img);
    });
}

async function attachLive(hero, asset) {
    if (!previews.ok) { hero.appendChild(placeholder('Preview unavailable')); return; }
    const spin = document.createElement('div');
    spin.className = 'ph';
    spin.textContent = 'Building 3D preview…';
    hero.appendChild(spin);

    let group = null;
    let renderer = null;
    try {
        group = await buildAssetGroup(asset);
        // The sheet was closed (or another asset opened) while building.
        if (state.selected !== asset) { disposeTree(group); return; }

        const canvas = document.createElement('canvas');
        canvas.className = 'sheet-3d';
        canvas.setAttribute('aria-label', '3D preview of ' + asset.name);
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
        renderer.setClearColor(0x000000, 0);

        const scene = new THREE.Scene();
        scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa3b2, 1.15));
        const key = new THREE.DirectionalLight(0xffffff, 1.35);
        key.position.set(3, 6, 4);
        const rim = new THREE.DirectionalLight(0xdbeafe, 0.5);
        rim.position.set(-4, 2, -3);
        scene.add(key, rim);

        const w = hero.clientWidth || 480;
        const h = hero.clientHeight || 300;
        renderer.setSize(w, h, false);
        const camera = new THREE.PerspectiveCamera(32, w / h, 0.05, 200);
        frameCamera(camera, group);
        scene.add(group);

        spin.remove();
        hero.appendChild(canvas);
        const hint = document.createElement('span');
        hint.className = 'sheet-hint';
        hint.textContent = 'drag to rotate · pinch to zoom';
        hero.appendChild(hint);

        Object.assign(live, { renderer, scene, camera, group, canvas, asset,
            raf: 0, yaw: 0, auto: 0, drag: null, zoom: 1 });
        canvas.addEventListener('pointerdown', onLiveDown);
        canvas.addEventListener('pointermove', onLiveMove);
        canvas.addEventListener('pointerup', onLiveUp);
        canvas.addEventListener('pointercancel', onLiveUp);
        // Phones rotate mid-inspect; re-fit the box and reframe each time.
        window.addEventListener('resize', onLiveResize);
        onLiveResize(); // in case the sheet was measured before its layout

        liveLast = 0;
        const reduced = window.matchMedia
            && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduced) liveDraw();
        else live.raf = requestAnimationFrame(liveTick);
    } catch (err) {
        console.warn('[models] live preview failed for', asset.id, err);
        if (renderer) {
            renderer.dispose();
            if (renderer.forceContextLoss) renderer.forceContextLoss();
        }
        if (group) disposeTree(group);
        spin.remove();
        staticPreview(hero, asset);
    }
}

function openSheet(asset) {
    liveStop();
    state.selected = asset;
    const sheet = $('#sheet');
    const scrim = $('#scrim');
    sheet.textContent = '';

    const in_ = document.createElement('div');
    in_.className = 'sheet-in';

    const hero = document.createElement('div');
    hero.className = 'sheet-hero';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'sheet-close';
    close.setAttribute('aria-label', 'Close');
    close.innerHTML = '<svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"></path></svg>';
    hero.appendChild(close);
    attachLive(hero, asset);

    const body = document.createElement('div');
    body.className = 'sheet-body';
    const h2 = document.createElement('h2');
    h2.id = 'sheet-name';
    h2.textContent = asset.name;
    const sub = document.createElement('div');
    sub.className = 'sheet-sub';
    const pills = [asset.assetType, asset.primaryCategory]
        .concat(asset.subcategory ? [asset.subcategory] : [])
        .concat(asset.uncertain ? ['needs review'] : []);
    for (const p of pills) {
        const el = document.createElement('span');
        el.className = 'pill' + (p === asset.assetType ? ' type' : '');
        el.textContent = p;
        sub.appendChild(el);
    }

    const dl = document.createElement('dl');
    dl.className = 'dl';
    row(dl, 'ID', asset.id);
    row(dl, 'Source', asset.source.path || asset.source.kind);
    if (asset.source.generator) row(dl, 'Generator', asset.source.generator);
    if (asset.params && asset.params.length) row(dl, 'Params', asset.params.join(', '));
    if (asset.dependencies && asset.dependencies.length) {
        const wrap = document.createElement('span');
        for (const d of asset.dependencies) {
            const el = document.createElement('span');
            el.className = 'mono';
            el.style.marginRight = '4px';
            el.textContent = d;
            wrap.appendChild(el);
        }
        row(dl, 'Contains', wrap);
    }
    const caps = [
        asset.capabilities.loadable ? 'loads' : 'does not load',
        asset.capabilities.placeable ? 'placeable' : 'not placed directly',
        asset.capabilities.configurable ? 'configurable' : 'fixed'
    ].join(' · ');
    row(dl, 'Capabilities', caps);
    if (asset.tags && asset.tags.length) row(dl, 'Tags', asset.tags.join(', '));

    const actions = document.createElement('div');
    actions.className = 'sheet-actions';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'btn btn-primary';
    copy.textContent = 'Copy ID';
    copy.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(asset.id);
            toast('Copied ' + asset.id);
        } catch (e) {
            toast('Could not copy');
        }
    });
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'btn';
    dismiss.textContent = 'Close';
    dismiss.addEventListener('click', closeSheet);
    actions.append(copy, dismiss);

    body.append(h2, sub, dl, actions);
    in_.append(hero, body);
    sheet.appendChild(in_);
    scrim.hidden = false;
    sheet.hidden = false;
    close.addEventListener('click', closeSheet);
    close.focus();
}

function closeSheet() {
    liveStop();
    $('#sheet').hidden = true;
    $('#scrim').hidden = true;
    state.selected = null;
}

$('#scrim').addEventListener('click', closeSheet);
document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && state.selected) closeSheet();
});

let toastTimer = 0;
function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 1800);
}

/* ------------------------------------------------------------------ boot */
// Reset every dimension of the filter at once - the one guaranteed way out
// of an empty grid, whether the emptiness came from a chip combo or a
// search term.
function clearFilters() {
    state.query = '';
    state.type = 'all';
    state.category = 'all';
    $('#search-input').value = '';
    renderChips();
    renderGrid();
}

async function boot() {
    $('#search-input').addEventListener('input', e => {
        state.query = e.target.value;
        renderChips();
        renderGrid();
    });
    $('#sort').addEventListener('change', e => {
        state.sort = e.target.value;
        renderGrid();
    });
    $('#type-chips').addEventListener('change', e => {
        state.type = e.target.value;
        renderChips();
        renderGrid();
    });
    $('#empty-clear').addEventListener('click', clearFilters);

    let sources;
    try {
        sources = await loadSources();
    } catch (err) {
        console.error('[models] catalog failed:', err);
        $('#counts').textContent = 'The asset catalog could not be loaded.';
        $('#empty').hidden = false;
        $('#empty-clear').hidden = true;
        $('#empty').querySelector('h2').textContent = 'Catalog unavailable';
        $('#empty').querySelector('p').textContent = String(err && err.message || err);
        return;
    }

    state.catalog = sources.catalog;
    previews.registry = sources.registry;
    initPreviews();

    const s = sources.catalog.stats;
    $('#counts').textContent = sources.manifestFailed
        ? `${s.assets} assets · ${s.categories} categories · manifest issue: ${sources.manifestFailed}`
        : `${s.assets} assets · ${s.categories} categories`;
    if (sources.catalog.problems.length) {
        console.warn('[models] catalog problems:', sources.catalog.problems);
    }

    renderChips();
    renderGrid();
}

boot();
