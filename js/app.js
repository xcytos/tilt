import { Viewer } from './viewer.js';
import { createPanel } from './panel.js';
import { createEditor } from './editor.js';
import { Registry } from './registry.js';
import { SCENES, DEFAULT_SCENE, isScene } from './scenes.js';
import { LAYOUTS, layoutById } from './layouts.js';
import { createO2TiltModel, PARAMS } from './objects/o2tilt.js';
import { createPillarModel, PILLAR_PARAMS, PILLAR_ID, PILLAR_DEF } from './objects/pillar.js';
import {
    loadProject, saveProject, clearProject, applySaved, projectToJSON,
    projectId, loadNotice, flushProject, renameProject, createProject,
    duplicateProject
} from './project.js';

const container = document.getElementById('canvas-container');
const panelBody = document.getElementById('panel-body');
const panelEl = document.getElementById('ui-panel');
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
// A SET is only a starting point. After it has run, `savedPlaces` holds the
// coordinates that are yours - one entry per instance, per group - and
// `mirrored` lists the pairs kept symmetric across the stage centre
// (x becomes -x). `pillarCount` is how many O1 pillars stand on stage -
// one or two, a component you add, never a default of a set. `pillarLock`
// binds them to the frame; unlock it to place them yourself.
let layoutId = null;
const savedPlaces = new Map();
const mirrored = new Set();
let pillarCount = 0;
let pillarLock = true;
// Where the pair stands: 'outer' at each module's far end, 'inner' at the
// opposite ends beside the centre gap, 'centre' for a single pillar.
let pillarPlace = 'outer';
const mounted = new Map();
let lastPrimary = null;
let panel = null;
let rebuildQueued = false;

// Control values, per preset, kept for every element that has ever been on
// stage - unmounting one does not throw its settings away. Written to the
// project file on a debounce so dragging a slider does not hammer the disk.
const savedPresets = {};
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
        layout: layoutId,
        pillars: pillarCount,
        lock: pillarLock,
        place: pillarPlace,
        places: Object.fromEntries([...savedPlaces]
            .map(([k, v]) => [k, v.filter(Boolean)
                .map(p => ({ x: p.x, z: p.z, ry: p.ry }))])),
        mirror: Object.fromEntries([...mirrored].map(k => [k, true])),
        view,
        mounted: orderIds(),
        overlayIds: overlayIds.slice(),
        presets: savedPresets
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
// the space the sheet is using - open it and the canvas shrinks above it,
// collapse it and the canvas grows back. Measuring the sheet rather than
// guessing a vh keeps the two boxes flush while it animates, and on a
// desktop the panel simply overlays the scene as before.
function syncSheet() {
    if (!panelEl || !container) return;
    const phone = window.matchMedia('(max-width: 640px)').matches;
    const sheet = phone ? Math.round(panelEl.getBoundingClientRect().height) : 0;
    container.style.height = sheet > 0
        ? `${Math.max(0, window.innerHeight - sheet)}px`
        : '';
}

// Display order always follows the manifest, not the order ticks were clicked.
function orderIds() {
    if (mode === 'single') return activeId ? [activeId] : [];
    const rank = new Map(registry.list.map((e, i) => [e.id, i]));
    return overlayIds.slice()
        .sort((a, b) => (rank.has(a) ? rank.get(a) : 1e9) - (rank.has(b) ? rank.get(b) : 1e9));
}

function groups() {
    // Frames come in display order; a SET never hides any of them. Pillars
    // are placed one by one, so each is its own group - the panel gives it
    // its own section and its own position controls that way.
    const out = [];
    for (const id of orderIds()) {
        if (mounted.has(id)) out.push({ id, models: mounted.get(id) });
    }
    const pillars = mounted.get(PILLAR_ID) || [];
    pillars.forEach((m, i) => {
        out.push({ id: PILLAR_ID, models: [m], inst: i, total: pillars.length });
    });
    return out;
}

function primaryId() { return orderIds()[0] || null; }

