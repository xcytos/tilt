// The project file is the panel's memory: which display mode was on, which
// presets were on stage, every control value for every preset that has been
// added, plus which project it belongs to and where the camera was left.
// Served builds keep a copy on disk as project.json and mirror it in
// localStorage; named projects themselves live in the SQLite database behind
// tools/store.mjs, which sanitises documents through these same helpers.

// Layout data only: no three.js, so this import still resolves in the plain
// Node the tests run the parser under.
import { LAYOUT_IDS } from './layouts.js';
import { COLORWAY_IDS, DEFAULT_COLORWAY } from './colorways.js';
// Pure (no three.js): the flower arrangement's authority for turning whatever a
// document carries into a full, clamped settings object.
import { FlowerModel } from './flowermodel.js';
// Pure catalog: which asset ids the free-placed decor inventory accepts.
import { DECOR_BY_ID } from './decorlib.js';

const PROJECT_FILE = 'project.json';
const STORAGE_KEY = 'o2tilt-project.v1';
const API = './api/projects';

// A project opened from the homepage carries ?p=<id>. That id decides where
// every save goes; without it the editor keeps working on the shared
// project.json session, which is what a direct file:// open uses.
function readTarget() {
    try {
        const id = new URLSearchParams(location.search).get('p');
        return id && /^[\w-]{1,64}$/.test(id) ? id : null;
    } catch {
        return null;
    }
}

let target = readTarget();
let notice = '';

export function projectId() { return target; }

// 'missing' - the URL points at a project that has since been deleted, so the
// editor detached and is editing the local session instead.
// 'offline' - the project could not be reached; saves will keep failing.
export function loadNotice() { return notice; }

function served() {
    return typeof location !== 'undefined' && /^https?:$/.test(location.protocol);
}


function hasLocal() {
    return typeof localStorage !== 'undefined';
}

function cleanName(name, fallback = '') {
    if (typeof name !== 'string') return fallback;
    const clean = name.replace(/\s+/g, ' ').trim().slice(0, 80);
    return clean || fallback;
}

// A camera position/target is only kept when it is three finite numbers.
function vec3(v) {
    if (!Array.isArray(v) || v.length !== 3) return null;
    return v.every(x => typeof x === 'number' && Number.isFinite(x)) ? v : null;
}

function cleanView(view) {
    if (!view || typeof view !== 'object' || Array.isArray(view)) return null;
    const out = {
        position: vec3(view.position),
        target: vec3(view.target),
        theme: view.theme === 'dark' || view.theme === 'light' ? view.theme : null
    };
    return out.position || out.target || out.theme ? out : null;
}

// Per-instance placement: { '<key>': [{ x, z, ry }, ...] }. Coordinates are
// clamped to something walkable and each list to a handful of entries - a
// hand-edited file must not be able to put a thousand objects on the stage.
const PLACE_LIMIT = 8;
const PLACE_KEYS = 16;
const PLACE_KEY_RE = /^[A-Za-z0-9_-]{1,40}$/;
const clampN = (v, lo, hi, dflt) =>
    (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : dflt);

function cleanPlaces(places) {
    if (!places || typeof places !== 'object' || Array.isArray(places)) return {};
    const out = {};
    let keys = 0;
    for (const [key, list] of Object.entries(places)) {
        if (keys >= PLACE_KEYS || !PLACE_KEY_RE.test(key) || !Array.isArray(list)) continue;
        const arr = [];
        for (const p of list.slice(0, PLACE_LIMIT)) {
            if (!p || typeof p !== 'object' || Array.isArray(p)) {
                arr.push(null); // keep the index: instance i is still instance i
                continue;
            }
            arr.push({
                x: clampN(p.x, -300, 300, 0),
                y: clampN(p.y, -5, 60, 0),
                z: clampN(p.z, -300, 300, 0),
                ry: clampN(p.ry, -360, 360, 0),
                ...(p.auto === true ? { auto: true } : {})
            });
        }
        out[key] = arr;
        keys++;
    }
    return out;
}

