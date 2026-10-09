import * as THREE from 'three';
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
// A SET: null means free placement (one preset on stage, or several spread
// side by side); otherwise `layoutId` names the arrangement the frames and
// pillars are dropped into, and `setSlots` remembers which slot each mounted
// group was given so a rebuild can put it back in the same place.
let layoutId = null;
let setSlots = new Map();
// Pillars belong to a set's drawing, not to the selection: off unless the
// project asks for them.
let pillarsOn = false;
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
        pillars: pillarsOn,
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
    // A SET mounts groups the display order knows nothing about (the pillars),
    // so it shows what is on stage in the order it was built.
    if (layoutId) return [...mounted.entries()].map(([id, models]) => ({ id, models }));
    return orderIds()
        .filter(id => mounted.has(id))
        .map(id => ({ id, models: mounted.get(id) }));
}

function primaryId() { return orderIds()[0] || null; }

function scheduleRebuild() {
    if (rebuildQueued) return;
    rebuildQueued = true;
    requestAnimationFrame(() => {
        rebuildQueued = false;
        const gs = groups();
        for (const g of gs) for (const m of g.models) if (m.dirty && m.build) m.build();
        // Re-space only. The camera is left alone so dragging a slider never
        // yanks the view around.
        if (layoutId) placeSet();
        else viewer.layoutGroups(gs.map(g => g.models));
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

// Free placement: reconcile the stage with `orderIds()` - drop what no longer
// belongs, mount what is missing. SETs do this differently, see syncSet.
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

// One definition, repeated: a SET gives every slot of the same preset its own
// instance, and the instances still share one set of controls.
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

// A SET stages exactly what was chosen: each selected preset takes one frame
// slot - never more - and the pillars stand only when they were asked for.
// Slots the selection does not reach stay empty.
async function syncSet() {
    unmountAll();
    const failures = [];
    const lay = layoutById(layoutId);
    if (!lay) return failures;

    const presets = orderIds().filter(id => registry.list.some(e => e.id === id));
    const frameSlots = lay.placements.filter(p => p.kind === 'frame');
    const placed = slotPick(frameSlots, Math.min(presets.length, frameSlots.length));

    const plan = placed.map((at, i) => ({ key: presets[i], at }));
    if (pillarsOn) {
        for (const at of lay.placements) {
            if (at.kind === 'pillar') plan.push({ key: PILLAR_ID, at });
        }
    }

    const byKey = new Map();
    for (const item of plan) {
        if (!byKey.has(item.key)) byKey.set(item.key, []);
        byKey.get(item.key).push(item);
    }

    for (const [key, items] of byKey) {
        try {
            const models = await instantiateKey(key, items.length);
            for (const m of models) {
                applySaved(m.state, m.params, savedPresets[key]);
                m.build();
                viewer.addModel(m);
            }
            mounted.set(key, models);
            setSlots.set(key, items.map(i => i.at));
        } catch (err) {
            console.error('[set]', err);
            failures.push({ id: key, message: (err && err.message) || String(err) });
        }
    }
    return failures;
}

function unmountAll() {
    for (const [id, models] of [...mounted]) {
        for (const m of models) viewer.removeModel(m);
        mounted.delete(id);
    }
    setSlots = new Map();
}

// Where the mounted O2 stands, measured rather than assumed: its bounds move
// with the Centre Gap, Swing Pan and Decline controls, and a pillar must sit
// on the edge the frame actually has - not on a coordinate frozen at design
// time. Returns null when no frame is on stage.
function frameBounds() {
    const box = new THREE.Box3();
    let seen = false;
    for (const [key, models] of mounted) {
        if (key === PILLAR_ID) continue;
        for (const m of models) {
            if (!m.object3D) continue;
            box.expandByObject(m.object3D);
            seen = true;
        }
    }
    if (!seen || box.isEmpty()) return null;
    const centre = box.getCenter(new THREE.Vector3());
    return { minX: box.min.x, maxX: box.max.x, x: centre.x, z: centre.z };
}

// A pillar is always beside the O2: at the centre (where the two mirrored
// halves meet) or just outside an outer edge, offset in depth from the frame.
// With no frame mounted it falls back to the same place relative to the stage
// centre, so pillars-only previews still stand somewhere sensible.
function pillarSpot(bounds, at) {
    const clear = 1.0;
    if (!bounds) {
        const x = at.edge === 'outer-left' ? -15 : at.edge === 'outer-right' ? 15 : 0;
        return { x, z: at.z || 0 };
    }
    if (at.edge === 'center') return { x: bounds.x, z: bounds.z + (at.z || 0) };
    if (at.edge === 'outer-left') return { x: bounds.minX - clear, z: bounds.z + (at.z || 0) };
    return { x: bounds.maxX + clear, z: bounds.z + (at.z || 0) };
}

// Put every mounted model on the spot its slot gave it. Frames first: a
// pillar takes its coordinates from the frame it stands beside, so the O2
// has to be on its spot before they are. `layoutX` records the x written
// here, so if free placement ever re-spaces these models it starts from zero
// instead of from a leftover set position.
function placeSet() {
    for (const [key, models] of mounted) {
        if (key === PILLAR_ID) continue;
        const slots = setSlots.get(key) || [];
        models.forEach((m, i) => {
            const at = slots[i];
            if (!m.object3D) return;
            const x = at ? at.x : 0;
            m.object3D.position.set(x, 0, at ? at.z : 0);
            m.object3D.rotation.y = at ? (at.ry || 0) * Math.PI / 180 : 0;
            m.layoutX = x;
        });
    }

    const bounds = frameBounds();
    const pillarModels = mounted.get(PILLAR_ID) || [];
    const spots = setSlots.get(PILLAR_ID) || [];
    pillarModels.forEach((m, i) => {
        if (!m.object3D || !spots[i]) return;
        const spot = pillarSpot(bounds, spots[i]);
        m.object3D.position.set(spot.x, 0, spot.z);
        m.object3D.rotation.y = (spots[i].ry || 0) * Math.PI / 180;
        m.layoutX = spot.x;
    });
}

// Reconcile the scene, re-space it, then refresh the panel. `forcePanel`
// repaints the controls even when nothing structural changed (used after a
// project reset).
async function syncScene(forcePanel = false) {
    if (panel) { panel.setBusy(true); panel.setError(''); }
    try {
        const failures = layoutId ? await syncSet() : await syncPresets();

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

        const gs = groups();
        if (layoutId) placeSet();
        else viewer.layoutGroups(gs.map(g => g.models));
        viewer.frameScene();

        await applyPrimaryTheme();

        if (panel) {
            panel.refresh({
                mode,
                groups: gs,
                activeId,
                scene: sceneId,
                set: layoutId,
                pillars: pillarsOn,
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
    unmountAll();
    if (panel) panel.refresh({ set: layoutId }, true);
    scheduleSave();
    return syncScene();
}

// Pillars are a component of the set, not a default of it: toggling them
// rebuilds the stage from the same slots with or without them.
function setPillars(on) {
    on = !!on;
    if (on === pillarsOn) return false;
    pillarsOn = on;
    if (panel) panel.refresh({ pillars: pillarsOn }, true);
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

    mode = 'single';
    activeId = registry.list[0].id;
    overlayIds = [];
    sceneId = DEFAULT_SCENE;
    viewer.setScene(sceneId);
    layoutId = null;
    pillarsOn = false;

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
    if (savedDoc.pillars === true) pillarsOn = true;

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
    pillars: pillarsOn,
    themeIsDark: viewer.isDark,
    onSelect: guard(id => activate(id)),
    onModeChange: guard(next => setMode(next)),
    onToggle: guard((id, on) => toggleOverlay(id, on)),
    onSceneChange: guard(id => setScene(id)),
    onSetChange: guard(id => setLayout(id)),
    onPillarsChange: guard(on => setPillars(on)),
    onParamsChange: (partial, targets) => {
        const fallback = panel ? panel.model : null;
        const list = (targets && targets.length ? targets : fallback ? [fallback] : [])
            .filter(Boolean);
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
    scheduleRebuild, resetProject, saveNow, buildDoc, setScene, setLayout, setPillars,
    get models() { return [...mounted.values()].flat(); },
    get mounted() { return [...mounted.keys()]; },
    get mode() { return mode; },
    get activeId() { return activeId; },
    get overlayIds() { return overlayIds.slice(); },
    get scene() { return sceneId; },
    get layout() { return layoutId; },
    get pillars() { return pillarsOn; },
    get savedPresets() { return savedPresets; },
    get projectId() { return projectId(); },
    get projectName() { return projectName; },
    get dirty() { return dirty; }
};
