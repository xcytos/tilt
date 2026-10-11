import { PILLAR_ID } from './objects/pillar.js';
import { VERSION } from './version.js';

const LABEL_CLS = 'font-semibold text-gray-600 dark:text-zinc-300';
const VALUE_CLS = 'text-sky-600 dark:text-sky-400 font-mono';
const CHECK_CLS = 'custom-checkbox';
const HEADING_CLS = 'text-xs font-semibold text-gray-600 dark:text-zinc-300 mb-1';

const fmt = (value, unit) =>
    (typeof value === 'number' ? parseFloat(value.toFixed(2)) : value) + (unit || '');

function blockShell(key, label, compact) {
    const wrap = document.createElement('div');
    wrap.className = compact ? 'mb-1.5' : 'mb-3';
    const head = document.createElement('div');
    head.className = compact
        ? 'flex justify-between text-[11px] mb-0.5'
        : 'flex justify-between text-xs mb-1';
    const labelEl = document.createElement('label');
    labelEl.className = LABEL_CLS;
    labelEl.textContent = label;
    labelEl.htmlFor = `param-${key}`;
    const value = document.createElement('span');
    value.className = VALUE_CLS;
    value.id = `val-${key}`;
    head.append(labelEl, value);
    wrap.append(head);
    return { wrap, value };
}

function rangeBlock(key, p, current, compact) {
    const { wrap, value } = blockShell(key, p.label, compact);
    const input = document.createElement('input');
    input.type = 'range';
    input.id = `param-${key}`;
    input.min = p.min;
    input.max = p.max;
    input.step = p.step;
    input.value = current;
    input.className = 'w-full h-5 accent-sky-500 cursor-pointer touch-none';
    value.textContent = fmt(current, p.unit);
    wrap.appendChild(input);
    return { wrap, input, value };
}

// One placement slider: X, Depth or Turn as a full-width track - modern,
// thumb-sized, and it updates the stage while the finger moves.
function placeRangeBlock(key, label, prop, value, min, max, step, unit) {
    const wrap = document.createElement('div');
    wrap.className = 'mb-1.5';
    const head = document.createElement('div');
    head.className = 'flex justify-between text-[11px] mb-0.5';
    const labelEl = document.createElement('label');
    labelEl.className = LABEL_CLS + ' text-[11px]';
    labelEl.textContent = label;
    labelEl.htmlFor = `param-${key}`;
    const val = document.createElement('span');
    val.className = VALUE_CLS + ' text-[11px]';
    val.textContent = fmt(value, unit);
    head.append(labelEl, val);
    const input = document.createElement('input');
    input.type = 'range';
    input.id = `param-${key}`;
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(Math.round(value * 100) / 100);
    input.className = 'w-full h-5 accent-sky-500 cursor-pointer touch-none';
    wrap.append(head, input);
    return { wrap, input, value: val };
}

function toggleBlock(key, p, current) {
    const wrap = document.createElement('label');
    wrap.className = 'flex items-center gap-2 text-sm cursor-pointer hover:text-sky-600 transition-colors';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = `param-${key}`;
    input.className = CHECK_CLS;
    input.checked = !!current;
    const span = document.createElement('span');
    span.className = 'font-medium tracking-wide';
    span.textContent = p.label;
    wrap.append(input, span);
    return { wrap, input };
}

function heading(text) {
    const el = document.createElement('div');
    el.className = HEADING_CLS;
    el.textContent = text;
    return el;
}

function modeButtonCls(active) {
    return 'flex-1 text-xs font-semibold py-1.5 px-2 rounded-md border transition-colors '
        + (active
            ? 'bg-sky-600 border-sky-600 text-white'
            : 'bg-white/70 border-gray-300 text-gray-600 hover:border-sky-400 '
                + 'dark:bg-zinc-800/70 dark:border-zinc-600 dark:text-zinc-300 '
                + 'dark:hover:border-sky-500');
}