// Pillar types a frame can carry at its ends. The document stores, per
// frame: { selected, types: { classical|rail_large|rail_small: { count,
// place, gap, offset } } }. Count is 0-2 per instance of the frame; place is
// where the set anchors - centre of the O2, the outer ends of its modules, or
// the inner ends beside the gap. Older documents carry one classical config
// per frame, and the very first ones a plain global number; both are
// normalised (or passed through for app.js to migrate) here.
const DOC_PILLAR_TYPE_IDS = ['classical', 'rail_large', 'rail_small'];
const DOC_DEFAULT_PILLAR_TYPE = 'classical';

function cleanPillarSlot(v) {
    const slot = {
        count: 0, place: 'outer', gap: 3, show: true,
        offset: { x: 0, y: 0, z: 0, ry: 0 }
    };
    if (!v || typeof v !== 'object' || Array.isArray(v)) return slot;
    const rawOff = v.offset && typeof v.offset === 'object' && !Array.isArray(v.offset)
        ? v.offset : {};
    slot.count = Math.round(clampN(v.count, 0, 2, 0));
    slot.place = ['centre', 'inner', 'outer'].includes(v.place) ? v.place : 'outer';
    slot.gap = clampN(v.gap, -5, 40, 3);
    slot.show = v.show !== false;
    slot.offset = {
        x: clampN(rawOff.x, -200, 200, 0),
        y: clampN(rawOff.y, -5, 60, 0),
        z: clampN(rawOff.z, -200, 200, 0),
        ry: clampN(rawOff.ry, -360, 360, 0)
    };
    if (slot.count === 1) slot.place = 'centre';
    if (slot.count === 2 && slot.place === 'centre') slot.place = 'outer';
    return slot;
}

function cleanFramePillars(raw) {
    if (typeof raw === 'number') return raw;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out = {};
    let keys = 0;
    for (const [id, v] of Object.entries(raw)) {
        if (keys >= PLACE_KEYS || !PLACE_KEY_RE.test(id)
            || !v || typeof v !== 'object' || Array.isArray(v)) continue;
        if (v.types && typeof v.types === 'object' && !Array.isArray(v.types)) {
            const types = {};
            for (const t of DOC_PILLAR_TYPE_IDS) types[t] = cleanPillarSlot(v.types[t]);
            out[id] = {
                selected: DOC_PILLAR_TYPE_IDS.includes(v.selected)
                    ? v.selected : DOC_DEFAULT_PILLAR_TYPE,
                types
            };
        } else {
            // One classical config per frame (the pre-unification shape).
            const types = {};
            for (const t of DOC_PILLAR_TYPE_IDS) types[t] = cleanPillarSlot(null);
            types[DOC_DEFAULT_PILLAR_TYPE] = cleanPillarSlot(v);
            out[id] = { selected: DOC_DEFAULT_PILLAR_TYPE, types };
        }
        keys++;
    }
    return out;
}

// Checked against its shape here and against the real list in app.js, so
// this module keeps importing nothing: the tests parse it in plain Node,
// where a three.js import would not resolve.
const SCENE_RE = /^[a-z][a-z0-9-]{0,31}$/;

// Lighting fixtures belong to their frame: { '<frameId>': [{ type, anchor,
// params }] }. Only shapes and numbers get through - the type must be a
// registered light, the anchor a plausible mount-point id, the numbers
// finite and bounded - so a hand-edited project cannot smuggle a thousand
// lights into the scene. The registered list itself is mirrored here (this
// module imports nothing); app.js re-checks against the live registry.
const ELEM_TYPES = ['light-par', 'light-led', 'light-strip'];
// Mount-point ids: kind-Side-index (`rail-L-3`, `pole-R-1`) or the strip
// lines (`stripline-L-T`, `stripline-R-B`). The old digit-only tail wiped
// every stripline anchor on load, which dropped rail strips back onto a
// pole as straight tubes.
const ELEM_ANCHOR_RE = /^[a-z]+-[A-Za-z]+-(?:\d+|T|B)$/;
const ELEM_PER_FRAME = 20;
const ELEM_TOTAL = 40;
const ELEM_PARAM_RE = /^[a-z][A-Za-z0-9]{0,15}$/;

