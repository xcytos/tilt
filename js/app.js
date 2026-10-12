import { Viewer } from './viewer.js';
import { createPanel } from './panel.js';
import { createEditor } from './editor.js';
import { Registry } from './registry.js';
import { SCENES, DEFAULT_SCENE, isScene } from './scenes.js';
import { LAYOUTS, LAYOUT_IDS, layoutById } from './layouts.js';
import { COLORWAYS, DEFAULT_COLORWAY, colorwayById } from './colorways.js';
import { RECIPES, recipeById, recipeFor } from './recipes.js';
import { createO2TiltModel, PARAMS } from './objects/o2tilt.js';
import { createPillarModel, PILLAR_PARAMS, PILLAR_ID, PILLAR_DEF } from './objects/pillar.js';
import {
    loadProject, saveProject, clearProject, applySaved, projectToJSON,
    projectId, loadNotice, flushProject, renameProject, createProject,
    duplicateProject
} from './project.js';

const container = document.getElementById('canvas-container');
const shelfBody = document.getElementById('shelf-body');
const overHttp = /^https?:$/.test(location.protocol);

// Where the module has got to, read by the self-check in the shell. A stall
// anywhere in the top-level awaits otherwise looks identical to "the buttons
// do nothing".
const stage = s => { window.__tiltStage = s; };
stage('app.js');

let viewer;
try {
    viewer = new Viewer(container);
} catch (err) {
    console.error(err);
    throw err;
}

const registry = new Registry('./models');
registry.register('o2tilt-frame', createO2TiltModel, PARAMS);
registry.register(PILLAR_ID, createPillarModel, PILLAR_PARAMS);

// Scene state. `mode` chooses between one preset on stage and several side by
// side; `mounted` holds exactly what is in the scene, keyed by preset id.
let mode = 'single';
let activeId = null;
let overlayIds = [];
let sceneId = DEFAULT_SCENE;
// The fabric palette every curtain on stage wears - one tap in the panel.
let colorwayId = DEFAULT_COLORWAY;
// A raw colour from the RGB dial overrides the palette until a palette chip
// is tapped again. null means "use the palette".
let fabricColor = null;

// Swatches you saved yourself with Add colour - appended after the boards,
// never replacing them.
let extraColors = [];

function allFabrics() {
    return COLORWAYS.concat(extraColors);
}

// What the stage is actually wearing.
function fabricHex() {
    if (Number.isFinite(fabricColor)) return fabricColor;
    const hit = colorwayById(colorwayId);
    return hit ? hit.fabric : null;
}
// A SET is only a starting point. After it has run, `savedPlaces` holds the
// coordinates that are yours - one entry per instance, per group - for the
// frames. Pillars have no coordinates of their own: `framePillars` holds
// each frame's own configuration - { count: 0-2, place } keyed by preset id
// - and the pillars always stand on that frame's anchors, travelling with
// it wherever it goes.
let layoutId = null;
const savedPlaces = new Map();
const framePillars = new Map();
const mounted = new Map();
let lastPrimary = null;
let panel = null;
let rebuildQueued = false;

// Control values, per preset, kept for every element that has ever been on
// stage - unmounting one does not throw its settings away. Written to the
// project file on a debounce so dragging a slider does not hammer the disk.
const savedPresets = {};
// Each SET remembers its own four shape sliders (Center Gap, Swing Pan,
// Pitch, Decline): switching a SET is a conversion, not a nudge.
const SET_SHAPE_KEYS = ['gap', 'pan', 'pitch', 'decline'];
let setPresets = Object.create(null);

function setPresetsPlain() {
    const out = {};
    for (const [id, v] of Object.entries(setPresets)) {
        if (!LAYOUT_IDS.includes(id) || !v) continue;
        const shape = {};
        for (const k of SET_SHAPE_KEYS) if (Number.isFinite(v[k])) shape[k] = v[k];
        if (Object.keys(shape).length) out[id] = shape;
    }
    return out;
}
let saveTimer = 0;
let projectName = '';
let dirty = false;
let thumbTimer = 0;
let editor = null;

// Everything the project file holds, read at save time so the camera is the
// one you are actually looking at.
function buildDoc() {
    const view = viewer.getCameraState();
    view.theme = viewer.isDark ? 'dark' : 'light';
    return {
        version: 2,
        name: projectName,
        mode,
        activeId,
        scene: sceneId,
        colorway: colorwayId,
        fabricColor: fabricColor,
        extraColors: extraColors.slice(),
        layout: layoutId,
        pillars: framePillarsPlain(),
        places: Object.fromEntries([...savedPlaces]
            .filter(([k]) => !k.startsWith(PILLAR_ID))
            .map(([k, v]) => [k, v.filter(Boolean)
                .map(p => ({ x: p.x, z: p.z, ry: p.ry }))])),
        view,
        mounted: orderIds(),
        overlayIds: overlayIds.slice(),
        presets: savedPresets,
        setPresets: setPresetsPlain()
    };
}

async function commit() {
    // Clear first, so an edit made while the request is in flight is not
    // mistaken for one that has already gone out - then put it back if the
    // write did not land, because the leaving flush is keyed off `dirty` and
    // would otherwise skip the only retry this project ever gets.
    dirty = false;
    const ok = await saveProject(buildDoc());
    if (!ok) dirty = true;
    if (editor) editor.setStatus(ok || !overHttp ? 'saved' : 'offline');
    scheduleThumb();
    return ok;
}

function saveNow() {
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = 0;
    }
    return commit();
}

// The list needs a picture, but a live re-render on every slider drag would
// be waste: upload once the user stops touching things.
function scheduleThumb() {
    if (!projectId() || !overHttp) return;
    if (thumbTimer) clearTimeout(thumbTimer);
    thumbTimer = setTimeout(() => {
        thumbTimer = 0;
        void uploadThumb();
    }, 5000);
}

