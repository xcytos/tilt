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

// Mounted models. Stage 3.2 mounts several at once; everything below already
// iterates `models[]` instead of assuming a single instance.
let models = [];
let panel = null;
let activeId = null;
let rebuildQueued = false;

function scheduleRebuild() {
    if (rebuildQueued) return;
    rebuildQueued = true;
    requestAnimationFrame(() => {
        rebuildQueued = false;
        for (const m of models) if (m.dirty && m.build) m.build();
    });
}

async function activate(id) {
    if (panel) { panel.setBusy(true); panel.setError(''); }
    try {
        const def = await registry.load(id);
        const { models: next, environment } = await registry.instantiate(def);

        viewer.clearModels();
        models = next;
        for (const m of models) viewer.addModel(m);
        activeId = id;

        if (environment.theme) {
            const dark = environment.theme === 'dark';
            viewer.setTheme(dark);
            if (panel) panel.setTheme(dark);
        }
        if (panel) { panel.setModel(models[0]); panel.setActive(id); }
        return models;
    } catch (err) {
        console.error('[registry]', err);
        if (panel) panel.setError(err.message || String(err));
        throw err;
    } finally {
        if (panel) panel.setBusy(false);
    }
}

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
await activate(firstEntry.id);

panel = createPanel({
    body: panelBody,
    model: models[0],
    catalog: registry.list,
    activeId,
    themeIsDark: viewer.isDark,
    onSelect: id => activate(id),
    onParamsChange: partial => {
        const target = panel ? panel.model : models[0];
        if (!target) return;
        target.setParams(partial);
        scheduleRebuild();
    },
    onThemeChange: isDark => {
        viewer.setTheme(isDark);
        if (panel) panel.setTheme(isDark);
    }
});

if (manifestError) {
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
    viewer, panel, registry, activate, scheduleRebuild,
    get models() { return models; },
    get activeId() { return activeId; }
};
