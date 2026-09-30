import { Viewer } from './viewer.js';
import { createPanel } from './panel.js';
import { createO2TiltModel } from './models/o2tilt.js';

const container = document.getElementById('canvas-container');
const panelBody = document.getElementById('panel-body');

let viewer;
try {
    viewer = new Viewer(container);
} catch (err) {
    console.error(err);
    throw err;
}

// Models registered with the viewer. Stage 2+ swaps this single entry for a
// manifest-driven list; everything below already works on `models[]`.
const models = [createO2TiltModel()];
models.forEach(m => viewer.addModel(m));

// Coalesce every input event in a frame into one rebuild per model.
let rebuildQueued = false;
function scheduleRebuild() {
    if (rebuildQueued) return;
    rebuildQueued = true;
    requestAnimationFrame(() => {
        rebuildQueued = false;
        for (const m of models) if (m.dirty && m.build) m.build();
    });
}

const panel = createPanel({
    body: panelBody,
    model: models[0],
    onParamsChange: partial => {
        for (const m of models) m.setParams(partial);
        scheduleRebuild();
    },
    onThemeChange: isDark => viewer.setTheme(isDark)
});

viewer.setTheme(document.documentElement.classList.contains('dark'));

let minimized = false;
document.getElementById('btn-minimize').addEventListener('click', () => {
    minimized = !minimized;
    panelBody.classList.toggle('collapsed', minimized);
    document.getElementById('icon-collapse').style.display = minimized ? 'none' : 'block';
    document.getElementById('icon-expand').style.display = minimized ? 'block' : 'none';
});

viewer.start();

// Exposed for the registry/manifest stage and for manual debugging.
window.O2 = { viewer, models, panel, scheduleRebuild };