async function uploadThumb() {
    try {
        const thumb = viewer.captureThumbnail();
        const res = await fetch(`./api/projects/${projectId()}/thumb`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ thumb })
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
    } catch (err) {
        console.warn('[thumb]', err);
    }
}

function scheduleSave() {
    dirty = true;
    if (editor) editor.setStatus('saving');
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
        saveTimer = 0;
        void commit();
    }, 500);
}

// On a phone the controls dock to the bottom, so the view gives up exactly
// Display order always follows the manifest, not the order ticks were clicked.
function orderIds() {
    if (mode === 'single') return activeId ? [activeId] : [];
    const rank = new Map(registry.list.map((e, i) => [e.id, i]));
    return overlayIds.slice()
        .sort((a, b) => (rank.has(a) ? rank.get(a) : 1e9) - (rank.has(b) ? rank.get(b) : 1e9));
}

function groups() {
    // Frames come in display order, a SET never hides any of them, and each
    // frame's own pillars follow it - one group apiece, so the panel gives
    // each its own section right after the frame it stands beside.
    const out = [];
    for (const id of orderIds()) {
        if (mounted.has(id)) out.push({ id, models: mounted.get(id) });
        const pillars = mounted.get(pillarKey(id)) || [];
        pillars.forEach((m, i) => {
            out.push({
                id: PILLAR_ID, models: [m], inst: i,
                total: pillars.length, owner: id
            });
        });
    }
    return out;
}

function primaryId() { return orderIds()[0] || null; }

function scheduleRebuild() {
    if (rebuildQueued) return;
    rebuildQueued = true;
    requestAnimationFrame(() => {
        rebuildQueued = false;
        for (const g of groups()) for (const m of g.models) if (m.dirty && m.build) m.build();
        // Re-place only. A pillar follows its frame's end through the
        // swing; the camera is left alone so dragging a slider never yanks
        // the view around.
        refreshPillarPlaces();
        applyPlaces();
    });
}

// Each preset may declare its own environment; the primary one wins. Applied
// only when the primary actually changes, so a manual dark-mode toggle is not
// overwritten the moment you move a slider.
async function applyPrimaryTheme() {
    const primary = primaryId();
    if (primary === lastPrimary) return;
    lastPrimary = primary;
    if (!primary) return;

    const def = await registry.load(primary);
    const theme = def.environment && def.environment.theme;
    if (!theme) return;
    const dark = theme === 'dark';
    viewer.setTheme(dark);
    if (panel) panel.setTheme(dark);
    if (editor) editor.setTheme(dark);
}

// Reconcile the stage with `orderIds()` - drop what no longer belongs, mount
// what is missing. Spacing never happens here: position is data, and
// defaultPlaces() decides it below.
async function syncPresets() {
    const want = orderIds();

    for (const [id, models] of [...mounted]) {
        // A pillar group stays while the frame that owns it stays.
        const owner = id.startsWith(PILLAR_ID + ':')
            ? id.slice(PILLAR_ID.length + 1) : id;
        if (want.includes(owner)) continue;
        for (const m of models) viewer.removeModel(m);
        mounted.delete(id);
        savedPlaces.delete(id);
    }

    const failures = [];
    for (const id of want) {
        if (mounted.has(id)) continue;
        try {
            const def = await registry.load(id);
            const { models } = await registry.instantiate(def);
            for (const m of models) {
                // Every element comes back with the settings it was left with.
                applySaved(m.state, m.params, savedPresets[id]);
                m.build();
                viewer.addModel(m);
            }
            mounted.set(id, models);
        } catch (err) {
            console.error('[registry]', err);
            failures.push({ id, message: (err && err.message) || String(err) });
        }
    }
    // Each frame brings its own pillars along.
    for (const id of want) {
        failures.push(...await syncPillarsFor(id));
    }
    return failures;
}

// One definition, repeated: a pillar pair (or any count you ask for) gets its
// own instance per slot, and the instances still share one set of controls.
function repeatDef(base, count) {
    if (count <= 1) return base;
    return Object.assign({}, base, {
        objects: Array.from({ length: count }, () => base.objects[0])
    });
}

async function instantiateKey(key, count) {
    const base = key === PILLAR_ID ? PILLAR_DEF : await registry.load(key);
    const { models } = await registry.instantiate(repeatDef(base, count));
    return models;
}

// Where `count` objects stand in `slots`. A half-filled set stays balanced
// instead of piling onto one side: a single object takes the average of every
// slot, several take evenly spread slots, and a full set uses them as drawn.
function slotPick(slots, count) {
    if (count >= slots.length) return slots.slice();
    if (count <= 0) return [];
    if (count === 1) {
        const n = slots.length;
        const mean = key => slots.reduce((sum, p) => sum + p[key], 0) / n;
        return [{ kind: 'frame', x: mean('x'), z: mean('z'), ry: mean('ry') }];
    }
    const out = [];
    for (let i = 0; i < count; i++) {
        out.push(slots[Math.round((i * (slots.length - 1)) / (count - 1))]);
    }
    return out;
}

// Pillars live under their frame's key: `count` per instance of that frame.
// Changing the count rebuilds the set; the look (saved preset values) rides
// along either way.
function pillarKey(frameId) {
    return PILLAR_ID + ':' + frameId;
}

function framePillarsFor(id) {
    const cfg = framePillars.get(id) || { count: 0, place: 'outer' };
    return Object.assign({}, cfg, {
        offset: cfg.offset || { x: 0, z: 0, ry: 0 }
    });
}

function framePillarsPlain() {
    return Object.fromEntries([...framePillars].map(([id, c]) => [id, {
        count: c.count,
        place: c.place,
        offset: Object.assign({ x: 0, z: 0, ry: 0 }, c.offset || {})
    }]));
}

