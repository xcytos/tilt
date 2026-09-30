import { Viewer } from './viewer.js';
import { createPanel } from './panel.js';
import { Registry } from './registry.js';
import { createO2TiltModel, PARAMS } from './objects/o2tilt.js';

const container = document.getElementById('canvas-container');
const panelBody = document.getElementById('panel-body');

let viewer;
try {
    viewer = new Viewer(container);
} catch (err) {
    console.error(err);
    throw err;
}

const registry = new Registry('./models');
registry.register('o2tilt-frame', createO2TiltModel, PARAMS);

// Scene state. `mode` chooses between one preset on stage and several side by
// side; `mounted` holds exactly what is in the scene, keyed by preset id.
let mode = 'single';
let activeId = null;
let overlayIds = [];
const mounted = new Map();
let lastPrimary = null;
let panel = null;
let rebuildQueued = false;

// Display order always follows the manifest, not the order ticks were clicked.
function orderIds() {
    if (mode === 'single') return activeId ? [activeId] : [];
    const rank = new Map(registry.list.map((e, i) => [e.id, i]));
    return overlayIds.slice()
        .sort((a, b) => (rank.has(a) ? rank.get(a) : 1e9) - (rank.has(b) ? rank.get(b) : 1e9));
}

function groups() {
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
        viewer.layoutGroups(gs.map(g => g.models));
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

// Reconcile the scene with `orderIds()`: drop what no longer belongs, mount
// what is missing, re-space, then refresh the panel.
async function syncScene() {
    if (panel) { panel.setBusy(true); panel.setError(''); }
    try {
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
                for (const m of models) viewer.addModel(m);
                mounted.set(id, models);
            } catch (err) {
                console.error('[registry]', err);
                failures.push({ id, message: (err && err.message) || String(err) });
            }
        }

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
        viewer.layoutGroups(gs.map(g => g.models));
        viewer.frameScene();

        await applyPrimaryTheme();

        if (panel) {
            panel.refresh({
                mode,
                groups: gs,
                activeId,
                model: gs[0] ? gs[0].models[0] : null
            });
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
    return syncScene();
}

async function toggleOverlay(id, on) {
    if (on) {
        if (!overlayIds.includes(id)) overlayIds.push(id);
    } else {
        overlayIds = overlayIds.filter(x => x !== id);
    }
    return syncScene();
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
await registry.loadManifest().catch(err => {
    manifestError = err.message;
    console.warn('[registry] manifest not loaded, using the built-in model:', err);
});

const firstEntry = registry.list[0];
let startupError = '';
mode = 'single';
activeId = firstEntry.id;
try {
    await syncScene();
} catch (err) {
    startupError = (err && err.message) || String(err);
    console.error('[scene]', err);
}

const firstGroup = groups()[0];

panel = createPanel({
    body: panelBody,
    model: firstGroup ? firstGroup.models[0] : null,
    groups: groups(),
    mode,
    catalog: registry.list,
    activeId,
    themeIsDark: viewer.isDark,
    onSelect: guard(id => activate(id)),
    onModeChange: guard(next => setMode(next)),
    onToggle: guard((id, on) => toggleOverlay(id, on)),
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
            if (Object.keys(known).length) m.setParams(known);
        }
        scheduleRebuild();
    },
    onThemeChange: isDark => {
        viewer.setTheme(isDark);
        if (panel) panel.setTheme(isDark);
    }
});

if (startupError) {
    panel.setError(startupError);
} else if (manifestError) {
    const openedFromFile = !/^https?:$/.test(location.protocol);
    panel.setError(openedFromFile
        ? 'Opened straight from a file, so models/ could not be read. '
            + 'Showing the built-in model - serve this folder over HTTP to load presets.'
        : `models/manifest.json could not be loaded (${manifestError}). `
            + 'Serve this folder over HTTP to load model presets.');
}

let minimized = false;
document.getElementById('btn-minimize').addEventListener('click', () => {
    minimized = !minimized;
    panelBody.classList.toggle('collapsed', minimized);
    document.getElementById('icon-collapse').style.display = minimized ? 'none' : 'block';
    document.getElementById('icon-expand').style.display = minimized ? 'block' : 'none';
});

viewer.start();

window.O2 = {
    viewer, panel, registry, activate, setMode, toggleOverlay, syncScene, scheduleRebuild,
    get models() { return [...mounted.values()].flat(); },
    get mounted() { return [...mounted.keys()]; },
    get mode() { return mode; },
    get activeId() { return activeId; },
    get overlayIds() { return overlayIds.slice(); }
};
