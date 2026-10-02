// The project file is the panel's memory: which display mode was on, which
// presets were on stage, and every control value for every preset that has
// been added. It lives on disk as project.json when served, with localStorage
// as the mirror and the only store when the page is opened from a file.

const PROJECT_FILE = 'project.json';
const STORAGE_KEY = 'o2tilt-project.v1';

function served() {
    return typeof location !== 'undefined' && /^https?:$/.test(location.protocol);
}

function hasLocal() {
    return typeof localStorage !== 'undefined';
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
        version: 1,
        mode: data.mode === 'overlay' ? 'overlay' : 'single',
        activeId: typeof data.activeId === 'string' ? data.activeId : null,
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

export async function loadProject() {
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

    if (served()) {
        try {
            const res = await fetch(PROJECT_FILE, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: json
            });
            onDisk = res.ok;
        } catch {
            onDisk = false;
        }
    }
    if (hasLocal()) {
        try { localStorage.setItem(STORAGE_KEY, json); } catch { /* quota */ }
    }
    return onDisk;
}

export async function clearProject() {
    if (served()) {
        try { await fetch(PROJECT_FILE, { method: 'DELETE' }); } catch { /* offline */ }
    }
    if (hasLocal()) {
        try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    }
}