async function syncPillarsFor(frameId) {
    const failures = [];
    const key = pillarKey(frameId);
    const frames = mounted.get(frameId) || [];
    const per = Math.max(0, Math.min(2, framePillarsFor(frameId).count));
    const want = frames.length * per;
    const have = mounted.get(key) || [];
    if (have.length === want) return failures;

    for (const m of have) viewer.removeModel(m);
    mounted.delete(key);
    savedPlaces.delete(key);
    if (want <= 0) return failures;

    try {
        const models = await instantiateKey(PILLAR_ID, want);
        for (const m of models) {
            applySaved(m.state, m.params, savedPresets[PILLAR_ID]);
            m.build();
            viewer.addModel(m);
        }
        mounted.set(key, models);
    } catch (err) {
        console.error('[pillars]', err);
        failures.push({ id: key, message: (err && err.message) || String(err) });
    }
    return failures;
}

function unmountAll() {
    for (const [id, models] of [...mounted]) {
        for (const m of models) viewer.removeModel(m);
        mounted.delete(id);
    }
    savedPlaces.clear();
}

// Both ends of both modules of ONE O2, measured from the model itself: the
// outer stand bases (far ends) and the inner ones beside the centre gap (the
// opposite ends), each carried around that frame's own turn. The stands sit
// on the rail, so these points include Centre Gap and Swing Pan - a pillar
// put here stands at the end of its module, in whatever swing the rail has.
function frameAnchorOf(m) {
    if (!m || !m.object3D) return null;
    let leftOut = null, leftIn = null, rightIn = null, rightOut = null;
    m.object3D.traverse(o => {
        if (o.name !== 'stand-base') return;
        const p = o.position;
        if (p.x < 0) {
            if (!leftOut || p.x < leftOut.x) leftOut = { x: p.x, z: p.z };
            if (!leftIn || p.x > leftIn.x) leftIn = { x: p.x, z: p.z };
        } else if (p.x > 0) {
            if (!rightIn || p.x < rightIn.x) rightIn = { x: p.x, z: p.z };
            if (!rightOut || p.x > rightOut.x) rightOut = { x: p.x, z: p.z };
        }
    });
    if (!leftOut || !rightOut || !leftIn || !rightIn) return null;
    const pos = m.object3D.position, turn = m.object3D.rotation.y;
    const c = Math.cos(turn), s = Math.sin(turn);
    const world = p => ({ x: pos.x + p.x * c + p.z * s, z: pos.z - p.x * s + p.z * c });
    return {
        centre: { x: pos.x, z: pos.z },
        left: world(leftOut),
        right: world(rightOut),
        innerLeft: world(leftIn),
        innerRight: world(rightIn)
    };
}

// Where pillar i of a frame's set stands, read from THAT frame. ONE pillar
// goes to the centre of its O2, where the modules meet. TWO go to the ends
// the place names: the outer ends, or the complete inner ends beside the
// centre gap - never somewhere between the poles.
function derivePillarPlace(frame, place, i, total) {
    const ends = frameAnchorOf(frame);
    if (!ends) {
        const p = frame && frame.object3D ? frame.object3D.position : null;
        return p ? { x: p.x, z: p.z } : { x: 0, z: 0 };
    }
    if (total <= 1 || place === 'centre') return ends.centre;
    if (place === 'inner') return i === 0 ? ends.innerLeft : ends.innerRight;
    const end = i === 0 ? ends.left : ends.right;
    // The outer end: just beyond the module's end base, not through it - the
    // base plate is 1.6 ft square, so stand clear of its diagonal by stepping
    // outward along the direction the module is pointing.
    const dx = end.x - ends.centre.x, dz = end.z - ends.centre.z;
    const len = Math.hypot(dx, dz) || 1;
    return { x: end.x + (dx / len) * 1.5, z: end.z + (dz / len) * 1.5 };
}

function readPlace(m) {
    const pos = m.object3D ? m.object3D.position : { x: 0, z: 0 };
    const ry = m.object3D ? m.object3D.rotation.y * 180 / Math.PI : 0;
    return { x: pos.x, z: pos.z, ry };
}

// Give every model its starting spot. A SET's slots and the viewer's own
// side-by-side spacing are both just defaults: anything you have already
// placed keeps its coordinates, and only newcomers are derived.
function defaultPlaces() {
    const presets = orderIds().filter(id => id !== PILLAR_ID && mounted.has(id));
    const missing = presets.filter(k => {
        const arr = savedPlaces.get(k);
        return !arr || arr.length !== (mounted.get(k) || []).length;
    });

    if (missing.length) {
        if (layoutId) {
            const lay = layoutById(layoutId);
            const frameSlots = lay ? lay.placements.filter(p => p.kind === 'frame') : [];
            const slots = slotPick(frameSlots, Math.min(presets.length, frameSlots.length));
            presets.forEach((k, i) => {
                if (!missing.includes(k)) return;
                const at = slots[i];
                savedPlaces.set(k, [{
                    x: at ? at.x : 0, z: at ? at.z : 0, ry: at ? at.ry || 0 : 0
                }]);
            });
        } else {
            // No set: the viewer's own side-by-side spacing is the default.
            // It re-spaces every frame, so every frame's numbers are
            // re-captured - not only the newcomers' - or the row and the
            // saved places would disagree and models would pile up.
            viewer.layoutGroups(presets.map(id => mounted.get(id)));
            for (const k of presets) {
                savedPlaces.set(k, (mounted.get(k) || []).map(readPlace));
            }
        }
    }
}

