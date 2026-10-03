// The project file is the panel's memory: which display mode was on, which
// presets were on stage, every control value for every preset that has been
// added, plus which project it belongs to and where the camera was left.
// Served builds keep a copy on disk as project.json and mirror it in
// localStorage; named projects themselves live in the SQLite database behind
// tools/store.mjs, which sanitises documents through these same helpers.

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