function cleanFrameElements(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    let frames = 0, total = 0;
    for (const [id, v] of Object.entries(raw)) {
        if (frames >= PLACE_KEYS || total >= ELEM_TOTAL) break;
        if (!PLACE_KEY_RE.test(id) || !Array.isArray(v) || !v.length) continue;
        const list = [];
        for (const el of v) {
            if (list.length >= ELEM_PER_FRAME || total >= ELEM_TOTAL) break;
            if (!el || typeof el !== 'object' || Array.isArray(el)) continue;
            if (!ELEM_TYPES.includes(el.type)) continue;
            const params = {};
            if (el.params && typeof el.params === 'object' && !Array.isArray(el.params)) {
                let keys = 0;
                for (const [k, n] of Object.entries(el.params)) {
                    if (keys >= 8) break;
                    if (!ELEM_PARAM_RE.test(k)) continue;
                    // Booleans carry the schema's flags (Shown on/off);
                    // anything else has to be a real number.
                    if (typeof n === 'boolean') {
                        params[k] = n;
                        keys++;
                        continue;
                    }
                    if (typeof n !== 'number' || !Number.isFinite(n)) continue;
                    params[k] = n;
                    keys++;
                }
            }
            list.push({
                type: el.type,
                anchor: typeof el.anchor === 'string' && ELEM_ANCHOR_RE.test(el.anchor)
                    ? el.anchor : '',
                params
            });
            total++;
        }
        if (list.length) {
            out[id] = list;
            frames++;
        }
    }
    return out;
}

// One frame's floor-PAR spacing in feet: absent or zero keeps the wall's
// full-width even bays; a positive number is a centred line of lights the
// Which collapsible sections and fixture cards were folded away: section
// names (`PAR`) and per-card keys (`strip:0`). Plain strings, short and
// tightly pattern-checked - a fold is a UI preference, never structure.
function cleanFolds(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const k of raw) {
        if (out.length >= 120) break;
        if (typeof k !== 'string' || !/^[A-Za-z0-9:_-]{1,40}$/.test(k)) continue;
        out.push(k);
    }
    return out;
}

// frame re-seats on its own hooks. Keys follow the place-id rules.
function cleanFrameSpacing(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out = {};
    let keys = 0;
    for (const [id, v] of Object.entries(raw)) {
        if (keys >= PLACE_KEYS || !PLACE_KEY_RE.test(id)) continue;
        const n = Number(v);
        if (!Number.isFinite(n) || n <= 0) continue;
        out[id] = Math.max(1, Math.min(12, Math.round(n * 10) / 10));
        keys++;
    }
    return out;
}

// Documents from before the merge: Divided Entrance is Classic Symmetry now.
const LEGACY_LAYOUT = { 'divided-entrance': 'classic-symmetry' };

// The shape sliders, remembered per SET so each drawing keeps the look
// you left it with. Ranges are clamped in app.js, which owns the schema.
const DOC_SET_SHAPE_KEYS = ['gap', 'pan', 'pitch', 'decline', 'declineIn', 'lobes'];
// Colours you saved yourself: appended after the board palettes, never
// replacing them. Capped so a document cannot grow a paint shop.
function cleanExtras(raw) {
    const out = [];
    if (!Array.isArray(raw)) return out;
    for (const v of raw) {
        if (out.length >= 12) break;
        if (!v || typeof v !== 'object') continue;
        if (typeof v.id !== 'string' || !/^[a-z0-9-]{1,32}$/.test(v.id)) continue;
        const name = typeof v.name === 'string' ? v.name.trim().slice(0, 24) : '';
        if (!name) continue;
        const fabric = Number(v.fabric);
        if (!Number.isFinite(fabric) || fabric < 0 || fabric > 0xffffff) continue;
        if (out.some(c => c.id === v.id)) continue;
        out.push({ id: v.id, name, fabric: Math.round(fabric) });
    }
    return out;
}