// Every pillar re-derives from the frame that owns it, AFTER that frame has
// been placed - so a pillar travels with its frame through the side-by-side
// row of All at once, through a set's slots, and through Centre Gap, Swing
// Pan and any turn of the frame.
function refreshPillarPlaces() {
    let changed = false;
    for (const [key, models] of mounted) {
        if (!key.startsWith(PILLAR_ID + ':') || !models.length) continue;
        const frameId = key.slice(PILLAR_ID.length + 1);
        const frames = mounted.get(frameId) || [];
        const cfg = framePillarsFor(frameId);
        const per = Math.max(0, Math.min(2, cfg.count)) || 1;
        const off = cfg.offset || { x: 0, z: 0, ry: 0 };
        const arr = models.map((m, i) => {
            const frame = frames[Math.floor(i / per)] || frames[0] || null;
            const spot = derivePillarPlace(frame, cfg.place, i % per, per);
            // The anchor first, then this frame's pillar offset - free
            // numbers on top of where the pair stands by default.
            return {
                x: spot.x + (off.x || 0),
                z: spot.z + (off.z || 0),
                ry: off.ry || 0
            };
        });
        const prev = savedPlaces.get(key);
        if (!prev || prev.length !== arr.length
            || arr.some((p, i) => !prev[i] || prev[i].x !== p.x || prev[i].z !== p.z)) {
            changed = true;
        }
        savedPlaces.set(key, arr);
    }
    return changed;
}

// The one writer: every model's transform comes from `savedPlaces`. Frames
// first, because a pillar takes its coordinates from the frame it stands
// beside. `layoutX` records the x written here so the viewer's own spacing
// can start from zero instead of from a leftover position.
function applyPlaces() {
    for (const [key, models] of mounted) {
        const arr = savedPlaces.get(key) || [];
        models.forEach((m, i) => {
            const p = arr[i];
            if (!m.object3D || !p) return;
            m.object3D.position.set(p.x, 0, p.z);
            m.object3D.rotation.y = (p.ry || 0) * Math.PI / 180;
            m.layoutX = p.x;
        });
    }
}