// The controls bar is generated from each mounted model's parameter schema, so
// the viewer never hard-codes a specific model's sliders. A "group" is one
// preset's worth of models ({ id, models }); single mode renders the active
// group as one flat block, overlay mode renders every mounted group as an
// accordion so several presets can be tuned side by side.
export function createPanel(opts) {
    const {
        body, model, groups = [], catalog = [], activeId, mode = 'single',
        scenes = [], scene = null, sets = [], set = null,
        framePillars = {}, places = {},
        colorways = [], colorway = '', fabricColor = null,
        recipes = [], recipe = '',
        onSelect, onToggle, onModeChange, onParamsChange,
        onSceneChange, onColorwayChange, onRgbChange, onAddColor, onRecipeChange,
        onSetChange, onFramePillarsChange, onPlaceChange,
        onShelfChange, themeIsDark = false
    } = opts;

    const titleEl = document.getElementById('model-name');
    const subEl = document.getElementById('model-sub');
    const shelfEl = document.getElementById('shelf');
    const shelfClose = document.getElementById('btn-shelf-close');
    // The shelf slides down out of the way; the toolbar stays put - and a
    // tap on the canvas or the Tools chip brings it back.
    const setShelfOpen = open => {
        if (shelfEl) shelfEl.classList.toggle('closed', !open);
        // The canvas gives up the dock's space while the shelf is up, and
        // takes it back the moment it drops.
        onShelfChange && onShelfChange(open);
    };
    if (shelfClose) {
        shelfClose.addEventListener('click', () => setShelfOpen(false));
    }
    const toolbarEl = document.getElementById('toolbar');

    // Five chips, the order a session usually takes, plus Shown when more
    // than one model can be on stage. Icons are tiny inline SVGs - no
    // font, no icon font, no network.
    const CHIP_CLS = 'flex-none flex flex-col items-center justify-center gap-0.5 '
        + 'px-3 h-12 rounded-xl border text-[10px] font-semibold leading-none '
        + 'snap-start shrink-0 transition-colors cursor-pointer select-none';
    const CHIP_ON = 'border-sky-500 bg-sky-50 text-sky-700 '
        + 'dark:bg-sky-900/40 dark:text-sky-300 dark:border-sky-700';
    const CHIP_OFF = 'border-gray-200 bg-white/60 text-gray-500 hover:border-sky-400 '
        + 'dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-400';
    const icon = paths => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('width', '18');
        svg.setAttribute('height', '18');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '2');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        svg.setAttribute('aria-hidden', 'true');
        const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p.setAttribute('d', paths);
        svg.appendChild(p);
        return svg;
    };
    const TOOLS = [
        { id: 'shown', label: 'Shown',
          icon: icon('M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z'),
          show: () => currentMode === 'overlay' || catalog.length > 1 },
        { id: 'sets', label: 'Sets',
          icon: icon('M4 6h16M4 12h16M4 18h10'),
          show: () => sets.length > 1 },
        { id: 'look', label: 'Look',
          icon: icon('M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z'),
          show: () => recipes.length > 1 || scenes.length > 1 },
        { id: 'colour', label: 'Colour',
          icon: icon('M12 21a9 9 0 1 1 0-18c4.97 0 9 3.58 9 8 0 2.5-2 4-4 4h-2'
              + 'a2 2 0 0 0-1.4 3.4A2 2 0 0 1 12 21z'),
          show: () => true },
        { id: 'shape', label: 'Shape',
          icon: icon('M4 8h10M18 8h2M4 16h2M10 16h10'),
          show: () => true },
        { id: 'pillars', label: 'Pillars',
          icon: icon('M6 21V7M12 21V7M18 21V7M4 7h16'),
          show: () => frameGroupsOf().length > 0 }
    ];

    function renderToolbar() {
        if (!toolbarEl) return;
        const live0 = TOOLS.filter(t => t.show());
        if (!live0.some(t => t.id === activeTool)) activeTool = 'shape';
        toolbarEl.textContent = '';
        for (const t of live0) {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = CHIP_CLS + ' ' + (t.id === activeTool ? CHIP_ON : CHIP_OFF);
            chip.setAttribute('aria-pressed', t.id === activeTool ? 'true' : 'false');
            chip.append(t.icon, document.createTextNode(t.label));
            chip.addEventListener('click', () => {
                if (activeTool === t.id) {
                    setShelfOpen(false);
                    return;
                }
                activeTool = t.id;
                setShelfOpen(true);
                renderIfChanged(true);
            });
            live.buttons.push(chip);
            toolbarEl.appendChild(chip);
        }
    }

    function frameGroupsOf() {
        return currentGroups.filter(g => g.id !== PILLAR_ID);
    }

    function emptyNote(text) {
        const p = document.createElement('p');
        p.className = 'text-xs text-gray-500 dark:text-zinc-400 px-1 py-3';
        p.textContent = text;
        return p;
    }
    // Tap the canvas to toggle: down when the shelf is up, up when it is
    // down. A real orbit-drag never counts - only a still tap under 6px.
    const canvasHost = document.getElementById('canvas-container');
    if (canvasHost) {
        let downX = 0, downY = 0;
        canvasHost.addEventListener('pointerdown', e => {
            downX = e.clientX;
            downY = e.clientY;
        });
        canvasHost.addEventListener('pointerup', e => {
            if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return;
            if (!shelfEl) return;
            setShelfOpen(shelfEl.classList.contains('closed'));
        });
    }

    let currentMode = mode;
    let currentGroups = groups;
    let current = model;
    let activeId_ = activeId;
    let currentScene = scene;
    let currentSet = set;
    let currentFramePillars = framePillars;
    let currentPlaces = places;
    let currentColorway = colorway;
    let currentFabricColor = fabricColor;
    let currentRecipe = recipe;
    // Which toolbar chip owns the shelf right now. Structural: switching
    // tools rebuilds the shelf body, never the viewer.
    let activeTool = 'shape';
    // Add colour swaps this list without a structural render.
    let currentColorways = colorways;
    // Live refs for applyLive: value-level updates never rebuild the DOM.
    let setSelectRef = null;
    let setNoteRef = null;
    let sceneSelectRef = null;
    let rgbDialRef = null;
    const recipeBtns = new Map();
    const sceneChips = new Map();
    const colorChips = new Map();
    const placeRows = new Map();

    let sections = [];
    let live = { selects: [], checks: [], buttons: [] };
    let busy = false;
    let liveTheme = themeIsDark;
    let lastSignature = null;

    body.textContent = '';

    const msg = document.createElement('p');
    msg.id = 'panel-msg';
    msg.className = 'hidden mb-3 text-[11px] leading-snug text-red-600 dark:text-red-400';
    body.appendChild(msg);

    const host = document.createElement('div');
    body.appendChild(host);

    function emit(partial, targets) {
        onParamsChange && onParamsChange(partial, targets);
    }

    // Busy takes everything down, but a control can also be off on its own
    // (a stepper at its limit, a position locked to the frame) - `data-off`
    // records that so this never switches it back on.
    function applyBusy() {
        for (const group of [live.selects, live.checks, live.buttons]) {
            for (const el of group) el.disabled = busy || el.dataset.off === '1';
        }
    }

    // One collapsible block of parameters for one preset. `targets` is the
    // preset's models, so a preset holding several objects is edited at once.
    // `tool` picks which subject this section speaks to: shape sliders and
    // placement for Shape, the Curtains toggle and fabric for Colour, the
    // pillars group for Pillars.
    function section(group, collapsible, open, tool = 'shape') {
        const key = group.id || 'active';
        const idx = typeof group.inst === 'number' ? group.inst : 0;
        const targets = (group.models || []).filter(Boolean);
        const schema = targets[0];

        let root, inner;
        if (collapsible) {
            root = document.createElement('details');
            root.className = 'mb-3 rounded-lg border '
                + 'border-gray-200 dark:border-zinc-700 bg-white/40 dark:bg-zinc-800/40';
            const summary = document.createElement('summary');
            summary.className = 'cursor-pointer select-none px-3 py-2 text-xs '
                + 'font-semibold text-gray-700 dark:text-zinc-200';
            summary.textContent = (schema ? schema.name : group.id)
                + (group.total > 1 ? ` ${idx + 1}` : '');
            inner = document.createElement('div');
            inner.className = 'px-3 pb-3';
            root.append(summary, inner);
            root.open = !!open;
        } else {
            root = document.createElement('div');
            inner = root;
        }

        const rows = {};
        const normalToggles = [];
        const shapeRanges = [];
        const advancedRanges = [];
        const advancedToggles = [];

        // Renders one control and wires it to `emit`, so the schema stays the
        // only source of truth for what the panel shows.
        const addRange = (k, p) => {
            const built = rangeBlock(`${key}-${k}`, p, schema.state[k]);
            built.input.addEventListener('input', e => {
                const v = parseFloat(e.target.value);
                built.value.textContent = fmt(v, p.unit);
                emit({ [k]: v }, targets);
            });
            rows[k] = built;
            return built.wrap;
        };
        const addToggle = (k, p) => {
            const built = toggleBlock(`${key}-${k}`, p, schema.state[k]);
            built.input.addEventListener('change', e => {
                emit({ [k]: e.target.checked }, targets);
            });
            rows[k] = built;
            return built.wrap;
        };

        if (schema && schema.params) {
            for (const [k, p] of Object.entries(schema.params)) {
                // The Curtains toggle and the fabric belong to Colour; the
                // sliders and the advanced gear belong to Shape.
                if (tool === 'colour') {
                    if (p.type === 'toggle') normalToggles.push([k, p]);
                    continue;
                }
                if (p.advanced) {
                    (p.type === 'range' ? advancedRanges : advancedToggles)
                        .push([k, p]);
                } else if (p.type === 'range') {
                    shapeRanges.push([k, p]);
                }
            }
        }

        // The S Curve is one open group: the four shape sliders plus where
        // this frame stands (X / Depth / Turn as tracks). Open by default -
        // it is what the hand reaches for first. Pillars stay below.
        if (tool === 'shape' && shapeRanges.length) {
            const details = document.createElement('details');
            details.open = true;
            details.className = 'mt-3 rounded-md border border-dashed '
                + 'border-gray-300 dark:border-zinc-600';
            const summary = document.createElement('summary');
            summary.className = 'cursor-pointer select-none px-2 py-1.5 text-[11px] '
                + 'font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-400';
            summary.textContent = 'S Curve';
            const bodyEl = document.createElement('div');
            bodyEl.className = 'px-2 pb-2';
            for (const [k, p] of shapeRanges) bodyEl.appendChild(addRange(k, p));
            const place = (currentPlaces[key] || [])[idx];
            if (place) bodyEl.appendChild(positionBlock(key, idx, place));
            details.append(summary, bodyEl);
            inner.appendChild(details);
        }

        if (tool === 'colour' && normalToggles.length) {
            const row = document.createElement('div');
            row.className = 'flex flex-wrap gap-4 pt-1';
            for (const [k, p] of normalToggles) row.appendChild(addToggle(k, p));
            inner.appendChild(row);
            // The Curtains toggle owns the fabric: palettes and the RGB dial
            // live under it, not in a row of their own.
            if (schema && schema.params && schema.params.fabric) {
                inner.appendChild(fabricBlock());
            }
        }

        // One gear per frame section: the advanced numbers only. The
        // pillar's look moved into the frame's Pillars group below.
        if (tool === 'shape' && (advancedRanges.length || advancedToggles.length)) {
            const details = document.createElement('details');
            details.className = 'mt-2 rounded-md border border-dashed '
                + 'border-gray-300 dark:border-zinc-600';
            const summary = document.createElement('summary');
            summary.className = 'cursor-pointer select-none px-2 py-1.5 text-[11px] '
                + 'font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-400';
            summary.append(gearIcon(), document.createTextNode('Settings'));
            const gearBody = document.createElement('div');
            gearBody.className = 'px-2 pb-2';
            for (const [k, p] of advancedRanges) gearBody.appendChild(addRange(k, p));
            if (advancedToggles.length) {
                const row = document.createElement('div');
                row.className = 'flex flex-wrap gap-4 pt-1';
                for (const [k, p] of advancedToggles) row.appendChild(addToggle(k, p));
                gearBody.appendChild(row);
            }
            details.append(summary, gearBody);
            inner.appendChild(details);
        }

        // Pillars: one group per frame, gone until the frame has some.
        // Count, place, the offset and the pillar's look all live here.
        if (tool === 'pillars') inner.appendChild(pillarsBlock(key));

        const sec = { key, targets, rows, root };
        sections.push(sec);
        return root;
    }

    // Where this frame stands, as sliders: X, Depth and Turn on full-width
    // tracks inside the S Curve group - no bare number boxes. The stage
    // follows the thumb; applyLive parks it when a finger is on the track.
    function positionBlock(key, idx, place) {
        // Folded by default: the four shape sliders are what the hand
        // reaches for; placement comes after, and the chevron opens it.
        const wrap = document.createElement('details');
        wrap.className = 'mt-1.5 border-t border-dashed '
            + 'border-gray-300 dark:border-zinc-600';
        const summary = document.createElement('summary');
        summary.className = 'cursor-pointer select-none py-1.5 text-[10px] '
            + 'font-bold uppercase tracking-wider '
            + 'text-gray-400 dark:text-zinc-500';
        summary.textContent = 'Placement';
        wrap.appendChild(summary);
        const body = document.createElement('div');
        body.className = 'pt-1';

        const refs = {};
        for (const [label, prop, min, max, step, unit] of [
            ['X', 'x', -40, 40, 0.5, ' ft'],
            ['Depth', 'z', -40, 40, 0.5, ' ft'],
            ['Turn', 'ry', -90, 90, 1, '°']
        ]) {
            const built = placeRangeBlock(`${key}-pos-${prop}`, label, prop,
                place[prop], min, max, step, unit);
            built.input.addEventListener('input', e => {
                const v = parseFloat(e.target.value);
                if (!Number.isFinite(v)) return;
                built.value.textContent = fmt(v, unit);
                onPlaceChange && onPlaceChange(key, idx, { [prop]: v });
            });
            live.selects.push(built.input);
            refs[prop] = { input: built.input };
            body.appendChild(built.wrap);
        }

        // Back to the SET's own numbers: zero the free override, let the
        // drawing speak again.
        const reset = document.createElement('button');
        reset.type = 'button';
        reset.className = 'mt-0.5 w-full text-[11px] px-2 py-1 rounded border '
            + 'border-gray-300 dark:border-zinc-600 text-gray-500 dark:text-zinc-400 '
            + 'hover:border-sky-400 hover:text-sky-600 transition-colors';
        reset.textContent = 'Reset placement';
        reset.title = 'Zero X / Depth / Turn - back to the SET drawing';
        reset.addEventListener('click', () => {
            onPlaceChange && onPlaceChange(key, idx, { x: 0, z: 0, ry: 0 });
        });
        live.buttons.push(reset);
        body.appendChild(reset);
        wrap.appendChild(body);

        const slot = placeRows.get(key + ':' + idx) || {};
        Object.assign(slot, refs);
        placeRows.set(key + ':' + idx, slot);
        return wrap;
    }

    // A small settings gear, for the pillar's look.
    function gearIcon() {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'currentColor');
        svg.setAttribute('class', 'w-3.5 h-3.5 inline -mt-px mr-1 align-middle');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32'
            + '-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.49'
            + '.49 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a'
            + '.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c'
            + '-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 00-.59.22L2.74 8.87c'
            + '-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07'
            + '.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22'
            + 'l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84'
            + 'c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39'
            + '.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01'
            + '-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62'
            + ' 3.6 3.6-1.62 3.6-3.6 3.6z');
        svg.appendChild(path);
        return svg;
    }

    // This frame's own pillars, as one group that only exists while the
    // frame has any: the check, the count (1-2), where the pair anchors,
    // and the pillar's look - which used to be a whole accordion section
    // of its own. Count, place and look are one subject: pillars.
    function pillarsBlock(id) {
        const cfg = currentFramePillars[id] || { count: 0, place: 'outer' };
        const wrap = document.createElement('div');
        wrap.className = 'mt-3';

        const head = document.createElement('div');
        head.className = 'flex items-center justify-between';
        const title = document.createElement('div');
        title.className = 'text-[11px] font-semibold uppercase tracking-wider '
            + 'text-gray-500 dark:text-zinc-400';
        title.textContent = 'Pillars';
        head.appendChild(title);

        const check = document.createElement('input');
        check.type = 'checkbox';
        check.id = 'param-pillars-on';
        check.className = 'w-4 h-4 accent-sky-500 cursor-pointer';
        check.checked = cfg.count > 0;
        check.addEventListener('change', e => {
            onFramePillarsChange && onFramePillarsChange(id,
                { count: e.target.checked ? Math.max(1, cfg.count) : 0 });
        });
        live.checks.push(check);
        const lab = document.createElement('label');
        lab.className = 'flex items-center gap-2 text-xs cursor-pointer '
            + 'text-gray-600 dark:text-zinc-300';
        lab.append(check, document.createTextNode('Show'));
        head.appendChild(lab);
        wrap.appendChild(head);

        if (cfg.count === 0) return wrap;

        const box = document.createElement('div');
        box.className = 'mt-2 px-2 py-2 rounded-md border border-dashed '
            + 'border-gray-300 dark:border-zinc-600';

        const row = document.createElement('div');
        row.className = 'flex items-center gap-2';
        const step = delta => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = delta > 0 ? '+' : '\u2212';
            btn.className = 'w-7 h-7 rounded-md border border-gray-300 '
                + 'dark:border-zinc-600 text-sm font-bold leading-none '
                + 'hover:bg-sky-50 dark:hover:bg-zinc-700 disabled:opacity-40';
            const next = cfg.count + delta;
            const out = next < 0 || next > 2;
            btn.disabled = out;
            btn.dataset.off = out ? '1' : '0';
            btn.addEventListener('click', () => {
                onFramePillarsChange && onFramePillarsChange(id, { count: next });
            });
            live.buttons.push(btn);
            return btn;
        };
        const value = document.createElement('span');
        value.className = 'w-8 text-center text-sm font-semibold tabular-nums';
        value.textContent = String(cfg.count);
        row.append(step(-1), value, step(1));
        box.appendChild(row);

        if (cfg.count > 0) {
            const placeWrap = document.createElement('div');
            placeWrap.id = 'param-pillars-place';
            placeWrap.className = 'mt-2';
            const items = cfg.count === 1
                ? [{ id: 'centre', name: 'Centre of the O2' }]
                : [{ id: 'outer', name: 'Outer ends' },
                   { id: 'inner', name: 'Inner (beside the gap)' }];
            const active = items.some(o => o.id === cfg.place)
                ? cfg.place : items[0].id;
            const { row } = chipRow(items, active,
                v => onFramePillarsChange && onFramePillarsChange(id, { place: v }),
                o => o.id, o => o.name);
            placeWrap.appendChild(row);
            box.appendChild(placeWrap);
        }

        // The pillar's look, from the pillar model beside this frame. Its
        // sliders emit against the pillar instances, so both pillars move
        // together - same as the old standalone section.
        const pg = currentGroups.find(g => g.id === PILLAR_ID && g.owner === id);
        const pm = pg && pg.models && pg.models[0];
        if (pm && pm.params) {
            const details = document.createElement('details');
            details.className = 'mt-2 rounded-md border border-dashed '
                + 'border-gray-300 dark:border-zinc-600';
            const summary = document.createElement('summary');
            summary.className = 'cursor-pointer select-none px-2 py-1.5 text-[11px] '
                + 'font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-400';
            summary.append(gearIcon(), document.createTextNode('Look'));
            const bodyEl = document.createElement('div');
            bodyEl.className = 'px-2 pb-2';
            for (const [k, p] of Object.entries(pm.params)) {
                if (p.type !== 'range') continue;
                const built = rangeBlock(`pillar-${k}`, p, pm.state[k]);
                built.input.addEventListener('input', e => {
                    const v = parseFloat(e.target.value);
                    built.value.textContent = fmt(v, p.unit);
                    emit({ [k]: v }, pg.models);
                });
                bodyEl.appendChild(built.wrap);
            }
            details.append(summary, bodyEl);
            box.appendChild(details);
        }

        // Free numbers on top of the anchor: X / Depth / Turn for the pair,
        // same compact tracks as the frame's own placement. The offset is
        // added to wherever the place option puts them.
        const posTitle = document.createElement('div');
        posTitle.className = 'mt-1.5 mb-1 text-[10px] font-bold uppercase '
            + 'tracking-wider text-gray-400 dark:text-zinc-500';
        posTitle.textContent = 'Placement';
        box.appendChild(posTitle);
        const off = cfg.offset || { x: 0, z: 0, ry: 0 };
        for (const [label, prop, min, max, step, unit] of [
            ['X', 'x', -40, 40, 0.5, ' ft'],
            ['Depth', 'z', -40, 40, 0.5, ' ft'],
            ['Turn', 'ry', -90, 90, 1, '°']
        ]) {
            const built = placeRangeBlock(`pillar-pos-${prop}`, label, prop,
                off[prop] || 0, min, max, step, unit);
            built.input.addEventListener('input', e => {
                const v = parseFloat(e.target.value);
                if (!Number.isFinite(v)) return;
                built.value.textContent = fmt(v, unit);
                onFramePillarsChange && onFramePillarsChange(id, {
                    offset: Object.assign({}, off, { [prop]: v })
                });
            });
            live.selects.push(built.input);
            box.appendChild(built.wrap);
        }

        // Back to the bare anchor: the pair stands where the place option
        // puts it, no nudge.
        const resetP = document.createElement('button');
        resetP.type = 'button';
        resetP.className = 'mt-0.5 w-full text-[11px] px-2 py-1 rounded border '
            + 'border-gray-300 dark:border-zinc-600 text-gray-500 dark:text-zinc-400 '
            + 'hover:border-sky-400 hover:text-sky-600 transition-colors';
        resetP.textContent = 'Reset placement';
        resetP.title = 'Zero the X / Depth / Turn offset';
        resetP.addEventListener('click', () => {
            onFramePillarsChange && onFramePillarsChange(id,
                { offset: { x: 0, z: 0, ry: 0 } });
        });
        live.buttons.push(resetP);
        box.appendChild(resetP);

        wrap.appendChild(box);
        return wrap;
    }

    function modeBlock() {
        const wrap = document.createElement('div');
        wrap.className = 'mb-3';
        wrap.appendChild(heading('Display'));
        const row = document.createElement('div');
        row.className = 'flex gap-2';
        for (const [val, text] of [['single', 'One at a time'], ['overlay', 'All at once']]) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = text;
            btn.className = modeButtonCls(val === currentMode);
            btn.addEventListener('click', () => {
                if (val !== currentMode && onModeChange) onModeChange(val);
            });
            live.buttons.push(btn);
            row.appendChild(btn);
        }
        wrap.appendChild(row);
        return wrap;
    }

    function selectBlock() {
        const wrap = document.createElement('div');
        wrap.className = 'mb-3';
        wrap.id = 'param-model';
        wrap.appendChild(heading('Model'));
        const { row } = chipRow(catalog, activeId_,
            id => onSelect && onSelect(id),
            e => e.id, e => e.name);
        wrap.appendChild(row);
        return wrap;
    }

    // The arrangement the frames and pillars are dropped into. "None" hands
    // placement back to the display mode, which spaces presets side by side.
    function setBlock() {
        const wrap = document.createElement('div');
        wrap.className = 'mb-3';
        // The id stays where the old select's consumers expect it.
        wrap.id = 'param-set';
        wrap.appendChild(heading('Set'));
        const { row, btns } = chipRow(
            [{ id: '', name: 'None (free placement)' }].concat(sets),
            currentSet || '',
            id => onSetChange && onSetChange(id),
            s => s.id || '', s => s.name);
        // applyLive drives the lit chip without a rebuild.
        setSelectRef = {
            // A real setter: applyLive assigns `.value`, the way it always
            // drove the old <select>.
            set value(v) {
                const id = v || '';
                for (const [cid, btn] of btns) {
                    const on = cid === id;
                    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
                    btn.className = chipCls(on);
                }
            }
        };
        wrap.appendChild(row);
        const hit0 = currentSet ? sets.find(s => s.id === currentSet) : null;
        const note = document.createElement('p');
        note.className = 'mt-1 text-[11px] text-gray-500 dark:text-zinc-400';
        note.hidden = !hit0;
        note.textContent = hit0
            ? `${hit0.subtitle} - a starting point; every position below is yours to change.`
            : '';
        setNoteRef = note;
        wrap.appendChild(note);
        return wrap;
    }


    // One section for the whole mood: a Look is SET + room + palette in one
    // tap, and the room is also choosable on its own as chips underneath.
    // The two used to be twin rows in separate sections - same five items,
    // same job - so they share one heading now.
    // One look for every choice row in the app: a modern inset chip, lit
    // when active. SETs, models, rooms, pillar places - same face.
    const chipCls = on => 'px-2.5 py-1.5 rounded-lg border text-xs transition-colors '
        + (on
            ? 'border-sky-500 ring-1 ring-sky-400 font-semibold bg-sky-50 dark:bg-sky-900/30'
            : 'border-gray-200 dark:border-zinc-700 bg-white/70 dark:bg-zinc-800/70 '
                + 'hover:border-sky-400 text-gray-600 dark:text-zinc-300');

    function chipRow(items, activeId, onPick, keyOf, labelOf) {
        const row = document.createElement('div');
        row.className = 'flex flex-wrap gap-2';
        const btns = new Map();
        for (const item of items) {
            const id = keyOf(item);
            const btn = document.createElement('button');
            btn.type = 'button';
            const on = id === (activeId || '');
            btn.className = chipCls(on);
            btn.setAttribute('aria-pressed', on ? 'true' : 'false');
            btn.textContent = labelOf(item);
            btn.addEventListener('click', () => onPick(id));
            live.buttons.push(btn);
            btns.set(id, btn);
            row.appendChild(btn);
        }
        return { row, btns };
    }

    function lookBlock() {
        const wrap = document.createElement('div');
        wrap.className = 'mb-3';
        wrap.appendChild(heading('Look'));
        if (recipes.length > 1) {
            const { row, btns } = chipRow(recipes, currentRecipe,
                id => onRecipeChange && onRecipeChange(id),
                r => r.id, r => r.name);
            for (const [id, btn] of btns) recipeBtns.set(id, btn);
            wrap.appendChild(row);
        }
        if (scenes.length > 1) {
            const lab = document.createElement('div');
            lab.className = 'mt-2 mb-1 text-[11px] font-semibold uppercase '
                + 'tracking-wider text-gray-500 dark:text-zinc-400';
            lab.textContent = 'Room';
            wrap.appendChild(lab);
            const { row, btns } = chipRow(scenes, currentScene,
                id => onSceneChange && onSceneChange(id),
                x => x.id, x => x.name);
            for (const [id, btn] of btns) sceneChips.set(id, btn);
            wrap.appendChild(row);
        }
        return wrap;
    }

    // What the stage is actually wearing: the RGB dial's colour when one
    // was dialled, else the palette chip's fabric.
    const effectiveFabric = () => {
        if (Number.isFinite(currentFabricColor)) return currentFabricColor;
        const hit = colorways.find(c => c.id === currentColorway);
        return hit ? hit.fabric : 0xf2e8d5;
    };
    const hexText = v => '#' + (v >>> 0).toString(16).padStart(6, '0');

    // The curtain's colour, under the Curtains toggle where it belongs: the
    // board palettes plus a raw RGB dial for the colour no board names.
    function fabricBlock() {
        const wrap = document.createElement('div');
        wrap.className = 'mt-2 pt-2 border-t border-dashed '
            + 'border-gray-300 dark:border-zinc-600';
        wrap.appendChild(heading('Fabric colour'));
        const eff = effectiveFabric();

        const row = document.createElement('div');
        row.className = 'flex flex-wrap gap-2 mb-2';
        for (const c of currentColorways) {
            const btn = document.createElement('button');
            btn.type = 'button';
            const on = c.fabric === eff;
            btn.className = 'flex items-center gap-2 px-2 py-1.5 rounded-lg border text-xs '
                + 'transition-colors ' + (on
                    ? 'border-sky-500 ring-1 ring-sky-400 font-semibold'
                    : 'border-gray-300 dark:border-zinc-600 hover:border-sky-400');
            btn.setAttribute('aria-pressed', on ? 'true' : 'false');
            const chip = document.createElement('span');
            chip.className = 'w-4 h-4 rounded-full border border-black/10 shrink-0';
            chip.style.background = hexText(c.fabric);
            const label = document.createElement('span');
            label.textContent = c.name;
            btn.append(chip, label);
            btn.addEventListener('click', () => {
                onColorwayChange && onColorwayChange(c.id);
            });
            live.buttons.push(btn);
            colorChips.set(c.fabric, btn);
            row.appendChild(btn);
        }
        wrap.appendChild(row);

        // The raw dial stays folded away until someone asks for a colour no
        // board names: "Add colour" opens it, "Save swatch" keeps it.
        const rgbDetails = document.createElement('details');
        rgbDetails.className = 'mt-1 rounded-md border border-dashed '
            + 'border-gray-300 dark:border-zinc-600';
        const rgbSum = document.createElement('summary');
        rgbSum.className = 'cursor-pointer select-none px-2 py-1.5 text-[11px] '
            + 'font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-400';
        rgbSum.textContent = 'Custom colour (RGB)';
        const rgb = document.createElement('div');
        rgb.className = 'px-2 pb-2';
        const head = document.createElement('div');
        head.className = 'flex items-center gap-3 mb-2';

        // The native colour pad: a real wheel on every phone, no three
        // fiddly channel sliders to fight with. The hex label keeps the
        // exact value readable; the fold still holds Save swatch.
        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.value = hexText(eff);
        colorInput.className = 'w-14 h-14 rounded-xl border border-gray-300 '
            + 'dark:border-zinc-600 cursor-pointer bg-transparent p-0 shrink-0';
        colorInput.setAttribute('aria-label', 'Curtain colour dial');
        colorInput.addEventListener('input', e => {
            const hex = parseInt(String(e.target.value).replace('#', ''), 16);
            hexLabel.textContent = hexText(hex) + ' custom';
            onRgbChange && onRgbChange(hex);
        });
        if (live.inputs) live.inputs.push(colorInput);

        const hexLabel = document.createElement('span');
        hexLabel.className = 'text-[11px] font-mono text-gray-500 dark:text-zinc-400';
        hexLabel.textContent = hexText(eff) + ' custom';
        head.append(colorInput, hexLabel);
        rgb.appendChild(head);

        // applyLive drives the pad without firing onRgbChange.
        rgbDialRef = {
            set(hex) {
                colorInput.value = hexText(hex);
                hexLabel.textContent = hexText(hex) + ' custom';
            }
        };

        // Keep the dialled colour as a new swatch - the board palettes are
        // never edited, the list only grows after them. Lives inside the
        // fold: open the dial, dial, then keep.
        const save = document.createElement('button');
        save.type = 'button';
        save.className = 'mt-2 w-full text-[11px] px-2 py-1.5 rounded border '
            + 'border-gray-300 dark:border-zinc-600 text-gray-500 dark:text-zinc-400 '
            + 'hover:border-sky-400 hover:text-sky-600 transition-colors';
        save.textContent = 'Save swatch';
        save.title = 'Save the dialled colour as a new swatch';
        save.addEventListener('click', () => onAddColor && onAddColor());
        live.buttons.push(save);
        rgb.appendChild(save);
        rgbDetails.append(rgbSum, rgb);
        wrap.appendChild(rgbDetails);

        // Add colour = open the dial; the fold is where the work happens.
        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'mt-2 w-full text-[11px] px-2 py-1.5 rounded border '
            + 'border-gray-300 dark:border-zinc-600 text-gray-500 dark:text-zinc-400 '
            + 'hover:border-sky-400 hover:text-sky-600 transition-colors';
        add.textContent = 'Add colour';
        add.title = 'Open the RGB dial for a colour no board names';
        add.addEventListener('click', () => {
            rgbDetails.open = true;
            rgbSum.scrollIntoView({ block: 'nearest' });
        });
        live.buttons.push(add);
        wrap.appendChild(add);
        return wrap;
    }

    // The room the set stands in. Kept next to the display controls rather
    // than in the model sections: a scene belongs to the project, not to a
    // preset.
    // Which presets are mounted. In overlay mode this is how models get in and
    // out of the scene; the accordions below only appear for what is mounted.
    function pickerBlock() {
        const wrap = document.createElement('div');
        wrap.className = 'mb-3';
        wrap.appendChild(heading('Shown'));
        const list = document.createElement('div');
        list.className = 'flex flex-col gap-1';
        const shown = new Set(currentGroups.map(g => g.id));
        for (const entry of catalog) {
            const lab = document.createElement('label');
            lab.className = 'flex items-center gap-2 text-sm cursor-pointer '
                + 'hover:text-sky-600 transition-colors';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.className = CHECK_CLS;
            cb.checked = shown.has(entry.id);
            cb.addEventListener('change', e => onToggle && onToggle(entry.id, e.target.checked));
            const span = document.createElement('span');
            span.className = 'font-medium';
            span.textContent = entry.name;
            lab.append(cb, span);
            list.appendChild(lab);
            live.checks.push(cb);
        }
        wrap.appendChild(list);
        return wrap;
    }

    // Dark mode and Reset live in the top bar's three-dot menu now - they
    // are app actions, not stage tools. The shelf keeps only the stamp.
    function themeFooter() {
        const footer = document.createElement('div');
        footer.className = 'flex items-center pt-3 mt-1 border-t '
            + 'border-gray-200 dark:border-zinc-700';
        const stamp = document.createElement('span');
        stamp.className = 'ml-auto text-[10px] text-gray-400 dark:text-zinc-500 '
            + 'select-none';
        stamp.textContent = 'TILT v' + VERSION;
        stamp.title = 'Build version';
        footer.appendChild(stamp);
        return footer;
    }

    // Structural signature only: value-level fields (set, scene, colour,
    // recipe, places, shape) travel through applyLive and never force a
    // rebuild - a SET tap must not re-render the whole panel under the
    // finger.
    function signature() {
        return [
            currentMode,
            currentGroups.map(g => g.id).join(','),
            activeId_ || '',
            JSON.stringify(currentFramePillars),
            (current && current.name) || ''
        ].join('|');
    }

    function render() {
        setSelectRef = null;
        setNoteRef = null;
        sceneSelectRef = null;
        rgbDialRef = null;
        recipeBtns.clear();
        sceneChips.clear();
        colorChips.clear();
        placeRows.clear();
        host.textContent = '';
        sections = [];
        live = { selects: [], checks: [], buttons: [] };

        renderToolbar();

        // One shelf, one subject: the active chip decides what the body
        // holds. Everything else lives behind its own chip.
        const overlay = currentMode === 'overlay';
        let anything = false;
        if (activeTool === 'shown') {
            if (overlay || catalog.length > 1) {
                host.appendChild(modeBlock());
                anything = true;
            }
            if (overlay) {
                if (catalog.length > 1) {
                    host.appendChild(pickerBlock());
                    anything = true;
                }
            } else if (catalog.length > 1) {
                host.appendChild(selectBlock());
                anything = true;
            }
        } else if (activeTool === 'sets') {
            if (sets.length > 1) {
                host.appendChild(setBlock());
                anything = true;
            }
        } else if (activeTool === 'look') {
            if (recipes.length > 1 || scenes.length > 1) {
                host.appendChild(lookBlock());
                anything = true;
            }
        } else {
            // Frame groups get sections; pillars ride inside their frame's
            // Pillars group, so they never get a section of their own.
            const frameGroups = frameGroupsOf();
            if (frameGroups.length) {
                frameGroups.forEach((g, i) => host.appendChild(
                    section(g, frameGroups.length > 1, i === 0, activeTool)));
                anything = true;
            }
        }
        if (!anything) {
            host.appendChild(emptyNote(
                activeTool === 'pillars'
                    ? 'No frames on stage - nothing to put pillars beside.'
                    : 'Nothing here yet.'));
        }

        if (titleEl) titleEl.textContent = (current && current.name) || '';
        if (subEl) {
            subEl.textContent = overlay
                ? `${currentGroups.length} model${currentGroups.length === 1 ? '' : 's'} - all at once`
                : (current && current.subtitle) || '';
        }

        if (!currentGroups.length) {
            const empty = document.createElement('p');
            empty.className = 'text-xs text-gray-500 dark:text-zinc-400 mb-2';
            empty.textContent = 'No models shown.';
            host.appendChild(empty);
        }

        // Look and Sets live behind their own chips now; only the theme
        // footer (global, small) rides along at the bottom of every shelf.
        host.appendChild(themeFooter());
        applyBusy();
    }

    function renderIfChanged(force) {
        const sig = signature();
        if (!force && sig === lastSignature) return false;
        lastSignature = sig;
        render();
        return true;
    }

    renderIfChanged(true);

    return {
        get model() { return current; },
        get mode() { return currentMode; },

        // One call, one re-render: the composition root refreshes everything
        // after a scene sync and this only repaints if something visible moved.
        refresh(next = {}, force = false) {
            if (next.mode !== undefined) currentMode = next.mode;
            if (next.groups !== undefined) currentGroups = next.groups;
            if (next.activeId !== undefined) activeId_ = next.activeId;
            if (next.scene !== undefined) currentScene = next.scene;
            if (next.set !== undefined) currentSet = next.set;
            if (next.colorway !== undefined) currentColorway = next.colorway;
            if (next.fabricColor !== undefined) currentFabricColor = next.fabricColor;
            if (next.recipe !== undefined) currentRecipe = next.recipe;
            if (next.framePillars !== undefined) currentFramePillars = next.framePillars;
            if (next.places !== undefined) currentPlaces = next.places;
            if (next.model !== undefined) current = next.model;
            if (next.colorways !== undefined) currentColorways = next.colorways;
            renderIfChanged(force);
            return this;
        },

        // Value-level repaint: the SET select, Look chips, scene select,
        // colour chips, RGB dial, the four shape sliders and the position
        // numbers all move in place. A SET tap must feel like a state
        // change, not a reload - so nothing here rebuilds the DOM.
        applyLive(next = {}) {
            if (next.set !== undefined) {
                currentSet = next.set;
                if (setSelectRef) setSelectRef.value = currentSet || '';
                if (setNoteRef) {
                    const hit = currentSet
                        ? sets.find(x => x.id === currentSet) : null;
                    setNoteRef.hidden = !hit;
                    setNoteRef.textContent = hit
                        ? `${hit.subtitle} - a starting point; `
                          + 'every position below is yours to change.'
                        : '';
                }
            }
            if (next.scene !== undefined) {
                currentScene = next.scene;
                if (sceneSelectRef) {
                    sceneSelectRef.value = currentScene
                        || (scenes[0] && scenes[0].id) || '';
                }
                for (const [id, btn] of sceneChips) {
                    const on = id === currentScene;
                    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
                    btn.className = 'px-2 py-1.5 rounded-lg border text-xs '
                        + 'transition-colors ' + (on
                            ? 'border-sky-500 ring-1 ring-sky-400 font-semibold'
                            : 'border-gray-300 dark:border-zinc-600 hover:border-sky-400');
                }
            }
            if (next.recipe !== undefined) {
                currentRecipe = next.recipe;
                for (const [id, btn] of recipeBtns) {
                    const on = id === currentRecipe;
                    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
                    btn.className = 'px-2 py-1.5 rounded-lg border text-xs '
                        + 'transition-colors ' + (on
                            ? 'border-sky-500 ring-1 ring-sky-400 font-semibold'
                            : 'border-gray-300 dark:border-zinc-600 hover:border-sky-400');
                }
            }
            if (next.colorway !== undefined || next.fabricColor !== undefined) {
                if (next.colorway !== undefined) currentColorway = next.colorway;
                if (next.fabricColor !== undefined) {
                    currentFabricColor = next.fabricColor;
                }
                const eff = effectiveFabric();
                for (const [fab, btn] of colorChips) {
                    const on = fab === eff;
                    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
                    btn.className = 'flex items-center gap-2 px-2 py-1.5 rounded-lg '
                        + 'border text-xs transition-colors ' + (on
                            ? 'border-sky-500 ring-1 ring-sky-400 font-semibold'
                            : 'border-gray-300 dark:border-zinc-600 hover:border-sky-400');
                }
                if (rgbDialRef) rgbDialRef.set(eff);
            }
            if (next.shape) {
                for (const sec of sections) {
                    const schema = sec.targets && sec.targets[0];
                    for (const [k, v] of Object.entries(next.shape)) {
                        const row = sec.rows && sec.rows[k];
                        const meta = schema && schema.params ? schema.params[k] : null;
                        if (!row || !meta) continue;
                        row.input.value = String(v);
                        if (row.value) row.value.textContent = fmt(v, meta.unit);
                    }
                }
            }
            if (next.places) {
                for (const [key, list] of Object.entries(next.places)) {
                    (list || []).forEach((place, idx) => {
                        if (!place) return;
                        const slot = placeRows.get(key + ':' + idx);
                        if (!slot) return;
                        for (const prop of ['x', 'z', 'ry']) {
                            const r = slot[prop];
                            if (!r) continue;
                            const val = Math.round(place[prop] * 100) / 100;
                            // Never fight a focused field mid-typing.
                            if (document.activeElement !== r.input) {
                                r.input.value = String(val);
                            }
                        }
                    });
                }
            }
            return this;
        },

        setBusy(value) { busy = !!value; applyBusy(); },
        setError(text) {
            msg.textContent = text || '';
            msg.classList.toggle('hidden', !text);
        },
        setTheme(isDark) {
            liveTheme = isDark;
        },
        // Re-read model state into the inputs without rebuilding the DOM, so an
        // external param change never collapses an open accordion.
        sync() {
            for (const sec of sections) {
                const owner = sec.targets[0];
                if (!owner) continue;
                for (const [k, r] of Object.entries(sec.rows)) {
                    const v = owner.state[k];
                    if (r.value) r.value.textContent = fmt(v, owner.params[k].unit);
                    if (r.input.type === 'checkbox') r.input.checked = !!v;
                    else r.input.value = v;
                }
            }
        }
    };
}