function cleanSetPresets(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    for (const [id, v] of Object.entries(raw)) {
        if (!LAYOUT_IDS.includes(id) || !v || typeof v !== 'object') continue;
        const shape = {};
        for (const k of DOC_SET_SHAPE_KEYS) {
            const n = Number(v[k]);
            if (Number.isFinite(n)) shape[k] = n;
        }
        if (Array.isArray(v.lobeGaps)) {
            shape.lobeGaps = v.lobeGaps
                .map(Number)
                .filter(Number.isFinite)
                .slice(0, 11);
        }
        if (Object.keys(shape).length) out[id] = shape;
    }
    return out;
}

// Mounted flower panels: each references an arrangement in the Studio's own
// library by id (the library lives in the Studio's localStorage, not here) plus
// a placement. A fallback copy of `settings` travels with it so a scene still
// opens when the Studio entry has since been removed; app.js prefers the live
// Studio arrangement (matched by id) so edits there keep persisting here.
const FLOWER_PANEL_LIMIT = 12;
const FP_ID_RE = /^[a-z0-9-]{1,40}$/;

// Returns normalized settings, or null when `raw` is not an object at all.
function cleanArrangementSettings(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    try { return FlowerModel.normalize(raw); } catch { return null; }
}

function cleanFlowerPanels(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const p of raw) {
        if (out.length >= FLOWER_PANEL_LIMIT) break;
        if (!p || typeof p !== 'object' || Array.isArray(p)) continue;
        if (typeof p.id !== 'string' || !FP_ID_RE.test(p.id)) continue;
        const settings = cleanArrangementSettings(p.settings);
        if (!settings) continue;
        out.push({
            id: p.id,
            name: typeof p.name === 'string' ? p.name.trim().slice(0, 60) : '',
            arrangementId: typeof p.arrangementId === 'string' && FP_ID_RE.test(p.arrangementId)
                ? p.arrangementId : null,
            settings,
            // Old documents predate the toggle; they stay visible.
            enabled: p.enabled !== false,
            x: clampN(p.x, -300, 300, 0),
            y: clampN(p.y, -5, 60, 0),
            z: clampN(p.z, -300, 300, 0),
            ry: clampN(p.ry, -360, 360, 0)
        });
    }
    return out;
}

// Free-placed decor instances (rails, sheets): a known asset id and a
// clamped placement, same bounds as the flower panels.
const DECOR_LIMIT = 40;
const DECOR_ID_RE = /^decor-\d{1,6}$/;

function cleanDecor(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const e of raw) {
        if (out.length >= DECOR_LIMIT) break;
        if (!e || typeof e !== 'object' || Array.isArray(e)) continue;
        if (typeof e.id !== 'string' || !DECOR_ID_RE.test(e.id)) continue;
        if (typeof e.assetId !== 'string' || !DECOR_BY_ID[e.assetId]) continue;
        out.push({
            id: e.id,
            assetId: e.assetId,
            x: clampN(e.x, -300, 300, 0),
            // The arch sheet floats by default; a document that predates the
            // height field keeps that look rather than dropping to the floor.
            y: clampN(e.y, -5, 60,
                e.assetId === 'decorative_arch_panel_sheet' ? 1 : 0),
            z: clampN(e.z, -300, 300, 0),
            ry: clampN(e.ry, -360, 360, 0),
            enabled: e.enabled !== false
        });
    }
    return out;
}