function num(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

function placesFor() {
    return Object.fromEntries([...savedPlaces].map(([k, v]) => [k, v]));
}

// One number at a time, for frames. Pillars are not edited here: they have
// no coordinates of their own - they follow the frame that owns them.
function setPlace(key, index, patch) {
    if (key.startsWith(PILLAR_ID)) return false;
    const arr = savedPlaces.get(key);
    if (!arr || !arr[index]) return false;
    const cur = arr[index];
    arr[index] = {
        x: num(patch.x, cur.x),
        z: num(patch.z, cur.z),
        ry: num(patch.ry, cur.ry)
    };
    applyPlaces();
    if (panel) panel.applyLive({ places: placesFor() });
    scheduleSave();
    return true;
}

// The chosen fabric palette, applied to every frame on stage. Models opt in
// with setColorway; the pillar's stone stays stone. The composition root
// calls this after the theme, because setTheme resets the fabric colour.
function applyColorway() {
    const hex = fabricHex();
    if (!Number.isFinite(hex)) return;
    for (const models of mounted.values()) {
        for (const m of models) if (m.setColorway) m.setColorway(hex);
    }
}

function setColorway(id) {
    // Board palettes clear the dial; your own swatches wear their colour.
    const extra = extraColors.find(c => c.id === id);
    const board = colorwayById(id);
    if (!board && !extra) return false;
    const nextFabric = extra ? extra.fabric : null;
    if (board && board.id === colorwayId && fabricColor === null) return false;
    if (extra && fabricColor === nextFabric) return false;
    if (board) colorwayId = board.id;
    fabricColor = nextFabric;
    applyColorway();
    if (panel) {
        panel.applyLive({
            colorway: colorwayId, fabricColor: fabricColor, recipe: recipeState()
        });
    }
    scheduleSave();
    return true;
}

// Add colour: keep the dialled colour as a new swatch. The five board
// palettes are never edited - the list only grows after them.
function addFabricColor() {
    const hex = fabricHex();
    if (!Number.isFinite(hex)) return false;
    const existing = allFabrics().find(c => c.fabric === hex);
    if (existing) {
        // Already on a chip - make sure it is the one being worn.
        if (fabricColor !== hex) {
            fabricColor = hex;
            applyColorway();
            scheduleSave();
        }
        return false;
    }
    const tag = hex.toString(16).padStart(6, '0');
    const id = 'custom-' + tag;
    if (extraColors.some(c => c.id === id)) return false;
    extraColors = extraColors.concat({ id, name: '#' + tag, fabric: hex });
    fabricColor = hex;
    applyColorway();
    if (panel) {
        panel.refresh({
            colorways: allFabrics(), colorway: colorwayId,
            fabricColor: fabricColor, recipe: recipeState()
        }, true);
    }
    scheduleSave();
    return true;
}

// The RGB dial: a raw curtain colour, clamped to the dial's own 0-255 x3.
// No panel repaint here - a re-render mid-drag would eat the slider.
function setFabricColor(hex) {
    const next = Math.max(0, Math.min(0xffffff, Math.round(Number(hex) || 0)));
    if (next === fabricColor) return false;
    fabricColor = next;
    applyColorway();
    scheduleSave();
    return true;
}

// A Look is remembered through the three fields it writes, never of its
// own, so the highlighted chip is whatever matches the current combination.
const recipeState = () => (recipeFor(sceneId, colorwayId, layoutId) || {}).id || '';

// A Look in one tap: scene + fabric palette + SET, applied in a single
// sync - the same work setScene/setLayout/setColorway do, without three
// rebuilds in a row.
function setRecipe(id) {
    const r = recipeById(id);
    if (!r) return false;
    if (r.scene === sceneId && r.colorway === colorwayId && r.set === layoutId) {
        return false;
    }
    sceneId = r.scene;
    viewer.setScene(sceneId);
    colorwayId = r.colorway;
    fabricColor = null;
    if (r.set !== layoutId) {
        // Switching a SET re-derives the frames' coordinates from the new
        // drawing - same rule as setLayout.
        layoutId = r.set;
        for (const key of [...savedPlaces.keys()]) {
            if (!key.startsWith(PILLAR_ID)) savedPlaces.delete(key);
        }
    }
    if (panel) {
        panel.applyLive({
            scene: sceneId, colorway: colorwayId, fabricColor: fabricColor,
            set: layoutId, recipe: recipeState(), places: placesFor()
        });
    }
    scheduleSave();
    return syncScene();
}

// The active SET's saved shape - or the drawing's own defaults when it has
// never been touched - lands on every frame. That is what makes switching
// a SET a real conversion of the object, not only a new row of coordinates.
function applySetParams(id) {
    const lay = id ? layoutById(id) : null;
    // Saved numbers sit ON TOP of the drawing's defaults: a SET that was
    // only partly tweaked still converts every slider, not just the ones
    // you happened to touch.
    const src = lay || (id && setPresets[id])
        ? Object.assign({}, (lay && lay.params) || {}, (id && setPresets[id]) || {})
        : null;
    if (!src) return false;
    const patch = {};
    for (const k of SET_SHAPE_KEYS) {
        const meta = PARAMS[k];
        const v = Number(src[k]);
        if (!meta || !Number.isFinite(v)) continue;
        patch[k] = Math.max(meta.min, Math.min(meta.max, v));
    }
    if (!Object.keys(patch).length) return null;
    for (const [key, models] of mounted) {
        if (key.startsWith(PILLAR_ID)) continue;
        for (const m of models) {
            if (!m.setParams) continue;
            m.setParams(patch);
            savedPresets[m.id] = Object.assign({}, savedPresets[m.id], patch);
        }
    }
    return patch;
}

// Reconcile the scene, re-space it, then refresh the panel. `forcePanel`
// repaints the controls even when nothing structural changed (used after a
// project reset).
async function syncScene(forcePanel = false) {
    if (panel) { panel.setBusy(true); panel.setError(''); }
    try {
        const failures = await syncPresets();

        // Forget presets that could not be built, so the next sync does not
        // retry them in a loop.
        if (failures.length) {
            const bad = new Set(failures.map(f => f.id));
            overlayIds = overlayIds.filter(id => !bad.has(id));
            if (mode === 'single' && activeId && bad.has(activeId)) {
                const fallback = registry.list.find(e => !bad.has(e.id));
                activeId = fallback ? fallback.id : null;
            }
        }

        // Convert first, space second: the new SET's sliders must already
        // be on the frames when the row is laid out. The panel moves the
        // numbers in place - a SET tap is a state change, not a reload.
        const shaped = applySetParams(layoutId);
        if (shaped) {
            console.info('[set]', layoutId, shaped);
            // The shape must land on the geometry NOW, not on the next
            // slider nudge: rebuild the dirty models in place. (Slider
            // drags still rebuild per frame through scheduleRebuild.)
            for (const g of groups()) {
                for (const m of g.models) if (m.dirty && m.build) m.build();
            }
        }

        defaultPlaces();
        // Frames first, then the pillars re-derive from where their frames
        // actually stand, then everything is written - so a pillar always
        // travels with its frame, including through the All-at-once row.
        applyPlaces();
        refreshPillarPlaces();
        applyPlaces();
        const gs = groups();
        viewer.frameScene();

        await applyPrimaryTheme();
        applyColorway();

        if (panel) {
            panel.refresh({
                mode,
                groups: gs,
                activeId,
                scene: sceneId,
                colorway: colorwayId,
                colorways: allFabrics(),
                fabricColor: fabricColor,
                recipe: recipeState(),
                set: layoutId,
                framePillars: framePillarsPlain(),
                places: placesFor(),
                model: gs[0] ? gs[0].models[0] : null
            }, forcePanel);
            if (shaped) {
                panel.applyLive({
                    set: layoutId, recipe: recipeState(),
                    shape: shaped, places: placesFor()
                });
            }
            panel.sync();
        }

        if (failures.length) throw new Error(failures.map(f => f.message).join('; '));
        return gs;
    } catch (err) {
        if (panel) panel.setError((err && err.message) || String(err));
        throw err;
    } finally {
        if (panel) panel.setBusy(false);
    }
}

async function activate(id) {
    mode = 'single';
    activeId = id;
    scheduleSave();
    return syncScene();
}

async function setMode(next) {
    if (next !== 'single' && next !== 'overlay' || next === mode) return;
    mode = next;

    if (mode === 'overlay' && !overlayIds.length) {
        overlayIds = activeId ? [activeId] : registry.list.slice(0, 1).map(e => e.id);
    }
    if (mode === 'single' && !overlayIds.includes(activeId) && overlayIds.length) {
        activeId = overlayIds[0];
    }
    scheduleSave();
    return syncScene();
}

async function toggleOverlay(id, on) {
    if (on) {
        if (!overlayIds.includes(id)) overlayIds.push(id);
    } else {
        overlayIds = overlayIds.filter(x => x !== id);
    }
    scheduleSave();
    return syncScene();
}

// The room the set stands in. The viewer sanitises on its own, so a scene id
// that has since been removed from the catalogue degrades to the studio
// instead of blanking the viewport.
function setScene(id) {
    if (!isScene(id) || id === sceneId) return false;
    sceneId = id;
    viewer.setScene(id);
    if (panel) panel.applyLive({ scene: sceneId, recipe: recipeState() });
    scheduleSave();
    return true;
}

// Switch SET. Everything mounted is dropped first: a SET rebuilds from its
// slots, so models must never arrive carrying the previous arrangement's
// placement.
function setLayout(id) {
    const next = id && layoutById(id) ? id : null;
    if (next === layoutId) return false;
    layoutId = next;
    stage('set:' + (next || 'free'));
    // Switching a SET re-derives the frames' coordinates from the new
    // drawing - that is what switching means. Pillars have no numbers of
    // their own; they follow each frame to its new anchor.
    for (const key of [...savedPlaces.keys()]) {
        if (!key.startsWith(PILLAR_ID)) savedPlaces.delete(key);
    }
    if (panel) {
        panel.applyLive({
            set: layoutId, recipe: recipeState(), places: placesFor()
        });
    }
    scheduleSave();
    return syncScene();
}

// A frame's own pillar options, set from that frame's own section: how many
// pillars stand beside it (0-2, per instance) and where the pair anchors -
// the centre of its O2, the outer ends of its modules, or the complete
// inner ends beside the gap. One pillar means centre; two never do.
function setFramePillars(id, patch) {
    if (!patch || typeof patch !== 'object') return false;
    if (!orderIds().includes(id) && !mounted.has(id)) return false;
    const cur = framePillarsFor(id);
    let count = cur.count, place = cur.place;
    const offset = Object.assign({ x: 0, z: 0, ry: 0 }, cur.offset || {});
    if (patch.count !== undefined) {
        count = Math.max(0, Math.min(2, Math.round(Number(patch.count) || 0)));
    }
    if (patch.place !== undefined && ['centre', 'inner', 'outer'].includes(patch.place)) {
        place = patch.place;
    }
    if (patch.offset && typeof patch.offset === 'object' && !Array.isArray(patch.offset)) {
        const numv = (v, lo, hi) => Number.isFinite(Number(v))
            ? Math.max(lo, Math.min(hi, Number(v))) : null;
        for (const [axis, range] of [['x', [-200, 200]], ['z', [-200, 200]],
            ['ry', [-360, 360]]]) {
            if (patch.offset[axis] === undefined) continue;
            const v = numv(patch.offset[axis], range[0], range[1]);
            if (v !== null) offset[axis] = v;
        }
    }
    if (count === 1) place = 'centre';
    if (count === 2 && place === 'centre') place = 'outer';
    if (count === cur.count && place === cur.place
        && offset.x === (cur.offset && cur.offset.x || 0)
        && offset.z === (cur.offset && cur.offset.z || 0)
        && offset.ry === (cur.offset && cur.offset.ry || 0)) return false;
    framePillars.set(id, { count, place, offset });
    // A new count gets a fresh set of anchors.
    if (count !== cur.count) savedPlaces.delete(pillarKey(id));
    if (panel) panel.refresh({ framePillars: framePillarsPlain() }, true);
    scheduleSave();
    return syncScene();
}

// Forget the project: reset the document to its defaults, drop every saved
// control value, and re-mount the default preset from its schema defaults.
// The name and the URL stay put - you are still in the same project.
async function resetProject() {
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = 0;
    }
    if (thumbTimer) {
        clearTimeout(thumbTimer);
        thumbTimer = 0;
    }
    dirty = false;
    for (const id of Object.keys(savedPresets)) delete savedPresets[id];
    setPresets = Object.create(null);

    mode = 'single';
    activeId = registry.list[0].id;
    overlayIds = [];
    sceneId = DEFAULT_SCENE;
    viewer.setScene(sceneId);
    colorwayId = DEFAULT_COLORWAY;
    fabricColor = null;
    extraColors = [];
    layoutId = null;
    framePillars.clear();

    // Unmount everything so syncScene rebuilds from defaults rather than
    // reusing models that still carry the old tweaks in their state.
    unmountAll();

    await clearProject();
    if (editor) editor.setStatus('saved');
    scheduleThumb();
    return syncScene(true);
}

