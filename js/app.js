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
import { createLightModel, LIGHT_TYPES, LIGHT_PARAMS, LIGHT_NAMES } from './elements/light.js';
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
// One lighting module, three registered type adaptors - each with its own
// params schema, so the panel renders PAR/LED/strip from the same code.
for (const t of LIGHT_TYPES) {
    const kind = t.slice(6);
    registry.register(t, p => createLightModel(t, p), LIGHT_PARAMS[kind]);
}

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
// Lighting elements belong to their frame: `frameElements` holds each
// frame's own list of fixtures - { type, anchor, params } keyed by preset id,
// like pillars are. The lights stand on the frame's own anchors, so they
// travel with it, and each keeps its own numbers.
const frameElements = new Map();
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
const SET_SHAPE_KEYS = ['gap', 'pan', 'pitch', 'decline', 'lobes'];
let setPresets = Object.create(null);

function setPresetsPlain() {
    const out = {};
    for (const [id, v] of Object.entries(setPresets)) {
        if (!LAYOUT_IDS.includes(id) || !v) continue;
        const shape = {};
        for (const k of SET_SHAPE_KEYS) if (Number.isFinite(v[k])) shape[k] = v[k];
        if (Array.isArray(v.lobeGaps)) shape.lobeGaps = v.lobeGaps.slice();
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
        elements: frameElementsPlain(),
        spacing: frameSpacingPlain(),
        places: Object.fromEntries([...savedPlaces]
            .filter(([k]) => !k.startsWith(PILLAR_ID) && !k.startsWith(ELEM_PREFIX))
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
    // each its own section right after the frame it stands beside. A frame's
    // lights follow the same rule: one group per fixture, owned by its frame.
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
        const lights = mounted.get(elementKey(id)) || [];
        lights.forEach((m, i) => {
            out.push({
                id: elementKey(id) + ':' + i, models: [m], inst: i,
                total: lights.length, owner: id
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
        // swing, and a light rides the same anchor it clamped to; the camera
        // is left alone so dragging a slider never yanks the view around.
        refreshPillarPlaces();
        refreshElementPlaces();
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
        // A pillar group stays while the frame that owns it stays; so does a
        // frame's light rig.
        const owner = id.startsWith(PILLAR_ID + ':')
            ? id.slice(PILLAR_ID.length + 1)
            : id.startsWith(ELEM_PREFIX)
                ? id.slice(ELEM_PREFIX.length) : id;
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
            // A def may bring fixtures of its own; the document's own list
            // wins whenever it has one for this frame.
            if (!frameElements.has(id)) {
                const seed = defElementsOf(def);
                if (seed.length) frameElements.set(id, seed);
            }
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
    // Each frame brings its own pillars along - and its own lights.
    for (const id of want) {
        failures.push(...await syncPillarsFor(id));
        failures.push(...await syncElementsFor(id));
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
        gap: Number.isFinite(cfg.gap) ? cfg.gap : 3,
        offset: cfg.offset || { x: 0, z: 0, ry: 0 }
    });
}

function framePillarsPlain() {
    return Object.fromEntries([...framePillars].map(([id, c]) => [id, {
        count: c.count,
        place: c.place,
        gap: Number.isFinite(c.gap) ? c.gap : 3,
        offset: Object.assign({ x: 0, z: 0, ry: 0 }, c.offset || {})
    }]));
}

// Elements live under their frame's key, one instance slot apiece.
const ELEM_PREFIX = 'light:';

function elementKey(frameId) {
    return ELEM_PREFIX + frameId;
}

function frameElementsFor(id) {
    return frameElements.get(id) || [];
}

// Plain document form: only frames that actually carry fixtures, values
// copied so a later edit cannot mutate the saved snapshot.
function frameElementsPlain() {
    return Object.fromEntries([...frameElements]
        .filter(([, list]) => list.length)
        .map(([id, list]) => [id, list.map(el => ({
            type: el.type,
            anchor: el.anchor,
            params: Object.assign({}, el.params)
        }))]));
}

// How far apart one frame's floor PARs stand, in feet. Absent means the
// wall's own even bays; a positive number is a centred line of lights the
// frame re-seats on its real hooks - session data, like pillars and lights.
const frameSpacing = new Map();

function frameSpacingPlain() {
    return Object.fromEntries([...frameSpacing].filter(([, v]) => v > 0));
}

// A fixture's numbers are the registered schema's business: anything the
// schema does not know, or clamps, is dropped here - both for documents and
// for a def's own elements. The registry validates again on the way in.
// A floor mount may only aim up: the lens sits ~0.4 ft above the ground,
// so any tilt above -30 drives the wide end of the cone (focus up to 60)
// into the floor. -30 keeps the lowest edge of a full-spread beam exactly
// horizontal - the ground can never be lit by accident. Pole and rail
// fixtures keep the full -90..90 range; they legitimately spot down.
const FLOOR_TILT_MAX = -30;

function clampElemParams(type, params, anchor) {
    const schema = LIGHT_PARAMS[type.slice(6)] || {};
    const out = {};
    if (!params || typeof params !== 'object' || Array.isArray(params)) return out;
    for (const [k, v] of Object.entries(params)) {
        const p = schema[k];
        if (!p || p.type !== 'range') continue;
        const n = Number(v);
        if (!Number.isFinite(n)) continue;
        out[k] = Math.max(p.min, Math.min(p.max, n));
    }
    if ('tilt' in out && /^(uplight|base)-/.test(anchor || '')) {
        out.tilt = Math.min(out.tilt, FLOOR_TILT_MAX);
    }
    return out;
}

function normaliseElementList(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const el of raw) {
        if (out.length >= 20) break;
        if (!el || typeof el !== 'object' || Array.isArray(el)) continue;
        if (!LIGHT_TYPES.includes(el.type)) continue;
        out.push({
            type: el.type,
            anchor: typeof el.anchor === 'string' ? el.anchor : '',
            params: clampElemParams(el.type, el.params, el.anchor)
        });
    }
    return out;
}

// A def may seed its frames with fixtures of its own (objects[].elements);
// only used for frames the document has never touched.
function defElementsOf(def) {
    const out = [];
    for (const o of ((def && def.objects) || [])) {
        if (!Array.isArray(o.elements)) continue;
        for (const el of normaliseElementList([].concat(o.elements))) out.push(el);
    }
    return out.slice(0, 20);
}

// Every mount point of one frame as plain data for the panel: id, kind and a
// label that reads like the drawing (Pole 3, Rail L 12, Base 1).
function anchorOptionsFor(frameId) {
    const owner = (mounted.get(frameId) || [])[0];
    if (!owner || typeof owner.getAnchors !== 'function') return [];
    let anchors = [];
    try { anchors = owner.getAnchors() || []; } catch { return []; }
    const counts = {};
    return anchors.map(a => {
        const key = a.kind === 'rail' ? `rail:${a.side || ''}` : a.kind;
        counts[key] = (counts[key] || 0) + 1;
        const n = counts[key];
        const label = a.kind === 'rail' ? `Rail ${a.side} ${n}`
            : a.kind === 'stripline'
                ? `Rail ${a.side || ''} ${a.mount === 'hem' ? 'hem' : 'top'}`
            : a.kind === 'pole' ? `Pole ${n}`
            : a.kind === 'uplight' ? `Floor ${n}`
            : `Base ${n}`;
        return { id: a.id, kind: a.kind, label };
    });
}

function frameAnchorsPlain() {
    return Object.fromEntries(orderIds()
        .filter(id => mounted.has(id))
        .map(id => [id, anchorOptionsFor(id)]));
}

// Where a newly added fixture clamps. PAR and LED fixtures start on the
// floor uplight hooks - the entrance-uplight case the design guide leads
// with - three per curtain wall, stood off from the fabric; strips clamp
// to the rail above. Pole and Rail stay one button away each.
function defaultAnchorFor(frameId, type) {
    const opts = anchorOptionsFor(frameId);
    // PAR and LED lead with the floor-uplight hooks; a frame without them
    // falls back to the base plates, then the poles. Strips clamp to the
    // curtain's own strip lines (top rail, then hem) when the frame has
    // them, else high on the rail.
    const kinds = type === 'light-strip'
        ? ['stripline', 'rail', 'pole'] : ['uplight', 'base', 'pole'];
    for (const kind of kinds) {
        const pool = opts.filter(o => o.kind === kind);
        if (pool.length) {
            const taken = new Set(frameElementsFor(frameId)
                .filter(e => e.anchor).map(e => e.anchor));
            if (kind === 'uplight') {
                // Seat a new uplight on the next equal-bay hook of the
                // emptier wall, so hand-added lights spread like the rig.
                for (const side of ['L', 'R']) {
                    const sidePool = pool.filter(o => o.id.startsWith(`uplight-${side}-`));
                    if (!sidePool.length) continue;
                    const usedSide = sidePool.filter(o => taken.has(o.id)).length;
                    for (const k of wallUplightSeats(usedSide + 1)) {
                        const cand = `uplight-${side}-${k}`;
                        if (!taken.has(cand) && sidePool.some(o => o.id === cand)) {
                            return cand;
                        }
                    }
                }
            }
            const used = [...taken].filter(a => a.startsWith(kind + '-')).length;
            return pool[used % pool.length].id;
        }
    }
    return opts.length ? opts[0].id : '';
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

// One def per frame carries that frame's fixtures as separate objects, so
// each light keeps its own type and numbers while sharing its frame's fate.
// The set of types is the signature: a count change, an add, a remove or a
// type swap all re-instantiate; anchor and param edits do not.
async function syncElementsFor(frameId) {
    const failures = [];
    const key = elementKey(frameId);
    if (frameElements.has(frameId)) {
        frameElements.set(frameId, normaliseElementList(frameElements.get(frameId)));
    }
    const list = frameElementsFor(frameId);
    const have = mounted.get(key) || [];
    const same = have.length === list.length
        && have.every((m, i) => m.lightType === list[i].type);
    if (same) return failures;

    for (const m of have) viewer.removeModel(m);
    mounted.delete(key);
    savedPlaces.delete(key);
    if (!list.length) return failures;

    try {
        const def = {
            id: key,
            name: 'Lights',
            objects: list.map(el => ({
                type: el.type,
                params: el.params || {},
                elements: []
            }))
        };
        const { models } = await registry.instantiate(def);
        models.forEach((m, i) => {
            m.lightType = list[i].type;
            m.elementOf = { frameId, index: i };
            m.name = LIGHT_NAMES[list[i].type];
            m.build();
            viewer.addModel(m);
        });
        mounted.set(key, models);
    } catch (err) {
        console.error('[lights]', err);
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
// opposite ends), each carried around that frame's own turn. The bases sit
// backstage of the rail line, so these points include Centre Gap and Swing
// Pan - a pillar put here stands at the end of its module, in whatever swing
// the rail has.
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
        const gap = Number.isFinite(cfg.gap) ? cfg.gap : 3;
        const arr = models.map((m, i) => {
            const frame = frames[Math.floor(i / per)] || frames[0] || null;
            const spot = derivePillarPlace(frame, cfg.place, i % per, per);
            // Centre Gap: symmetric spread along the frame's own axis.
            // Pillar 0 steps left, pillar 1 steps right.
            let sx = 0, sz = 0;
            if (per === 2 && gap) {
                const turn = frame && frame.object3D ? frame.object3D.rotation.y : 0;
                const dir = i % per === 0 ? -1 : 1;
                sx = dir * (gap / 2) * Math.cos(turn);
                sz = -dir * (gap / 2) * Math.sin(turn);
            }
            // The anchor first, then this frame's pillar offset - free
            // numbers on top of where the pair stands by default.
            return {
                x: spot.x + sx + (off.x || 0),
                z: spot.z + sz + (off.z || 0),
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

// Mount height above the anchor itself: base plates sit flat on the floor,
// pole and rail fixtures sit just proud of whatever they clamp to.
const MOUNT_Y = { base: 0, pole: 0.12, rail: 0.12, uplight: 0, stripline: 0 };

// Where one light stands: its anchor on the frame it belongs to, resolved
// after the frame has been placed, so it travels with the frame exactly as a
// pillar does - through swing, turn and the All-at-once row alike. World
// coordinates come from the frame's transform by plain trig, the way
// frameAnchorOf reads it: this file keeps no three import of its own.
function elementSpot(owner, anchors, anchorId) {
    if (!owner || !owner.object3D || !anchors.length) return { x: 0, y: 0, z: 0, ry: 0 };
    let a = anchors.find(x => x.id === anchorId);
    if (!a) {
        // A stale or missing anchor falls back to the nearest same-kind one -
        // a Pole 2 that no longer exists still lands on some pole.
        const want = (anchorId || '').split('-')[0];
        a = anchors.find(x => x.kind === want) || anchors[0];
    }
    const p = a.position;
    const pos = owner.object3D.position, turn = owner.object3D.rotation.y;
    const c = Math.cos(turn), s = Math.sin(turn);
    // A rail fixture aims along its rail; poles and bases follow the frame.
    // A floor uplight turns to face its own curtain: local -Z points at the
    // wall, so the -86 tilt leans the beam into the fabric, never over it.
    const ry = a.kind === 'rail' && a.tangent
        ? turn + Math.atan2(-a.tangent.z, a.tangent.x)
        : (a.kind === 'uplight' || a.kind === 'stripline') && a.normal
            ? turn + Math.atan2(a.normal.x, a.normal.z)
            : turn;
    return {
        x: pos.x + p.x * c + p.z * s,
        y: p.y + (MOUNT_Y[a.kind] || 0),
        z: pos.z - p.x * s + p.z * c,
        // Places are degrees end to end - the panel, the document, and
        // applyPlaces' own * PI / 180 - so this yaw (turn is radians on the
        // frame, atan2 is radians) converts once, here. Left in radians the
        // degree conversion divides every beam's swing by ~57: the curtain
        // swings away while the light keeps pointing at where it was.
        ry: ry * 180 / Math.PI
    };
}

// The curve a strip on a stripline anchor draws along, in the fixture's
// own local space: the wall's rail polyline - or that same footprint at
// the hem - read from the frame's own anchors, so the tube follows Swing
// Pan, Centre Gap and the wave exactly. Straight mounts (pole, rail
// clamp, base) return null: those strips keep their `length` box.
function stripPathFor(owner, anchors, entry) {
    const a = (anchors || []).find(x => x.id === (entry && entry.anchor));
    if (!a || a.kind !== 'stripline' || !a.normal) return null;
    const side = a.side || (/-L-/.test(a.id) ? 'L' : 'R');
    const hem = a.mount === 'hem' || /-B$/.test(a.id);
    const re = new RegExp('^rail-' + side + '-(\\d+)$');
    const rail = (anchors || []).filter(x => re.test(x.id))
        .map(x => ({ k: Number(re.exec(x.id)[1]), p: x.position }))
        .sort((m, n) => m.k - n.k)
        .map(x => x.p);
    if (rail.length < 2) return null;
    // The tube rides just IN FRONT of the curtain line, never on it: the
    // rail itself is a 0.12 ft tube, and a strip drawn on the centreline
    // would be swallowed whole - invisible at the top mount. The same
    // stand-off keeps the hem line clear of the fabric.
    const STRIP_OUT = 0.18;
    // The spot's yaw carries the mount facing; the path arrives in the
    // fixture's own space by undoing it - the frame's turn cancels out,
    // only the anchor's facing remains.
    const facing = Math.atan2(a.normal.x, a.normal.z);
    const c = Math.cos(facing), s = Math.sin(facing);
    const ap = a.position;
    return rail.map(p => {
        const q = {
            x: p.x + a.normal.x * STRIP_OUT - ap.x,
            y: (hem ? ap.y : p.y) - ap.y,
            z: p.z + a.normal.z * STRIP_OUT - ap.z
        };
        return { x: q.x * c - q.z * s, y: q.y, z: q.x * s + q.z * c };
    });
}

// The stage follows its contents: whenever elements re-place, ask the
// viewer to re-fit the room around the new footprint. Debounced so a
// slider sweep rebuilds the scene once at the end, not per input event,
// and cheap when the quantized size has not actually changed.
let stageFitTimer = 0;
function fitStageSoon() {
    clearTimeout(stageFitTimer);
    stageFitTimer = setTimeout(() => viewer.refreshStageSize(), 250);
}

function refreshElementPlaces() {
    let changed = false;
    for (const [key, models] of mounted) {
        if (!key.startsWith(ELEM_PREFIX) || !models.length) continue;
        const frameId = key.slice(ELEM_PREFIX.length);
        const owner = (mounted.get(frameId) || [])[0] || null;
        let anchors = [];
        if (owner && typeof owner.getAnchors === 'function') {
            try { anchors = owner.getAnchors() || []; } catch { anchors = []; }
        }
        const list = frameElementsFor(frameId);
        const arr = models.map((m, i) => elementSpot(
            owner, anchors, list[i] && list[i].anchor));
        // A strip on a stripline anchor redraws along its frame's own
        // curve every re-place - Swing Pan drags move the cloth and the
        // tube together, in the same frame.
        models.forEach((m, i) => {
            if (typeof m.setPath !== 'function') return;
            const entry = list[i];
            m.setPath(entry && entry.type === 'light-strip'
                ? stripPathFor(owner, anchors, entry) : null);
        });
        const prev = savedPlaces.get(key);
        if (!prev || prev.length !== arr.length
            || arr.some((p, i) => !prev[i] || prev[i].x !== p.x
                || prev[i].y !== p.y || prev[i].z !== p.z
                || prev[i].ry !== p.ry)) {
            changed = true;
        }
        savedPlaces.set(key, arr);
    }
    return changed;
}

// The one writer: every model's transform comes from `savedPlaces`. Frames
// first, because a pillar takes its coordinates from the frame it stands
// beside. `layoutX` records the x written here so the viewer's own spacing
// can start from zero instead of from a leftover position. Every path that
// moves anything funnels through here, so this is also where the stage
// re-fits itself to the new footprint.
function applyPlaces() {
    for (const [key, models] of mounted) {
        const arr = savedPlaces.get(key) || [];
        models.forEach((m, i) => {
            const p = arr[i];
            if (!m.object3D || !p) return;
            m.object3D.position.set(p.x, p.y || 0, p.z);
            m.object3D.rotation.y = (p.ry || 0) * Math.PI / 180;
            m.layoutX = p.x;
        });
    }
    fitStageSoon();
}

function num(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

function placesFor() {
    return Object.fromEntries([...savedPlaces].map(([k, v]) => [k, v]));
}

// One number at a time, for frames. Pillars are not edited here: they have
// no coordinates of their own - they follow the frame that owns them. Lights
// are not edited here either: they stand on their frame's anchors.
function setPlace(key, index, patch) {
    if (key.startsWith(PILLAR_ID) || key.startsWith(ELEM_PREFIX)) return false;
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
    // Lobe gaps always travel with the SET: a drawing or an old preset
    // without them restores the default 1 ft gap on every lobe.
    {
        const meta = PARAMS.lobeGaps;
        const count = meta.count || 11;
        const srcGaps = Array.isArray(src.lobeGaps) ? src.lobeGaps : [];
        patch.lobeGaps = Array.from({ length: count }, (_, i) => {
            const n = Number(srcGaps[i]);
            return Number.isFinite(n)
                ? Math.max(meta.min, Math.min(meta.max, n)) : meta.value;
        });
    }
    if (!Object.keys(patch).length) return null;
    for (const [key, models] of mounted) {
        if (key.startsWith(PILLAR_ID) || key.startsWith(ELEM_PREFIX)) continue;
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
        // be on the frames when the row is laid out, and each spaced wall
        // must stand on its hooks. The panel moves the numbers in place -
        // a SET tap is a state change, not a reload.
        const shaped = applySetParams(layoutId);
        reseatSpacedFrames();
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
        // actually stand, then the lights re-derive from their anchors, then
        // everything is written - so a pillar and a light always travel with
        // their frame, including through the All-at-once row.
        applyPlaces();
        refreshPillarPlaces();
        refreshElementPlaces();
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
                frameElements: frameElementsPlain(),
                frameAnchors: frameAnchorsPlain(),
                frameSpacing: frameSpacingPlain(),
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
    let count = cur.count, place = cur.place, gap = cur.gap;
    const offset = Object.assign({ x: 0, z: 0, ry: 0 }, cur.offset || {});
    if (patch.count !== undefined) {
        count = Math.max(0, Math.min(2, Math.round(Number(patch.count) || 0)));
    }
    if (patch.place !== undefined && ['centre', 'inner', 'outer'].includes(patch.place)) {
        place = patch.place;
    }
    if (patch.gap !== undefined) {
        const g = Number(patch.gap);
        if (Number.isFinite(g)) gap = Math.max(-5, Math.min(40, g));
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
    if (count === cur.count && place === cur.place && gap === cur.gap
        && offset.x === (cur.offset && cur.offset.x || 0)
        && offset.z === (cur.offset && cur.offset.z || 0)
        && offset.ry === (cur.offset && cur.offset.ry || 0)) return false;
    framePillars.set(id, { count, place, gap, offset });
    // A new count gets a fresh set of anchors.
    if (count !== cur.count) savedPlaces.delete(pillarKey(id));
    if (panel) {
        if (count === cur.count && place === cur.place) {
            // Value-level: update the sliders in place - a full rebuild
            // would destroy the input mid-drag.
            panel.applyLive({ framePillars: framePillarsPlain() });
        } else {
            panel.refresh({ framePillars: framePillarsPlain() }, true);
        }
    }
    scheduleSave();
    return syncScene();
}

// Lighting elements: add one, take one away, retarget one. The list is the
// state - a fixture's numbers live in its own entry - so every change goes
// back through the document, then re-instantiates only when the types changed.
function onElementAdd(id, type) {
    if (!orderIds().includes(id) && !mounted.has(id)) return false;
    if (!LIGHT_TYPES.includes(type)) return false;
    const list = frameElementsFor(id).slice();
    if (list.length >= 20) return false;
    const anchor = defaultAnchorFor(id, type);
    // The new fixture joins the rig already wearing its numbers: the most
    // recent light of its own kind on the same wall (so a mirrored pan
    // comes along), else any light of its kind, else the nearest light on
    // that wall, else the last one on the frame. Keys the new schema
    // lacks are dropped on the way in by the clamps.
    const sideOfAnchor = a => {
        const hit = /-(L|R)-/.exec(a || '');
        return hit ? hit[1] : null;
    };
    const side = sideOfAnchor(anchor);
    const pool = side ? list.filter(e => sideOfAnchor(e.anchor) === side) : list;
    const donor = pool.find(e => e.type === type)
        || list.find(e => e.type === type)
        || pool[pool.length - 1]
        || list[list.length - 1]
        || null;
    const params = donor ? Object.assign({}, donor.params) : {};
    // With nothing to copy, a floor mount starts aimed at the fabric
    // above, not across the floor into the guests' eyes. -86 leans the
    // beam ~4° into the curtain from its 1.2 ft standoff - it can never
    // cross the fabric plane. Pole and rail fixtures keep the schema's
    // own default.
    if (!('tilt' in params)
        && (anchor.split('-')[0] === 'base' || anchor.split('-')[0] === 'uplight')
        && LIGHT_PARAMS[type.slice(6)].tilt) {
        params.tilt = -86;
    }
    // A strip on a frame with curtain strip lines lands on BOTH walls at
    // once - one Add plants the pair, the top rails first and the hems
    // once the tops carry a strip. Two hand-adds never pile onto the
    // same hook.
    if (type === 'light-strip') {
        const lines = anchorOptionsFor(id).filter(o => o.kind === 'stripline');
        const seat = (s, mount) => lines.find(o => o.id === `stripline-${s}-${mount}`);
        const tops = ['L', 'R'].map(s => seat(s, 'T'));
        const hems = ['L', 'R'].map(s => seat(s, 'B'));
        if (tops[0] && tops[1]) {
            const taken = new Set(list.filter(e => e.anchor).map(e => e.anchor));
            const pair = tops.some(o => taken.has(o.id))
                ? (hems.some(o => taken.has(o.id)) ? tops : hems)
                : tops;
            if (list.length + pair.length <= 20) {
                for (const a of pair) {
                    list.push({ type, anchor: a.id, params: Object.assign({}, params) });
                }
                frameElements.set(id, list);
                scheduleSave();
                return syncScene();
            }
        }
    }
    list.push({ type, anchor, params });
    frameElements.set(id, list);
    scheduleSave();
    return syncScene();
}

function onElementRemove(id, index) {
    const list = frameElementsFor(id).slice();
    if (!list[index]) return false;
    list.splice(index, 1);
    frameElements.set(id, list);
    scheduleSave();
    return syncScene();
}

function onElementPatch(id, index, patch) {
    const list = frameElementsFor(id).slice();
    const entry = list[index];
    if (!entry || !patch || typeof patch !== 'object') return false;
    let structural = false;
    if (typeof patch.anchor === 'string' && patch.anchor && patch.anchor !== entry.anchor) {
        entry.anchor = patch.anchor;
    }
    if (typeof patch.type === 'string' && LIGHT_TYPES.includes(patch.type)
        && patch.type !== entry.type) {
        // A different fixture on the same hook: fresh numbers, and possibly
        // a different hook (strips clamp to the rail, par and led to the
        // floor uplights by default). A floor mount re-seeds the uplight aim.
        entry.type = patch.type;
        entry.params = {};
        entry.anchor = defaultAnchorFor(id, patch.type);
        if ((entry.anchor.split('-')[0] === 'base' || entry.anchor.split('-')[0] === 'uplight')
            && LIGHT_PARAMS[patch.type.slice(6)].tilt) {
            entry.params.tilt = -86;
        }
        structural = true;
    }
    // The new hook may be a floor mount, which may only aim up.
    entry.params = clampElemParams(entry.type, entry.params, entry.anchor);
    list[index] = { type: entry.type, anchor: entry.anchor, params: entry.params };
    frameElements.set(id, list);
    scheduleSave();
    if (structural) return syncScene();
    // Anchor retarget only: same models, re-place on the next frame - and
    // let the panel repaint, because the hook is part of its signature.
    refreshElementPlaces();
    applyPlaces();
    if (panel) {
        panel.refresh({
            frameElements: frameElementsPlain(),
            frameAnchors: frameAnchorsPlain()
        });
    }
    return true;
}

// Of a wall's 10 uplight hooks, the n that divide it into n equal bays -
// the midpoint hook of each bay. n=10 is every hook; n=1 is the middle.
function wallUplightSeats(n) {
    const count = Math.max(1, Math.min(10, Math.round(Number(n) || 0)));
    const seats = [];
    for (let j = 0; j < count; j++) {
        seats.push(Math.min(9, Math.max(0,
            Math.round((j + 0.5) * 10 / count - 0.5))));
    }
    return seats;
}

// One wall's floor-uplight hooks as { k, x } in frame-local x, in hook
// order. The seat maths below works on the frame's real geometry, so a
// spacing the slider asks for lands on hooks the frame actually offers -
// and both walls run the same maths on their mirrored hooks.
function uplightHooks(frameId, side) {
    const owner = (mounted.get(frameId) || [])[0] || null;
    if (!owner || typeof owner.getAnchors !== 'function') return [];
    let anchors = [];
    try { anchors = owner.getAnchors() || []; } catch { return []; }
    const re = new RegExp('^uplight-' + side + '-(\\d+)$');
    return anchors.filter(a => re.test(a.id))
        .map(a => ({ k: Number(re.exec(a.id)[1]), x: a.position.x }))
        .sort((a, b) => a.k - b.k);
}

// Which n hooks a wall's floor PARs stand on. No spacing asked for: the
// bays of the whole wall, exactly as the count slider always has. A
// spacing in feet: uniform steps of the nearest whole hook gap (the
// hooks are evenly spaced in x), centred on the wall and shifted inside
// the hook line so all n keep a hook of their own.
function wallSeatKs(hooks, n, spacingFt) {
    const count = Math.max(0, Math.round(n));
    if (!hooks.length || count <= 0) return [];
    if (!Number.isFinite(spacingFt) || spacingFt <= 0) {
        const have = new Set(hooks.map(h => h.k));
        const nearest = k => hooks.reduce((best, h) =>
            Math.abs(h.k - k) < Math.abs(best.k - k) ? h : best, hooks[0]);
        return wallUplightSeats(count)
            .map(k => have.has(k) ? k : nearest(k).k);
    }
    const H = hooks.length;
    if (count === 1 || H === 1) {
        return [hooks[Math.min(H - 1, Math.max(0, Math.round((H - 1) / 2)))].k];
    }
    const gap = Math.abs(hooks[H - 1].x - hooks[0].x) / (H - 1) || 1;
    let step = Math.max(1, Math.round(spacingFt / gap));
    step = Math.min(step, Math.max(1, Math.floor((H - 1) / (count - 1))));
    const want = Math.round((H - 1) / 2 - ((count - 1) * step) / 2);
    const lo = Math.max(0, Math.min(H - 1 - (count - 1) * step, want));
    return Array.from({ length: count }, (_, i) => hooks[lo + i * step].k);
}

// How many floor uplights stand on EACH curtain wall: the rig sizing knob,
// a 1-10 slider in the panel. Every change re-seats the wall on the hooks
// that divide it into n equal bays - the lights spread across the whole
// wall, never bunched at the entrance gap. Survivors keep their tuned
// params, extras go, missing seats plant already wearing the wall's own
// numbers - a count bump never leaves the fresh lights a different colour
// from the rig they join. Other fixtures the user placed by hand are never
// touched.
function onElementCount(id, n) {
    if (!orderIds().includes(id) && !mounted.has(id)) return false;
    const want = Math.max(1, Math.min(10, Math.round(Number(n) || 0)));
    const list = frameElementsFor(id).slice();
    let changed = false;
    for (const side of ['L', 'R']) {
        const seats = wallUplightSeats(want).map(k => `uplight-${side}-${k}`);
        const mine = [];
        for (let i = list.length - 1; i >= 0; i--) {
            const e = list[i];
            if (e && e.anchor && e.anchor.startsWith(`uplight-${side}-`)) {
                mine.unshift(e);
                list.splice(i, 1);
            }
        }
        const kept = mine.slice(0, want);
        if (mine.length > want) changed = true;
        for (let i = 0; i < kept.length; i++) {
            const e = kept[i];
            const anchor = seats[i];
            const moved = e.anchor !== anchor;
            list.push(moved ? { type: e.type, anchor, params: { ...e.params } } : e);
            if (moved) changed = true;
        }
        for (let i = kept.length; i < want && list.length < 20; i++) {
            // A new seat joins the wall already wearing its numbers: the
            // survivor's own params - same wall, so a mirrored pan comes
            // along - never the entrance defaults. With no survivor to
            // copy (a wall grown from zero) the entrance rig numbers stand.
            const donor = kept[0] || null;
            list.push({
                type: donor ? donor.type : 'light-par',
                anchor: seats[i],
                params: donor
                    ? Object.assign({}, donor.params)
                    : { power: 60, tilt: -86, focus: 36, hue: 40, sat: 40 }
            });
            changed = true;
        }
    }
    if (!changed) return false;
    frameElements.set(id, normaliseElementList(list));
    scheduleSave();
    return syncScene();
}

// Re-stand every spaced frame's floor PARs on the hooks its spacing asks
// for. Runs on every scene sync - cheap and idempotent: the count decides
// HOW MANY, the spacing decides HOW FAR APART, the hooks decide exactly
// where. Pole, rail and base fixtures are never touched.
function reseatSpacedFrames() {
    let changed = false;
    for (const [frameId, ft] of [...frameSpacing]) {
        if (!(ft > 0)) continue;
        const list = frameElementsFor(frameId).slice();
        let touched = false;
        for (const side of ['L', 'R']) {
            const at = [];
            for (let i = list.length - 1; i >= 0; i--) {
                const e = list[i];
                if (e && e.anchor && e.anchor.startsWith(`uplight-${side}-`)) {
                    at.unshift(i);
                }
            }
            if (!at.length) continue;
            const ks = wallSeatKs(uplightHooks(frameId, side), at.length, ft);
            at.forEach((li, j) => {
                const k = ks[j];
                if (k === undefined) return;
                const want = `uplight-${side}-${k}`;
                if (list[li].anchor === want) return;
                list[li] = {
                    type: list[li].type,
                    anchor: want,
                    params: Object.assign({}, list[li].params)
                };
                touched = true;
            });
        }
        if (touched) {
            frameElements.set(frameId, normaliseElementList(list));
            changed = true;
        }
    }
    if (changed) scheduleSave();
    return changed;
}

// The spacing slider's commit: 0 slides back to the wall's even bays.
function setFrameSpacing(id, ft) {
    if (!orderIds().includes(id) && !mounted.has(id)) return false;
    const n = Number(ft);
    const val = Number.isFinite(n) && n > 0
        ? Math.max(1, Math.min(12, Math.round(n * 10) / 10)) : 0;
    if (val === (frameSpacing.get(id) || 0)) return false;
    if (val > 0) frameSpacing.set(id, val);
    else frameSpacing.delete(id);
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
    frameElements.clear();
    frameSpacing.clear();

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
                gap: typeof v.gap === 'number' && Number.isFinite(v.gap)
                    ? Math.max(-5, Math.min(40, v.gap)) : 3,
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
    // The fixtures ride along with the pillars - same rule: the document's
    // own list, only for frames this project actually knows.
    if (savedDoc.elements && typeof savedDoc.elements === 'object'
        && !Array.isArray(savedDoc.elements)) {
        for (const [id, v] of Object.entries(savedDoc.elements)) {
            const target = remapId(id);
            if (!knownIds.has(target)) continue;
            const list = normaliseElementList(v);
            if (list.length) frameElements.set(target, list);
        }
    }
    // Floor-PAR spacing travels the same way: frames this project knows.
    if (savedDoc.spacing && typeof savedDoc.spacing === 'object'
        && !Array.isArray(savedDoc.spacing)) {
        for (const [id, v] of Object.entries(savedDoc.spacing)) {
            const target = remapId(id);
            if (!knownIds.has(target)) continue;
            const n = Number(v);
            if (Number.isFinite(n) && n > 0) {
                frameSpacing.set(target, Math.max(1, Math.min(12, n)));
            }
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
        // The pillar is a registered type, not a catalogue entry, so it is
        // absent from knownIds - its look preset still has to come back.
        if (!knownIds.has(target) && target !== PILLAR_ID) continue;
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
    frameElements: frameElementsPlain(),
    frameAnchors: frameAnchorsPlain(),
    frameSpacing: frameSpacingPlain(),
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
    onElementAdd: guard((id, type) => onElementAdd(id, type)),
    onElementRemove: guard((id, index) => onElementRemove(id, index)),
    onElementPatch: guard((id, index, patch) => onElementPatch(id, index, patch)),
    onElementCount: guard((id, n) => onElementCount(id, n)),
    onFrameSpacing: guard((id, ft) => setFrameSpacing(id, ft)),
    onPlaceChange: guard((key, index, patch) => setPlace(key, index, patch)),
    onParamsChange: (partial, targets) => {
        const fallback = panel ? panel.model : null;
        const picked = (targets && targets.length ? targets : fallback ? [fallback] : [])
            .filter(Boolean);
        // A light keeps its own numbers: focus belongs to THAT fixture, it
        // lands in ITS OWN frame fixture entry (a Left/All mode edit writes
        // every fixture in the group), and it never travels into
        // savedPresets under the rig's key - so no shared-id fan-out below.
        const first = picked[0];
        if (first && first.elementOf) {
            const known = {};
            for (const m of picked) {
                if (!m.setParams || !m.params || !m.elementOf) continue;
                const mine = {};
                for (const [k, v] of Object.entries(partial)) {
                    if (m.params[k]) mine[k] = v;
                }
                if (!Object.keys(mine).length) continue;
                m.setParams(mine);
                const mineList = frameElements.get(m.elementOf.frameId);
                if (mineList && mineList[m.elementOf.index]) {
                    Object.assign(mineList[m.elementOf.index].params, mine);
                }
                Object.assign(known, mine);
            }
            if (Object.keys(known).length) {
                scheduleSave();
                scheduleRebuild();
            }
            return;
        }
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
            if (Array.isArray(known.lobeGaps)) {
                shaped.lobeGaps = known.lobeGaps.slice();
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