// Pure: turns whatever came back from disk into a known shape, or null if it
// is unusable. Never throws - a corrupt project just means "start fresh".
export function parseProject(raw) {
    let data = raw;
    if (typeof raw === 'string') {
        try { data = JSON.parse(raw); } catch { return null; }
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;

    const project = {
        version: 2,
        name: cleanName(data.name),
        mode: data.mode === 'overlay' ? 'overlay' : 'single',
        activeId: typeof data.activeId === 'string' ? data.activeId : null,
        view: cleanView(data.view),
        scene: typeof data.scene === 'string' && SCENE_RE.test(data.scene) ? data.scene : null,
        colorway: COLORWAY_IDS.includes(data.colorway) ? data.colorway : DEFAULT_COLORWAY,
        setPresets: cleanSetPresets(data.setPresets),
        extraColors: cleanExtras(data.extraColors),
        // A raw curtain colour from the RGB dial; null means "use the
        // palette". Validated here, clamped by the panel's own dial.
        fabricColor: Number.isFinite(data.fabricColor) && data.fabricColor >= 0
            && data.fabricColor <= 0xffffff ? Math.round(data.fabricColor) : null,
        layout: typeof data.layout === 'string'
            && LAYOUT_IDS.includes(LEGACY_LAYOUT[data.layout] || data.layout)
            ? (LEGACY_LAYOUT[data.layout] || data.layout) : null,
        pillars: cleanFramePillars(data.pillars),
        elements: cleanFrameElements(data.elements),
        // Which panel sections and fixture cards the user folded away.
        folds: cleanFolds(data.folds),
        spacing: cleanFrameSpacing(data.spacing),
        places: cleanPlaces(data.places),
        // Flower panels mounted around the scene. Each references an arrangement
        // in the Studio's own library by id (see the Studio's localStorage).
        flowerPanels: cleanFlowerPanels(data.flowerPanels),
        // Free-placed manufactured decor (rails, sheets).
        decor: cleanDecor(data.decor),
        // Scene-wide flower geometry quality (drives the petal/leaf tessellation).
        flowerQuality: ['high', 'medium', 'low'].includes(data.flowerQuality)
            ? data.flowerQuality : 'medium',
        mounted: Array.isArray(data.mounted)
            ? data.mounted.filter(id => typeof id === 'string' && id)
            : [],
        overlayIds: Array.isArray(data.overlayIds)
            ? data.overlayIds.filter(id => typeof id === 'string' && id)
            : [],
        presets: {}
    };

    if (data.presets && typeof data.presets === 'object' && !Array.isArray(data.presets)) {
        for (const [id, values] of Object.entries(data.presets)) {
            if (!values || typeof values !== 'object' || Array.isArray(values)) continue;
            const clean = {};
            for (const [k, v] of Object.entries(values)) {
                if (typeof v === 'number' && Number.isFinite(v)) clean[k] = v;
                else if (typeof v === 'boolean') clean[k] = v;
            }
            if (Object.keys(clean).length) project.presets[id] = clean;
        }
    }
    return project;
}

// Pure: writes a saved value into a model's state, but only when the schema
// still has that key and the type still matches. A preset file edited by hand
// can never poison the model.
export function applySaved(state, schema, saved) {
    if (!saved || !schema) return false;
    let changed = false;
    for (const [k, v] of Object.entries(saved)) {
        const p = schema[k];
        if (!p) continue;
        if (p.type === 'range') {
            if (typeof v !== 'number' || !Number.isFinite(v)) continue;
            const clamped = Math.min(p.max, Math.max(p.min, v));
            if (state[k] === clamped) continue;
            state[k] = clamped;
            changed = true;
        } else if (p.type === 'toggle') {
            if (typeof v !== 'boolean' || state[k] === v) continue;
            state[k] = v;
            changed = true;
        }
    }
    return changed;
}

export function projectToJSON(project) {
    return JSON.stringify(project, null, 2);
}

function readLocal() {
    if (!hasLocal()) return null;
    try {
        return parseProject(localStorage.getItem(STORAGE_KEY));
    } catch {
        return null;
    }
}

// Named projects live behind the API; the shared session lives in
// project.json with a localStorage mirror for a file:// open.
async function fetchNamed(id) {
    const res = await fetch(`${API}/${encodeURIComponent(id)}`, { cache: 'no-store' });
    if (res.status === 404) {
        // The row is gone: stop aiming saves at it rather than failing
        // forever, and let the caller say so.
        target = null;
        notice = 'missing';
        return null;
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
}

export async function loadProject() {
    notice = '';
    if (target && served()) {
        try {
            const payload = await fetchNamed(target);
            const project = payload ? parseProject(payload.doc) : null;
            if (project) {
                project.name = cleanName(payload.name, project.name);
                return project;
            }
            if (notice === 'missing') return readLocal();
        } catch (err) {
            console.warn('[project] could not load project ' + target, err);
            notice = 'offline';
            return readLocal();
        }
    }
    if (served()) {
        try {
            const res = await fetch(PROJECT_FILE, { cache: 'no-store' });
            if (res.ok) {
                const project = parseProject(await res.text());
                if (project) return project;
            }
        } catch {
            // fall through to the local mirror
        }
    }
    return readLocal();
}

export async function saveProject(project) {
    const json = projectToJSON(project);
    let onDisk = false;
    let status = 0;

    if (served()) {
        try {
            const res = await fetch(target ? `${API}/${target}` : PROJECT_FILE, {
                method: target ? 'PATCH' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: target ? JSON.stringify({ doc: project }) : json
            });
            onDisk = res.ok;
            status = res.status;
        } catch {
            onDisk = false;
            status = -1;
        }
    }
    if (hasLocal()) {
        try { localStorage.setItem(STORAGE_KEY, json); } catch { /* quota */ }
    }
    if (typeof window !== 'undefined') {
        window.__tiltSave = { at: Date.now(), ok: onDisk, status, target };
        if (typeof window.__tiltDiag === 'function') window.__tiltDiag();
    }
    return onDisk;
}

// The last write on the way out of the page. keepalive lets a PATCH outlive
// the document - sendBeacon can only POST, which the API would answer with a
// 405 for a named project.
export function flushProject(project) {
    const json = projectToJSON(project);
    if (hasLocal()) {
        try { localStorage.setItem(STORAGE_KEY, json); } catch { /* quota */ }
    }
    if (!served()) return false;
    try {
        fetch(target ? `${API}/${target}` : PROJECT_FILE, {
            method: target ? 'PATCH' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: target ? JSON.stringify({ doc: project }) : json,
            keepalive: true
        }).catch(() => { /* the page is closing */ });
        return true;
    } catch {
        return false;
    }
}

// Forget the local session. A named project is kept - deleting it would break
// the URL - and just has its document reset to the defaults.
export async function clearProject() {
    if (served()) {
        try {
            await fetch(target ? `${API}/${target}` : PROJECT_FILE, {
                method: target ? 'PATCH' : 'DELETE',
                headers: target ? { 'Content-Type': 'application/json' } : undefined,
                body: target ? JSON.stringify({ doc: {} }) : undefined
            });
        } catch { /* offline */ }
    }
    if (hasLocal()) {
        try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    }
}

async function patchName(name) {
    const res = await fetch(`${API}/${target}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
}

export async function renameProject(name) {
    if (!target) return false;
    const payload = await patchName(name);
    notice = '';
    return payload.name;
}

// Turn the local session into a real project: the whole document goes up in
// the create call, so nothing is lost on the redirect back.
export async function createProject(name, doc) {
    const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, doc })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
}

export async function duplicateProject(name) {
    if (!target) throw new Error('no project open');
    const res = await fetch(`${API}/${target}/duplicate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(name ? { name } : {})
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
}