// Panel callbacks fire unguarded promises; a rejected one must not reach
// window.onunhandledrejection, which the boot overlay treats as fatal.
const guard = fn => (...args) => {
    try {
        const out = fn(...args);
        if (out && typeof out.then === 'function') out.catch(() => {});
    } catch (err) {
        console.error('[panel]', err);
    }
};

const prefersDark = document.documentElement.classList.contains('dark');
viewer.setTheme(prefersDark);

// Without a server the manifest cannot be fetched; the registry then serves
// its built-in definition so the viewer still comes up.
let manifestError = '';
stage('manifest');
await registry.loadManifest().catch(err => {
    manifestError = err.message;
    console.warn('[registry] manifest not loaded, using the built-in model:', err);
});
stage('manifest done');

const firstEntry = registry.list[0];
let startupError = '';
mode = 'single';
activeId = firstEntry.id;

// Bring back last session: which presets were on stage, every control value
// they were left at, and where the camera was. Anything that is no longer in
// the catalogue is dropped.
const knownIds = new Set(registry.list.map(e => e.id));
// Documents from before the merge: Classic and Slope both became S Curve.
// The id stays `o2tilt` on disk; only the old names are remapped here.
const LEGACY_MODEL_IDS = {
    'o2tilt-classic': 'o2tilt', 'o2tilt-slope': 'o2tilt', 'o2tilt-arc': 'o2tilt'
};
const remapId = id => LEGACY_MODEL_IDS[id] || id;
let savedDoc = null;
try {
    savedDoc = await loadProject();
} catch (err) {
    console.warn('[project] could not restore the project:', err);
}
stage('project loaded');

let projectNotice = '';
const loadState = loadNotice();
if (loadState === 'missing') {
    projectNotice = 'That project is no longer in the list, so you are editing '
        + 'the local session instead. Use Save as project to keep it.';
} else if (loadState === 'offline') {
    projectNotice = 'That project could not be reached. Changes stay on this '
        + 'device until the server is back.';
}