function scheduleRebuild() {
    if (rebuildQueued) return;
    rebuildQueued = true;
    requestAnimationFrame(() => {
        rebuildQueued = false;
        for (const g of groups()) for (const m of g.models) if (m.dirty && m.build) m.build();
        // Re-place only. A locked pillar follows its module's end through
        // the swing; the camera is left alone so dragging a slider never
        // yanks the view around.
        refreshLockedPillars();
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
}

// Reconcile the stage with `orderIds()` - drop what no longer belongs, mount
// what is missing. Spacing never happens here: position is data, and
// defaultPlaces() decides it below.
async function syncPresets() {
    const want = orderIds();

    for (const [id, models] of [...mounted]) {
        if (want.includes(id)) continue;
        for (const m of models) viewer.removeModel(m);
        mounted.delete(id);
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

// Pillars are a component you add: exactly `pillarCount` instances under one
// key. Shrinking the count keeps the placements you have edited; growing it
// leaves holes for defaultPlaces() to derive.
async function syncPillars() {
    const failures = [];
    const have = mounted.get(PILLAR_ID) || [];
    if (have.length === pillarCount) return failures;

    const prev = savedPlaces.get(PILLAR_ID) || [];
    for (const m of have) viewer.removeModel(m);
    mounted.delete(PILLAR_ID);
    savedPlaces.set(PILLAR_ID,
        Array.from({ length: pillarCount }, (_, i) => prev[i] || null));
    if (pillarCount <= 0) {
        savedPlaces.delete(PILLAR_ID);
        return failures;
    }

    try {
        const models = await instantiateKey(PILLAR_ID, pillarCount);
        for (const m of models) {
            applySaved(m.state, m.params, savedPresets[PILLAR_ID]);
            m.build();
            viewer.addModel(m);
        }
        mounted.set(PILLAR_ID, models);
    } catch (err) {
        console.error('[pillars]', err);
        failures.push({ id: PILLAR_ID, message: (err && err.message) || String(err) });
    }
    return failures;
}

function unmountAll() {
    for (const [id, models] of [...mounted]) {
        for (const m of models) viewer.removeModel(m);
        mounted.delete(id);
    }
    savedPlaces.clear();
    mirrored.clear();
}

// Both ends of both modules of the O2, measured from the model itself: the
// outer stand bases (far ends) and the inner ones beside the centre gap (the
// opposite ends), each carried around the frame's own turn. The stands sit on
// the rail, so these points include Centre Gap and Swing Pan - a pillar put
// here stands at the end of its module, in whatever swing the rail has.
function frameAnchor() {
    for (const [key, models] of mounted) {
        if (key === PILLAR_ID) continue;
        const m = models && models[0];
        if (!m || !m.object3D) continue;
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
        if (!leftOut || !rightOut || !leftIn || !rightIn) continue;
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
    return null;
}

// Where a pillar of index i stands. ONE pillar goes to the centre of the O2,
// where the modules meet. TWO go to the ends you chose: the outer ends, or
// the opposite ends beside the centre gap. Without a frame on stage they fall
// back to the stage centre and a pair of outer spots, so a pillars-only
// preview still stands somewhere sensible.
function derivePillarPlace(i, total) {
    const ends = frameAnchor();
    if (total <= 1 || pillarPlace === 'centre') {
        return ends ? ends.centre : { x: 0, z: 0 };
    }
    if (!ends) return { x: i === 0 ? -15 : 15, z: 0 };
    if (pillarPlace === 'inner') {
        // The complete inner end: right at the module's gap-side stand, the
        // very start of the rail - not somewhere between the poles.
        return i === 0 ? ends.innerLeft : ends.innerRight;
    }
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
            // No set: the viewer's own spacing is the default, captured as
            // numbers the moment it has run.
            viewer.layoutGroups(presets.map(id => mounted.get(id)));
            for (const k of missing) {
                savedPlaces.set(k, (mounted.get(k) || []).map(readPlace));
            }
        }
    }

    fillPillarPlaces();
}

// Pillars with no coordinate yet (a fresh count, a fresh set) start on the
// same anchor the lock would give them.
function fillPillarPlaces() {
    const models = mounted.get(PILLAR_ID) || [];
    if (!models.length) return;
    const prev = savedPlaces.get(PILLAR_ID) || [];
    const arr = Array.from({ length: models.length }, (_, i) => prev[i] || null);
    arr.forEach((p, i) => {
        if (p) return;
        const spot = derivePillarPlace(i, arr.length);
        arr[i] = { x: spot.x, z: spot.z, ry: 0 };
    });
    savedPlaces.set(PILLAR_ID, arr);
    refreshLockedPillars();
}

// Put every pillar on its anchor (centre, outer ends or inner ends). Used
// directly when you pick a place - that is a snap, wherever you are - and
// through the lock on every rebuild.
function deriveAllPillarPlaces() {
    const models = mounted.get(PILLAR_ID) || [];
    const arr = savedPlaces.get(PILLAR_ID);
    if (!models.length || !arr || arr.length !== models.length) return false;
    let changed = false;
    arr.forEach((p, i) => {
        const spot = derivePillarPlace(i, arr.length);
        if (!p || p.x !== spot.x || p.z !== spot.z) changed = true;
        arr[i] = { x: spot.x, z: spot.z, ry: p ? p.ry : 0 };
    });
    return changed;
}

// The lock. On (the default) every pillar is bound to the frame: it stands
// on its anchor and follows the rail through Centre Gap, Swing Pan, Decline
// and any turn of the frame. Off, the coordinates are simply yours - the
// Position controls go live and nothing overwrites them again.
function refreshLockedPillars() {
    if (!pillarLock) return false;
    return deriveAllPillarPlaces();
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

function mirrorsFor() {
    return Object.fromEntries([...mirrored].map(k => [k, true]));
}

// One number at a time. Editing an instance of a mirrored pair also writes
// its twin as the reflection across the stage centre, so the pair stays a
// pair - that is the mirror check, and it applies to two pillars (or any
// group of two) exactly the same way.
function setPlace(key, index, patch) {
    const arr = savedPlaces.get(key);
    if (!arr || !arr[index]) return false;
    const cur = arr[index];
    const next = {
        x: num(patch.x, cur.x),
        z: num(patch.z, cur.z),
        ry: num(patch.ry, cur.ry)
    };
    arr[index] = next;
    if (mirrored.has(key) && arr.length === 2) {
        arr[index === 0 ? 1 : 0] = { x: -next.x, z: next.z, ry: -next.ry };
    }
    applyPlaces();
    if (panel) panel.refresh({ places: placesFor() }, true);
    scheduleSave();
    return true;
}

function setMirror(key, on) {
    on = !!on;
    if (on === mirrored.has(key)) return false;
    if (on) mirrored.add(key); else mirrored.delete(key);
    const arr = savedPlaces.get(key);
    if (on && arr && arr.length === 2) {
        arr[1] = { x: -arr[0].x, z: arr[0].z, ry: -arr[0].ry };
    }
    applyPlaces();
    if (panel) panel.refresh({ places: placesFor(), mirror: mirrorsFor() }, true);
    scheduleSave();
    return true;
}

// Reconcile the scene, re-space it, then refresh the panel. `forcePanel`
// repaints the controls even when nothing structural changed (used after a
// project reset).
async function syncScene(forcePanel = false) {
    if (panel) { panel.setBusy(true); panel.setError(''); }
    try {
        const failures = (await syncPresets()).concat(await syncPillars());

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

        defaultPlaces();
        applyPlaces();
        const gs = groups();
        viewer.frameScene();

        await applyPrimaryTheme();

        if (panel) {
            panel.refresh({
                mode,
                groups: gs,
                activeId,
                scene: sceneId,
                set: layoutId,
                pillars: pillarCount,
                lock: pillarLock,
                pillarPlace,
                places: placesFor(),
                mirror: mirrorsFor(),
                model: gs[0] ? gs[0].models[0] : null
            }, forcePanel);
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
    if (panel) panel.refresh({ scene: sceneId }, true);
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
    // Switching a SET re-derives the frames' coordinates from the new
    // drawing - that is what switching means. Unlocked pillars keep their
    // numbers; locked ones follow the frame to its new anchor.
    for (const key of [...savedPlaces.keys()]) {
        if (key !== PILLAR_ID) savedPlaces.delete(key);
    }
    if (panel) panel.refresh({ set: layoutId, places: placesFor() }, true);
    scheduleSave();
    return syncScene();
}

// Pillars are a component you add, never a default of a set: the stepper
// decides how many stand on stage, and each one gets its own section.
function setPillars(count) {
    const next = Math.max(0, Math.min(2, Math.round(Number(count) || 0)));
    if (next === pillarCount) return false;
    pillarCount = next;
    if (next < 2) mirrored.delete(PILLAR_ID);
    // A new count gets fresh anchors: one pillar means centre, two mean the
    // pair of ends the Place control names.
    pillarPlace = next === 1 ? 'centre' : (pillarPlace === 'centre' ? 'outer' : pillarPlace);
    savedPlaces.delete(PILLAR_ID);
    if (panel) {
        panel.refresh({ pillars: pillarCount, pillarPlace, places: placesFor() }, true);
    }
    scheduleSave();
    return syncScene();
}

// Centre, outer ends or the opposite ends beside the gap. Picking one snaps
// the pillars there straight away - with the lock on it is the anchor they
// keep following; with it off it is a one-shot re-place you can then edit.
function setPillarPlace(value) {
    const next = ['centre', 'inner', 'outer'].includes(value) ? value : 'outer';
    if (next === pillarPlace) return false;
    pillarPlace = next;
    deriveAllPillarPlaces();
    applyPlaces();
    if (panel) panel.refresh({ pillarPlace, places: placesFor() }, true);
    scheduleSave();
    return true;
}

// Locking pins every pillar to its anchor (centre for one, the end of each
// module for two) and re-derives them whenever the frame moves. Unlocking
// hands the coordinates over: nothing overwrites them again.
function setPillarLock(on) {
    on = !!on;
    if (on === pillarLock) return false;
    pillarLock = on;
    refreshLockedPillars();
    applyPlaces();
    if (panel) panel.refresh({ lock: pillarLock, places: placesFor() }, true);
    scheduleSave();
    return true;
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

    mode = 'single';
    activeId = registry.list[0].id;
    overlayIds = [];
    sceneId = DEFAULT_SCENE;
    viewer.setScene(sceneId);
    layoutId = null;
    pillarCount = 0;
    pillarLock = true;
    pillarPlace = 'outer';

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
    if (savedDoc.layout && layoutById(savedDoc.layout)) layoutId = savedDoc.layout;
    if (Number.isFinite(savedDoc.pillars)) {
        pillarCount = Math.max(0, Math.min(2, Math.round(savedDoc.pillars)));
    }
    if (savedDoc.lock === false) pillarLock = false;
    if (['centre', 'inner', 'outer'].includes(savedDoc.place)) {
        pillarPlace = savedDoc.place;
    }
    // Keep the choice honest for the count that is actually mounted.
    if (pillarCount === 1) pillarPlace = 'centre';
    if (pillarCount === 2 && pillarPlace === 'centre') pillarPlace = 'outer';
    for (const [k, v] of Object.entries(savedDoc.places || {})) {
        if (Array.isArray(v)) savedPlaces.set(k, v.map(p => Object.assign({}, p)));
    }
    for (const k of Object.keys(savedDoc.mirror || {})) mirrored.add(k);

    for (const [id, values] of Object.entries(savedDoc.presets)) {
        if (knownIds.has(id)) savedPresets[id] = values;
    }

    const picked = (savedDoc.overlayIds.length ? savedDoc.overlayIds : savedDoc.mounted)
        .filter(id => knownIds.has(id));
    if (savedDoc.mode === 'overlay' && picked.length) {
        mode = 'overlay';
        overlayIds = picked;
        activeId = savedDoc.activeId && knownIds.has(savedDoc.activeId)
            ? savedDoc.activeId
            : picked[0];
    } else if (savedDoc.mounted.length || savedDoc.activeId) {
        const wanted = savedDoc.activeId && knownIds.has(savedDoc.activeId)
            ? savedDoc.activeId
            : savedDoc.mounted.find(id => knownIds.has(id));
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
    body: panelBody,
    model: firstGroup ? firstGroup.models[0] : null,
    groups: groups(),
    mode,
    catalog: registry.list,
    activeId,
    scenes: SCENES,
    scene: sceneId,
    sets: LAYOUTS,
    set: layoutId,
    pillars: pillarCount,
    lock: pillarLock,
    pillarPlace,
    places: placesFor(),
    mirror: mirrorsFor(),
    themeIsDark: viewer.isDark,
    onSelect: guard(id => activate(id)),
    onModeChange: guard(next => setMode(next)),
    onToggle: guard((id, on) => toggleOverlay(id, on)),
    onSceneChange: guard(id => setScene(id)),
    onSetChange: guard(id => setLayout(id)),
    onPillarsChange: guard(n => setPillars(n)),
    onLockChange: guard(on => setPillarLock(on)),
    onPillarPlaceChange: guard(v => setPillarPlace(v)),
    onPlaceChange: guard((key, index, patch) => setPlace(key, index, patch)),
    onMirrorChange: guard((key, on) => setMirror(key, on)),
    onParamsChange: (partial, targets) => {
        const fallback = panel ? panel.model : null;
        const picked = (targets && targets.length ? targets : fallback ? [fallback] : [])
            .filter(Boolean);
        // Instances of the same preset share one set of controls: two pillars
        // are one row of sliders, not two rows that drift apart.
        const ids = new Set(picked.map(m => m.id));
        const list = [...mounted.values()].flat().filter(m => ids.has(m.id));
        for (const m of list) {
            if (!m.setParams || !m.params) continue;
            const known = {};
            for (const [k, v] of Object.entries(partial)) {
                if (m.params[k]) known[k] = v;
            }
            if (!Object.keys(known).length) continue;
            m.setParams(known);
            savedPresets[m.id] = Object.assign({}, savedPresets[m.id], known);
        }
        scheduleSave();
        scheduleRebuild();
    },
    onThemeChange: isDark => {
        viewer.setTheme(isDark);
        if (panel) panel.setTheme(isDark);
    },
    onReset: guard(() => resetProject())
});
stage('panel');

// The sheet changes height whenever the panel repaints or collapses: keep the
// canvas in step, and the viewer's own observer re-fits the drawing buffer.
if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => syncSheet()).observe(panelEl);
}
window.addEventListener('resize', syncSheet);
syncSheet();

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
    onReset: () => resetProject()
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

let minimized = false;
document.getElementById('btn-minimize').addEventListener('click', () => {
    minimized = !minimized;
    panelBody.classList.toggle('collapsed', minimized);
    document.getElementById('icon-collapse').style.display = minimized ? 'none' : 'block';
    document.getElementById('icon-expand').style.display = minimized ? 'block' : 'none';
});

viewer.start();
stage('started');

window.O2 = {
    viewer, panel, registry, editor, activate, setMode, toggleOverlay, syncScene,
    scheduleRebuild, resetProject, saveNow, buildDoc, setScene, setLayout,
    setPillars, setPillarLock, setPillarPlace, setPlace, setMirror,
    get models() { return [...mounted.values()].flat(); },
    get mounted() { return [...mounted.keys()]; },
    get mode() { return mode; },
    get activeId() { return activeId; },
    get overlayIds() { return overlayIds.slice(); },
    get scene() { return sceneId; },
    get layout() { return layoutId; },
    get pillarCount() { return pillarCount; },
    get lock() { return pillarLock; },
    get pillarPlace() { return pillarPlace; },
    get places() { return placesFor(); },
    get savedPresets() { return savedPresets; },
    get projectId() { return projectId(); },
    get projectName() { return projectName; },
    get dirty() { return dirty; }
};