if (savedDoc) {
    projectName = savedDoc.name || '';
    // Applied before syncScene so a preset's own environment.theme can still
    // override it, which is the rule the panel documents.
    if (savedDoc.view && savedDoc.view.theme) {
        viewer.setTheme(savedDoc.view.theme === 'dark');
    }
    if (savedDoc.scene && isScene(savedDoc.scene)) sceneId = savedDoc.scene;
    if (colorwayById(savedDoc.colorway)) colorwayId = savedDoc.colorway;
    if (Number.isFinite(savedDoc.fabricColor)) fabricColor = savedDoc.fabricColor;
    if (Array.isArray(savedDoc.extraColors)) extraColors = savedDoc.extraColors.slice();
    if (savedDoc.layout && layoutById(savedDoc.layout)) layoutId = savedDoc.layout;
    if (savedDoc.pillars && typeof savedDoc.pillars === 'object'
        && !Array.isArray(savedDoc.pillars)) {
        for (const [id, v] of Object.entries(savedDoc.pillars)) {
            const target = remapId(id);
            if (!knownIds.has(target) || !v || typeof v !== 'object') continue;
            // A merged pair of old presets keeps the choice that was active.
            if (framePillars.has(target) && id !== savedDoc.activeId) continue;
            const count = Math.max(0, Math.min(2, Math.round(Number(v.count) || 0)));
            const rawOff = v.offset && typeof v.offset === 'object'
                && !Array.isArray(v.offset) ? v.offset : {};
            framePillars.set(target, {
                count,
                place: count === 1 ? 'centre'
                    : (['centre', 'inner', 'outer'].includes(v.place) ? v.place : 'outer'),
                offset: {
                    x: Number.isFinite(Number(rawOff.x)) ? Number(rawOff.x) : 0,
                    z: Number.isFinite(Number(rawOff.z)) ? Number(rawOff.z) : 0,
                    ry: Number.isFinite(Number(rawOff.ry)) ? Number(rawOff.ry) : 0
                }
            });
        }
    } else if (Number.isFinite(savedDoc.pillars)) {
        // Documents from the global-pillar days: one pair beside the frame
        // that was active.
        const active = remapId(savedDoc.activeId);
        const target = active && knownIds.has(active)
            ? active
            : (registry.list[0] && registry.list[0].id);
        const count = Math.max(0, Math.min(2, Math.round(savedDoc.pillars)));
        if (target && count) {
            framePillars.set(target, {
                count, place: count === 1 ? 'centre' : 'outer',
                offset: { x: 0, z: 0, ry: 0 }
            });
        }
    }
    // The active frame's own numbers win when two old presets merge into one.
    const placeEntries = Object.entries(savedDoc.places || {})
        .sort((a, b) => (b[0] === savedDoc.activeId) - (a[0] === savedDoc.activeId));
    for (const [k, v] of placeEntries) {
        const key = remapId(k);
        if (k.startsWith(PILLAR_ID) || key.startsWith(PILLAR_ID)) continue;
        if (savedPlaces.has(key)) continue;
        if (Array.isArray(v)) savedPlaces.set(key, v.map(p => Object.assign({}, p)));
    }

    for (const [id, values] of Object.entries(savedDoc.presets)) {
        const target = remapId(id);
        if (!knownIds.has(target)) continue;
        if (!savedPresets[target] || id === savedDoc.activeId) {
            savedPresets[target] = values;
        }
    }
    // The parser already validated the shape; syncScene applies it to the
    // frames the moment the SET's row is built.
    if (savedDoc.setPresets && typeof savedDoc.setPresets === 'object') {
        setPresets = Object.assign(Object.create(null), savedDoc.setPresets);
    }

    const picked = [...new Set((savedDoc.overlayIds.length
        ? savedDoc.overlayIds : savedDoc.mounted)
        .map(remapId).filter(id => knownIds.has(id)))];
    if (savedDoc.mode === 'overlay' && picked.length) {
        mode = 'overlay';
        overlayIds = picked;
        const active = remapId(savedDoc.activeId);
        activeId = active && knownIds.has(active) ? active : picked[0];
    } else if (savedDoc.mounted.length || savedDoc.activeId) {
        const active = remapId(savedDoc.activeId);
        const wanted = active && knownIds.has(active)
            ? active
            : savedDoc.mounted.map(remapId).find(id => knownIds.has(id));
        if (wanted) {
            mode = 'single';
            activeId = wanted;
        }
    }
}

try {
    viewer.setScene(sceneId);
    await syncScene();
} catch (err) {
    startupError = (err && err.message) || String(err);
    console.error('[scene]', err);
}
stage('scene');

// syncScene framed the scene; only now may a saved camera win over the frame.
if (savedDoc && savedDoc.view) viewer.setCameraState(savedDoc.view);

const firstGroup = groups()[0];

panel = createPanel({
    body: shelfBody,
    model: firstGroup ? firstGroup.models[0] : null,
    groups: groups(),
    mode,
    catalog: registry.list,
    activeId,
    scenes: SCENES,
    scene: sceneId,
    colorways: allFabrics(),
    colorway: colorwayId,
    fabricColor: fabricColor,
    onAddColor: guard(() => addFabricColor()),
    recipes: RECIPES,
    recipe: recipeState(),
    sets: LAYOUTS,
    set: layoutId,
    framePillars: framePillarsPlain(),
    places: placesFor(),
    themeIsDark: viewer.isDark,
    onSelect: guard(id => activate(id)),
    onModeChange: guard(next => setMode(next)),
    onToggle: guard((id, on) => toggleOverlay(id, on)),
    onSceneChange: guard(id => setScene(id)),
    onColorwayChange: guard(id => setColorway(id)),
    onRgbChange: hex => setFabricColor(hex),
    onRecipeChange: guard(id => setRecipe(id)),
    onSetChange: guard(id => setLayout(id)),
    onFramePillarsChange: guard((id, patch) => setFramePillars(id, patch)),
    onPlaceChange: guard((key, index, patch) => setPlace(key, index, patch)),
    onParamsChange: (partial, targets) => {
        const fallback = panel ? panel.model : null;
        const picked = (targets && targets.length ? targets : fallback ? [fallback] : [])
            .filter(Boolean);
        // Instances of the same preset share one set of controls: two pillars
        // are one row of sliders, not two rows that drift apart.
        const ids = new Set(picked.map(m => m.id));
        const list = [...mounted.values()].flat().filter(m => ids.has(m.id));
        // While a SET is active its four shape sliders belong to that SET:
        // come back to it and the numbers are where you left them. Collected
        // across the instances - the per-model map dies with its own loop.
        const shaped = {};
        for (const m of list) {
            if (!m.setParams || !m.params) continue;
            const known = {};
            for (const [k, v] of Object.entries(partial)) {
                if (m.params[k]) known[k] = v;
            }
            if (!Object.keys(known).length) continue;
            m.setParams(known);
            savedPresets[m.id] = Object.assign({}, savedPresets[m.id], known);
            for (const k of SET_SHAPE_KEYS) {
                if (known[k] !== undefined) shaped[k] = known[k];
            }
        }
        if (layoutId && Object.keys(shaped).length) {
            setPresets[layoutId] = Object.assign({}, setPresets[layoutId], shaped);
        }
        scheduleSave();
        scheduleRebuild();
    },
    onThemeChange: isDark => {
        viewer.setTheme(isDark);
        if (panel) panel.setTheme(isDark);
        if (editor) editor.setTheme(isDark);
    },
    onShelfChange: () => syncDock()
});
stage('panel');

// The canvas lives above the dock, not under it: whenever the shelf opens,
// closes, or reflows, the container shrinks or grows by the dock's height
// and the viewer's own observer re-fits the drawing buffer.
function syncDock() {
    if (!container) return;
    const shelf = document.getElementById('shelf');
    const toolbar = document.getElementById('toolbar');
    let h = toolbar ? toolbar.offsetHeight : 0;
    if (shelf && !shelf.classList.contains('closed')) h += shelf.offsetHeight;
    container.style.height = h > 0
        ? `${Math.max(0, window.innerHeight - h)}px`
        : '';
}
if (typeof ResizeObserver === 'function') {
    const dockEl = document.getElementById('dock');
    if (dockEl) new ResizeObserver(() => syncDock()).observe(dockEl);
}
window.addEventListener('resize', syncDock);
syncDock();

if (startupError) {
    panel.setError(startupError);
} else if (projectNotice) {
    panel.setError(projectNotice);
} else if (manifestError) {
    const openedFromFile = !/^https?:$/.test(location.protocol);
    panel.setError(openedFromFile
        ? 'Opened straight from a file, so models/ could not be read. '
            + 'Showing the built-in model - serve this folder over HTTP to load presets.'
        : `models/manifest.json could not be loaded (${manifestError}). `
            + 'Serve this folder over HTTP to load model presets.');
}

// ------------------------------------------------------------- the project
function exportDoc() {
    const json = projectToJSON(buildDoc());
    const a = document.createElement('a');
    if (projectId() && overHttp) {
        a.href = `./api/projects/${projectId()}/export`;
    } else {
        const blob = new Blob([json], { type: 'application/json' });
        a.href = URL.createObjectURL(blob);
        a.download = `${(projectName || 'project').replace(/[^\w-]+/g, '-').toLowerCase()}.tilt.json`;
    }
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (a.download) setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// Turn the local session into a named project. The document rides along in
// the create call, and the URL follows so the next load finds it.
async function saveAsProject() {
    const created = await createProject(projectName || 'Untitled project', buildDoc());
    if (editor) editor.flash('Saved as "' + created.name + '"');
    location.replace(`./TILT.html?p=${encodeURIComponent(created.id)}`);
}

editor = createEditor({
    hasProject: !!projectId(),
    name: projectName || 'Untitled project',
    onHome: () => { location.href = './'; },
    onSave: () => { void saveNow(); },
    onRename: async next => {
        if (projectId()) {
            try {
                const payload = await renameProject(next);
                projectName = payload.name || next;
            } catch (err) {
                console.warn('[project] rename failed:', err);
                if (editor) editor.setStatus('offline');
                return false;
            }
        } else {
            projectName = next;
        }
        if (editor) editor.setName(projectName);
        scheduleSave();
        return true;
    },
    onDuplicate: () => duplicateProject(),
    // Save first: the API exports what the server holds, which would
    // otherwise be the state from before the last edit.
    onExport: async () => { await saveNow(); exportDoc(); },
    onSaveAs: () => saveAsProject(),
    onReset: () => resetProject(),
    isDark: viewer.isDark,
    onToggleTheme: isDarkNow => {
        viewer.setTheme(isDarkNow);
        if (panel) panel.setTheme(isDarkNow);
        if (editor) editor.setTheme(isDarkNow);
        scheduleSave();
    }
});
stage('editor');

// The last write before the tab goes away; nothing else will save after this.
window.addEventListener('pagehide', () => {
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = 0;
    }
    if (thumbTimer) {
        clearTimeout(thumbTimer);
        thumbTimer = 0;
    }
    if (dirty) flushProject(buildDoc());
});

viewer.start();
stage('started');

window.O2 = {
    viewer, panel, registry, editor, activate, setMode, toggleOverlay, syncScene,
    scheduleRebuild, resetProject, saveNow, buildDoc, setScene, setLayout, setColorway,
    setFabricColor, addFabricColor, setRecipe,
    setFramePillars, setPlace,
    get models() { return [...mounted.values()].flat(); },
    get mounted() { return [...mounted.keys()]; },
    get mode() { return mode; },
    get activeId() { return activeId; },
    get overlayIds() { return overlayIds.slice(); },
    get scene() { return sceneId; },
    get colorway() { return colorwayId; },
    get fabricColor() { return fabricColor; },
    get extraColors() { return extraColors.slice(); },
    get layout() { return layoutId; },
    get framePillars() { return framePillarsPlain(); },
    get places() { return placesFor(); },
    get savedPresets() { return savedPresets; },
    get projectId() { return projectId(); },
    get projectName() { return projectName; },
    get dirty() { return dirty; }
};
