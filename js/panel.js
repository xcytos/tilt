import { PILLAR_ID } from './objects/pillar.js';
import { VERSION } from './version.js';

const LABEL_CLS = 'font-semibold text-gray-600 dark:text-zinc-300';
const VALUE_CLS = 'text-sky-600 dark:text-sky-400 font-mono';
const CHECK_CLS = 'custom-checkbox';
const HEADING_CLS = 'text-xs font-semibold text-gray-600 dark:text-zinc-300 mb-1';

const fmt = (value, unit) =>
    (typeof value === 'number' ? parseFloat(value.toFixed(2)) : value) + (unit || '');

// Lobe lean angle: how far a lobe's rail segment is turned by its gap.
// tan(lean) = (2 · gap · lobes) / railLen - the vertical excursion over
// the along-rail run of one lobe. 45° at the defaults (1 ft gap, 6 lobes,
// 12 ft rail).
const lobeLeanDeg = (gap, lobes, railLen) =>
    Math.round(Math.atan(2 * gap * (lobes || 6) / (railLen || 12)) * 180 / Math.PI);
const lobeGapText = (gap, lobes, meta) =>
    `${fmt(gap, meta.unit)} · ${lobeLeanDeg(gap, lobes, meta.railLen)}°`;

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
    input.className = 'w-full h-5 accent-sky-500 cursor-pointer';
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
    input.className = 'w-full h-5 accent-sky-500 cursor-pointer';
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
        framePillars = {}, frameElements = {}, frameAnchors = {}, places = {},
        frameSpacing = {},
        colorways = [], colorway = '', fabricColor = null,
        recipes = [], recipe = '',
        onSelect, onToggle, onModeChange, onParamsChange,
        onSceneChange, onColorwayChange, onRgbChange, onAddColor, onRecipeChange,
        onSetChange, onFramePillarsChange,
        onElementAdd, onElementRemove, onElementPatch, onElementCount,
        onFrameSpacing,
        onPlaceChange,
        onFoldChange,
        onShelfChange, themeIsDark = false,
        folds = []
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
          show: () => frameGroupsOf().length > 0 },
        { id: 'lights', label: 'Lights',
          icon: icon('M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2'
              + 'M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2'
              + 'M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4'),
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
        return currentGroups.filter(g => g.id !== PILLAR_ID && !g.owner);
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
    let currentFrameElements = frameElements;
    let currentFrameAnchors = frameAnchors;
    let currentFrameSpacing = frameSpacing;
    let currentPlaces = places;
    let currentColorway = colorway;
    let currentFabricColor = fabricColor;
    let currentRecipe = recipe;
    // Which toolbar chip owns the shelf right now. Structural: switching
    // tools rebuilds the shelf body, never the viewer. A project opens on
    // Sets - the set list is the first thing a viewing session needs - and
    // only falls back when that chip is not on the toolbar.
    let activeTool = 'sets';
    // Which type the next Add light plants; remembered across rebuilds.
    let lastAddType = 'light-par';
    // Which fixtures the light numbers reach: each on its own, one wall,
    // or the whole rig. All is the default for the PAR rig - one mirrored
    // set of numbers for the whole rig. Session-local, like the type
    // chooser.
    let lightsMode = 'all';
    // LED wash panels open on Separate: one card per fixture, remove
    // right there, the mode row beside it for wall-wide edits.
    let ledMode = 'separate';
    // The strip group's side filter: which walls its palette and power
    // reach - left, right, or both at once.
    let stripSide = 'both';
    // Which sections and fixture cards the user folded away. Survives the
    // re-render an Add or retarget triggers - a fold is a preference, not
    // a accident of one paint - and the project file remembers it between
    // sessions through onFoldChange.
    const folded = new Set(folds);
    const foldSink = typeof onFoldChange === 'function' ? onFoldChange : null;
    const noteFold = () => { if (foldSink) foldSink([...folded]); };
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
    const pillarOffsetRows = new Map();

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

    // HSV maths for the shared colour square: the curtain keeps the
    // swatch's brightness while the palette picks its hue and saturation.
    const hexToHsv = hex => {
        const r = ((hex >> 16) & 255) / 255;
        const g = ((hex >> 8) & 255) / 255;
        const b = (hex & 255) / 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const d = max - min;
        let h = 0;
        if (d) {
            if (max === r) h = ((g - b) / d) % 6;
            else if (max === g) h = (b - r) / d + 2;
            else h = (r - g) / d + 4;
            h *= 60;
            if (h < 0) h += 360;
        }
        return { h, s: max ? (d / max) * 100 : 0, v: max * 100 };
    };
    const hsvToHex = (h, s, v) => {
        const c = (s / 100) * (v / 100);
        const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
        const m = v / 100 - c;
        const seg = Math.floor(h / 60) % 6;
        const rgb = [[c, x, 0], [x, c, 0], [0, c, x],
            [0, x, c], [x, 0, c], [c, 0, x]][seg];
        const r = Math.round((rgb[0] + m) * 255);
        const g = Math.round((rgb[1] + m) * 255);
        const b = Math.round((rgb[2] + m) * 255);
        return (r << 16) | (g << 8) | b;
    };

    // The one colour square every hue uses: hue across, saturation up from
    // white, a live preview chip. Drags emit on every move - the lights
    // recolour while the finger travels, not on release. `opts.v` freezes
    // brightness so a curtain keeps its swatch's lightness.
    function paletteBlock(init, onLive, opts = {}) {
        const wrap = document.createElement('div');
        wrap.className = opts.className || 'mt-2';
        const head = document.createElement('div');
        head.className = 'flex items-center justify-between mb-1';
        const lab = document.createElement('span');
        lab.className = 'text-[11px] font-semibold uppercase tracking-wider '
            + 'text-gray-500 dark:text-zinc-400';
        lab.textContent = opts.label || 'Colour';
        const prev = document.createElement('span');
        prev.className = 'w-5 h-5 rounded-full border border-black/10 shrink-0';
        head.append(lab, prev);
        wrap.appendChild(head);
        const square = document.createElement('div');
        if (opts.id) square.id = opts.id;
        square.className = 'relative w-full h-24 rounded-lg border '
            + 'border-gray-300 dark:border-zinc-600 cursor-crosshair select-none';
        square.style.background = 'linear-gradient(to top, '
            + 'rgba(255,255,255,1), rgba(255,255,255,0)), '
            + 'linear-gradient(to right, hsl(0,100%,50%), hsl(60,100%,50%), '
            + 'hsl(120,100%,50%), hsl(180,100%,50%), hsl(240,100%,50%), '
            + 'hsl(300,100%,50%), hsl(360,100%,50%))';
        const dot = document.createElement('span');
        dot.className = 'absolute w-3.5 h-3.5 -ml-1.75 -mt-1.75 rounded-full '
            + 'border-2 border-white shadow ring-1 ring-black/30 pointer-events-none';
        square.appendChild(dot);
        wrap.appendChild(square);
        let hue = Number.isFinite(init && init.hue) ? init.hue : 40;
        let sat = Number.isFinite(init && init.sat) ? init.sat : 25;
        const placeDot = () => {
            dot.style.left = `${(hue / 360) * 100}%`;
            dot.style.top = `${(1 - sat / 100) * 100}%`;
            prev.style.background = `hsl(${hue}, ${Math.max(10, sat)}%, `
                + `${Number.isFinite(opts.v) ? Math.max(20, opts.v) : 60}%)`;
        };
        placeDot();
        const dial = e => {
            const t = e.touches && e.touches[0] ? e.touches[0] : e;
            const r = square.getBoundingClientRect();
            if (!r.width || !r.height) return;
            const x = Math.max(0, Math.min(1, (t.clientX - r.left) / r.width));
            const y = Math.max(0, Math.min(1, (t.clientY - r.top) / r.height));
            hue = Math.round(x * 360);
            sat = Math.round((1 - y) * 100);
            placeDot();
            onLive && onLive(hue, sat);
        };
        let dragging = false;
        square.addEventListener('mousedown', e => {
            dragging = true;
            dial(e);
            e.preventDefault();
        });
        square.addEventListener('touchstart', e => {
            dragging = true;
            dial(e);
            e.preventDefault();
        }, { passive: false });
        document.addEventListener('mousemove', e => { if (dragging) dial(e); });
        document.addEventListener('touchmove',
            e => { if (dragging) dial(e); }, { passive: false });
        document.addEventListener('mouseup', () => { dragging = false; });
        document.addEventListener('touchend', () => { dragging = false; });
        // Drive the dot from the outside (applyLive after a swatch tap).
        wrap._set = (h, s) => {
            if (Number.isFinite(h)) hue = h;
            if (Number.isFinite(s)) sat = s;
            placeDot();
        };
        return wrap;
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
                if (p.type === 'lobeGaps') continue; // rendered below
                if (p.advanced) {
                    (p.type === 'range' ? advancedRanges : advancedToggles)
                        .push([k, p]);
                } else if (p.type === 'range') {
                    shapeRanges.push([k, p]);
                }
            }
        }

        // Per-lobe gap sliders: one per active lobe. All LOBES_MAX rows are
        // built up front and shown/hidden by the Lobes slider so a mid-drag
        // lobes change never rebuilds the DOM.
        const lobeGapMeta = schema && schema.params
            ? schema.params.lobeGaps : null;
        const lobeGapSlots = [];
        function syncLobeGapVisibility() {
            const n = Math.round(schema.state.lobes) || 6;
            lobeGapSlots.forEach((slot, i) => {
                slot.wrap.style.display = i < n ? '' : 'none';
            });
        }
        // The lean degrees on every gap row depend on the lobe count, so a
        // lobes change re-reads all of them. Always reads fresh state - the
        // lobeGaps array identity changes when setParams replaces it.
        function refreshLobeGapTexts() {
            const lobesNow = Math.round(schema.state.lobes) || 6;
            const gapsNow = Array.isArray(schema.state.lobeGaps)
                ? schema.state.lobeGaps : [];
            lobeGapSlots.forEach((slot, i) => {
                const v = Number.isFinite(gapsNow[i]) ? gapsNow[i]
                    : lobeGapMeta.value;
                slot.value.textContent = lobeGapText(v, lobesNow, lobeGapMeta);
            });
        }
        if (tool === 'shape' && lobeGapMeta) {
            const gaps = Array.isArray(schema.state.lobeGaps)
                ? schema.state.lobeGaps : [];
            const count = lobeGapMeta.count || 11;
            const lobesNow = Math.round(schema.state.lobes) || 6;
            for (let i = 0; i < count; i++) {
                const meta = {
                    label: `Lobe ${i + 1} Gap`,
                    type: 'range',
                    min: lobeGapMeta.min,
                    max: lobeGapMeta.max,
                    step: lobeGapMeta.step,
                    unit: lobeGapMeta.unit
                };
                const val = Number.isFinite(gaps[i]) ? gaps[i] : lobeGapMeta.value;
                const built = rangeBlock(`${key}-lobeGap-${i}`, meta, val);
                built.value.textContent = lobeGapText(val, lobesNow, lobeGapMeta);
                built.input.addEventListener('input', e => {
                    const v = parseFloat(e.target.value);
                    const lobesCur = Math.round(schema.state.lobes) || 6;
                    built.value.textContent = lobeGapText(v, lobesCur, lobeGapMeta);
                    // Read the state array fresh: setParams may have replaced
                    // it with a new (clamped) array since these rows were built.
                    const cur = Array.isArray(schema.state.lobeGaps)
                        ? schema.state.lobeGaps : [];
                    const arr = Array.from({ length: count },
                        (_, j) => j === i ? v
                            : (Number.isFinite(cur[j]) ? cur[j]
                                : lobeGapMeta.value));
                    if (Array.isArray(schema.state.lobeGaps)) {
                        schema.state.lobeGaps.splice(0, schema.state.lobeGaps.length, ...arr);
                    } else {
                        schema.state.lobeGaps = arr;
                    }
                    emit({ lobeGaps: arr.slice() }, targets);
                });
                rows[`lobeGap${i}`] = built;
                lobeGapSlots.push({ wrap: built.wrap, input: built.input, value: built.value });
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
            for (const [k, p] of shapeRanges) {
                bodyEl.appendChild(addRange(k, p));
                // After the Lobes slider, insert the per-lobe gap sliders
                // and keep their visibility (and lean degrees) in sync.
                if (k === 'lobes') {
                    for (const slot of lobeGapSlots) bodyEl.appendChild(slot.wrap);
                    syncLobeGapVisibility();
                    refreshLobeGapTexts();
                    rows.lobes.input.addEventListener('input', () => {
                        syncLobeGapVisibility();
                        refreshLobeGapTexts();
                    });
                    // Reset: back to the pre-lobe-feature configuration -
                    // 6 lobes at the default 1 ft gap, a plain sin(6πt)
                    // serpentine. One emit, DOM updated directly.
                    const resetBtn = document.createElement('button');
                    resetBtn.type = 'button';
                    resetBtn.className = 'mt-0.5 mb-1 w-full rounded-md border '
                        + 'border-gray-300 dark:border-zinc-600 px-2 py-1 text-[11px] '
                        + 'font-semibold uppercase tracking-wider text-gray-500 '
                        + 'dark:text-zinc-400 hover:border-sky-400 hover:text-sky-600 '
                        + 'dark:hover:text-sky-400 transition-colors';
                    resetBtn.textContent = 'Reset Lobes';
                    resetBtn.addEventListener('click', () => {
                        const n = lobeGapMeta.count || 11;
                        const resetVal = lobeGapMeta.value;
                        const arr = Array.from({ length: n }, () => resetVal);
                        schema.state.lobes = 6;
                        if (Array.isArray(schema.state.lobeGaps)) {
                            schema.state.lobeGaps.splice(0, schema.state.lobeGaps.length, ...arr);
                        } else {
                            schema.state.lobeGaps = arr;
                        }
                        rows.lobes.input.value = '6';
                        if (rows.lobes.value) {
                            rows.lobes.value.textContent =
                                fmt(6, schema.params.lobes.unit);
                        }
                        lobeGapSlots.forEach(slot => {
                            slot.input.value = String(resetVal);
                        });
                        syncLobeGapVisibility();
                        refreshLobeGapTexts();
                        emit({ lobes: 6, lobeGaps: arr.slice() }, targets);
                    });
                    bodyEl.appendChild(resetBtn);
                }
            }
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
        // Lights: one rig per frame - add, retarget, tune, remove.
        if (tool === 'lights') inner.appendChild(lightsBlock(key));

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
        // folded by default like the frame's own placement. The offset is
        // added to wherever the place option puts them.
        const posDetails = document.createElement('details');
        posDetails.className = 'mt-1.5 border-t border-dashed '
            + 'border-gray-300 dark:border-zinc-600';
        const posSummary = document.createElement('summary');
        posSummary.className = 'cursor-pointer select-none py-1.5 text-[10px] '
            + 'font-bold uppercase tracking-wider '
            + 'text-gray-400 dark:text-zinc-500';
        posSummary.textContent = 'Placement';
        posDetails.appendChild(posSummary);
        const posBody = document.createElement('div');
        posBody.className = 'pt-1';
        const off = cfg.offset || { x: 0, z: 0, ry: 0 };
        // Centre Gap: only meaningful with two pillars - symmetric spread.
        if (cfg.count === 2) {
            const builtGap = placeRangeBlock('pillar-pos-gap', 'Centre Gap',
                'gap', cfg.gap ?? 3, -5, 40, 0.5, ' ft');
            builtGap.input.addEventListener('input', e => {
                const v = parseFloat(e.target.value);
                if (!Number.isFinite(v)) return;
                builtGap.value.textContent = fmt(v, ' ft');
                onFramePillarsChange && onFramePillarsChange(id, { gap: v });
            });
            live.selects.push(builtGap.input);
            const slot = pillarOffsetRows.get(id) || {};
            slot.gap = { input: builtGap.input, value: builtGap.value };
            pillarOffsetRows.set(id, slot);
            posBody.appendChild(builtGap.wrap);
        }
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
            const slot = pillarOffsetRows.get(id) || {};
            slot[prop] = { input: built.input, value: built.value };
            pillarOffsetRows.set(id, slot);
            posBody.appendChild(built.wrap);
        }

        // Back to the bare anchor: the pair stands where the place option
        // puts it, no nudge.
        const resetP = document.createElement('button');
        resetP.type = 'button';
        resetP.className = 'mt-0.5 w-full text-[11px] px-2 py-1 rounded border '
            + 'border-gray-300 dark:border-zinc-600 text-gray-500 dark:text-zinc-400 '
            + 'hover:border-sky-400 hover:text-sky-600 transition-colors';
        resetP.textContent = 'Reset placement';
        resetP.title = 'Reset the Centre Gap to 3 ft and zero X / Depth / Turn';
        resetP.addEventListener('click', () => {
            onFramePillarsChange && onFramePillarsChange(id,
                { gap: 3, offset: { x: 0, z: 0, ry: 0 } });
        });
        live.buttons.push(resetP);
        posBody.appendChild(resetP);
        posDetails.appendChild(posBody);
        box.appendChild(posDetails);

        wrap.appendChild(box);
        return wrap;
    }

    // This frame's own lights, as one rig that only exists while the frame
    // has any: a type chooser and Add at the top, a per-wall count (1-10,
    // default 3), then a mode row - Separate is one card per fixture
    // (mount, numbers, remove), while Left, Right and All are ONE set of
    // numbers written to every fixture of that group at once. Grouped cards
    // never retarget or remove; that stays Separate. Floor mounts may only
    // aim up, so their tilt slider tops out at -30.
    function lightsBlock(id) {
        const entries = currentFrameElements[id] || [];
        const anchors = currentFrameAnchors[id] || [];
        const wrap = document.createElement('div');
        wrap.className = 'mt-3';

        const head = document.createElement('div');
        head.className = 'flex items-center justify-between';
        const title = document.createElement('div');
        title.className = 'text-[11px] font-semibold uppercase tracking-wider '
            + 'text-gray-500 dark:text-zinc-400';
        title.textContent = 'Lights';
        head.appendChild(title);
        if (entries.length) {
            const count = document.createElement('span');
            count.className = 'text-[11px] text-gray-500 dark:text-zinc-400 '
                + 'tabular-nums';
            count.textContent = `${entries.length}/20`;
            head.appendChild(count);
        }
        wrap.appendChild(head);

        // What the next Add plants: PAR, LED or Strip. Panel-local - a choice
        // about the NEXT light, remembered across rebuilds of this block.
        const choices = [
            { id: 'light-par', name: 'PAR' },
            { id: 'light-led', name: 'LED' },
            { id: 'light-strip', name: 'Strip' }
        ];
        const addRow = document.createElement('div');
        addRow.className = 'mt-2 flex items-center gap-2';
        const typeBtns = new Map();
        for (const c of choices) {
            const btn = document.createElement('button');
            btn.type = 'button';
            const on = c.id === lastAddType;
            btn.className = chipCls(on);
            btn.setAttribute('aria-pressed', on ? 'true' : 'false');
            btn.textContent = c.name;
            btn.addEventListener('click', () => {
                lastAddType = c.id;
                for (const [cid, b] of typeBtns) {
                    const act = cid === lastAddType;
                    b.className = chipCls(act);
                    b.setAttribute('aria-pressed', act ? 'true' : 'false');
                }
            });
            live.buttons.push(btn);
            typeBtns.set(c.id, btn);
            addRow.appendChild(btn);
        }
        const atCap = entries.length >= 20;
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'ml-auto px-2.5 py-1.5 rounded-md border text-xs '
            + 'font-semibold transition-colors ' + (atCap
                ? 'border-gray-300 dark:border-zinc-600 text-gray-400 dark:text-zinc-500'
                : 'border-sky-500 text-sky-600 dark:text-sky-400 hover:bg-sky-50 '
                    + 'dark:hover:bg-zinc-700');
        addBtn.textContent = 'Add';
        addBtn.title = atCap
            ? 'Twenty lights per frame - the document cap.'
            : 'Add this light to the frame';
        addBtn.disabled = atCap;
        addBtn.dataset.off = atCap ? '1' : '0';
        addBtn.addEventListener('click', () => {
            onElementAdd && onElementAdd(id, lastAddType);
        });
        live.buttons.push(addBtn);
        addRow.appendChild(addBtn);
        wrap.appendChild(addRow);

        // One section per fixture type: PAR keeps the rig controls (count,
        // spacing, Separate/Left/Right/All with the mirrored pan), LED gets
        // its own mode row, and Strip runs on its own group - side filter,
        // a live colour palette, power - because an RGB tube is a mood
        // line, not another aimed can.
        const ofType = type => entries
            .map((e, i) => ({ e, i }))
            .filter(x => x.e && x.e.type === type);
        // One collapsible section per fixture type: the heading folds the
        // whole group away so a long Lights shelf stays short. A fold is
        // remembered - the next render opens the same way.
        const sectionOf = (name, open = true) => {
            const sec = document.createElement('details');
            sec.open = open && !folded.has(name);
            sec.className = 'mt-3 pt-2 border-t border-dashed '
                + 'border-gray-300 dark:border-zinc-600';
            sec.addEventListener('toggle', () => {
                if (sec.open) folded.delete(name); else folded.add(name);
                noteFold();
            });
            const sum = document.createElement('summary');
            sum.className = 'cursor-pointer select-none pt-2 text-[11px] '
                + 'font-semibold uppercase tracking-wider '
                + 'text-gray-500 dark:text-zinc-400';
            sum.textContent = name;
            sec.appendChild(sum);
            wrap.appendChild(sec);
            return sec;
        };

        // How many floor uplights stand on EACH wall: a 1-10 slider. Only
        // frames with floor-uplight hooks offer it; committing a number
        // plants or removes the rig lights and never touches hand-placed
        // ones. It emits on release, not mid-drag: a count change rebuilds
        // the rig under the panel.
        const parSec = sectionOf('PAR');
        if (anchors.some(o => o.kind === 'uplight')) {
            const perWall = Math.max(0, ...['L', 'R'].map(s => entries
                .filter(e => e && e.type === 'light-par'
                    && e.anchor && e.anchor.startsWith(`uplight-${s}-`))
                .length));
            const cur = Math.max(1, Math.min(10, perWall || 3));
            const cnt = rangeBlock('lightcount', {
                label: 'Per wall', type: 'range', min: 1, max: 10, step: 1,
                value: cur, unit: ' lights'
            }, cur, true);
            cnt.input.addEventListener('input', e => {
                cnt.value.textContent = `${e.target.value} lights`;
            });
            cnt.input.addEventListener('change', e => {
                const v = parseInt(e.target.value, 10);
                if (Number.isFinite(v) && v !== perWall) {
                    onElementCount && onElementCount(id, v);
                }
            });
            live.selects.push(cnt.input);
            parSec.appendChild(cnt.wrap);

            // How far apart those floor PARs stand. Even (0) keeps the
            // wall's full-width bays; any number pulls the rig into a
            // centred line - mirrored on both walls - snapped to the
            // frame's own real hooks the moment the drag is released.
            const spCur = Number(currentFrameSpacing[id]) || 0;
            const spText = v => v > 0
                ? `${Math.round(v * 10) / 10} ft` : 'Even';
            const sp = rangeBlock('lightspacing', {
                label: 'Spacing', type: 'range', min: 0, max: 12, step: 0.5,
                value: spCur, unit: ' ft'
            }, spCur, true);
            sp.value.textContent = spText(spCur);
            sp.input.addEventListener('input', e => {
                const v = parseFloat(e.target.value);
                if (!Number.isFinite(v)) return;
                sp.value.textContent = spText(v);
            });
            sp.input.addEventListener('change', e => {
                const v = parseFloat(e.target.value);
                if (Number.isFinite(v)) onFrameSpacing && onFrameSpacing(id, v);
            });
            live.selects.push(sp.input);
            parSec.appendChild(sp.wrap);
        }

        // Resolved from the panel's groups on every use, never captured: a
        // sync can swap the rig's models underneath the shelf, and a stale
        // reference would send the drag to fixtures no longer on stage -
        // the settings would land nowhere. This is what keeps every light
        // in the group answering a shared slider.
        const lmOf = i => {
            const g = currentGroups.find(x => x.owner === id
                && x.inst === i && x.id !== PILLAR_ID);
            return (g && g.models && g.models[0]) || null;
        };
        // Which wall a fixture stands on: every anchor id carries its side
        // (uplight-L-0, rail-R-4, pole-L-1, stripline-L-T); a sideless
        // anchor is only editable in Separate and All.
        const sideOf = anchor => {
            const hit = /-(L|R)-/.exec(anchor || '');
            return hit ? hit[1] : null;
        };
        const memberIdx = (mode, typeFilter) => entries
            .map((_, i) => i)
            .filter(i => !typeFilter
                || ((entries[i] || {}).type === typeFilter))
            .filter(i => mode === 'all'
                || sideOf((entries[i] || {}).anchor)
                    === (mode === 'left' ? 'L' : 'R'));

        // Which fixtures the numbers below reach. Separate keeps the
        // per-fixture cards; Left / Right / All collapse to one card that
        // writes every fixture in the group at once.
        const modeRowFor = (getMode, setMode, repaint) => {
            const modeRow = document.createElement('div');
            modeRow.className = 'mt-2 flex items-center gap-2';
            const modeBtns = new Map();
            for (const [val, label, desc] of [
                ['separate', 'Separate', 'Each fixture keeps its own numbers'],
                ['left', 'Left', 'One set of numbers for the left curtain wall'],
                ['right', 'Right', 'One set of numbers for the right curtain wall'],
                ['all', 'All', 'One set of numbers for every fixture - the right wall mirrors the left']
            ]) {
                const btn = document.createElement('button');
                btn.type = 'button';
                const on = val === getMode();
                btn.className = chipCls(on);
                btn.setAttribute('aria-pressed', on ? 'true' : 'false');
                btn.textContent = label;
                btn.title = desc;
                btn.addEventListener('click', () => {
                    if (getMode() === val) return;
                    setMode(val);
                    for (const [v, b] of modeBtns) {
                        const act = v === getMode();
                        b.className = chipCls(act);
                        b.setAttribute('aria-pressed', act ? 'true' : 'false');
                    }
                    repaint();
                });
                live.buttons.push(btn);
                modeBtns.set(val, btn);
                modeRow.appendChild(btn);
            }
            return modeRow;
        };

        // One collapsible card per fixture, in the order of its frame's
        // own list: the heading folds the card away, remove stays in the
        // heading so it is reachable either way.
        const paintSeparate = (parent, typeFilter) => {
        ofType(typeFilter).forEach(({ e: entry, i }) => {
            const lm = lmOf(i);
            const card = document.createElement('details');
            const foldKey = `${typeFilter}:${i}`;
            card.open = !folded.has(foldKey);
            card.className = 'mt-2 px-2 py-2 rounded-md border border-dashed '
                + 'border-gray-300 dark:border-zinc-600';
            card.addEventListener('toggle', () => {
                if (card.open) folded.delete(foldKey); else folded.add(foldKey);
                noteFold();
            });

            const ch = document.createElement('summary');
            ch.className = 'cursor-pointer select-none flex items-center '
                + 'justify-between';
            const nameEl = document.createElement('span');
            nameEl.className = 'text-xs font-semibold text-gray-700 dark:text-zinc-200';
            nameEl.textContent = ((lm && lm.name) || entry.type) + ' ' + (i + 1);
            const rm = document.createElement('button');
            rm.type = 'button';
            rm.className = 'w-7 h-7 rounded-md border border-gray-300 '
                + 'dark:border-zinc-600 text-xs leading-none text-gray-500 '
                + 'dark:text-zinc-400 hover:border-red-400 hover:text-red-500 '
                + 'transition-colors';
            rm.textContent = '\u00d7';
            rm.title = 'Remove this light';
            rm.addEventListener('click', ev => {
                ev.stopPropagation();
                onElementRemove && onElementRemove(id, i);
            });
            live.buttons.push(rm);
            ch.append(nameEl, rm);
            card.appendChild(ch);

            if (anchors.length) {
                const poolFor = k => anchors.filter(o => o.kind === k);
                const ordinal = a => {
                    const pool = poolFor((a || '').split('-')[0]);
                    const at = pool.findIndex(o => o.id === a);
                    return at < 0 ? 0 : at;
                };
                const curKind0 = (entry.anchor || '').split('-')[0];
                // Floor means the floor-uplight hooks when the frame has
                // them, else the stand base plates.
                const floorKind = anchors.some(o => o.kind === 'uplight')
                    ? 'uplight' : 'base';
                // A strip on a frame with strip lines rides the rail or
                // the hem - its two mounts are the wall's own curve.
                const stripLine = entry.type === 'light-strip'
                    && anchors.some(o => o.kind === 'stripline');
                const kind = ['pole', 'rail', 'uplight', 'base'].includes(curKind0)
                    ? curKind0 : anchors[0].kind;

                const mount = document.createElement('div');
                mount.className = 'mt-1.5 flex items-center gap-1.5';
                const chipMount = (on, label, apply) => {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = chipCls(on);
                    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
                    btn.textContent = label;
                    btn.addEventListener('click', apply);
                    live.buttons.push(btn);
                    mount.appendChild(btn);
                    return btn;
                };
                if (stripLine) {
                    const side = sideOf(entry.anchor) || 'L';
                    for (const [suffix, label] of [['T', 'Top'], ['B', 'Bottom']]) {
                        const target = `stripline-${side}-${suffix}`;
                        const has = anchors.some(o => o.id === target);
                        const on = has && entry.anchor === target;
                        const btn = chipMount(on, label, () => {
                            if (on || !has) return;
                            onElementPatch && onElementPatch(id, i, { anchor: target });
                        });
                        btn.disabled = !has;
                        btn.dataset.off = has ? '0' : '1';
                    }
                } else {
                    for (const [k, label] of [['pole', 'Pole'], ['rail', 'Rail'],
                        [floorKind, 'Floor']]) {
                        const has = poolFor(k).length > 0;
                        const on = has && k === kind;
                        const btn = chipMount(on, label, () => {
                            if (on) return;
                            const pool = poolFor(k);
                            const at = Math.min(ordinal(entry.anchor), pool.length - 1);
                            onElementPatch && onElementPatch(id, i, { anchor: pool[at].id });
                        });
                        btn.disabled = !has;
                        btn.dataset.off = has ? '0' : '1';
                    }
                }
                if (!stripLine) {
                    const step = delta => {
                        const btn = document.createElement('button');
                        btn.type = 'button';
                        btn.textContent = delta > 0 ? '▶' : '◀';
                        btn.className = 'w-7 h-7 rounded-md border border-gray-300 '
                            + 'dark:border-zinc-600 text-[10px] leading-none text-gray-600 '
                            + 'dark:text-zinc-300 hover:bg-sky-50 dark:hover:bg-zinc-700';
                        const pool = poolFor(kind);
                        btn.disabled = pool.length < 2;
                        btn.dataset.off = pool.length < 2 ? '1' : '0';
                        btn.addEventListener('click', () => {
                            const at = Math.max(0, pool.findIndex(o => o.id === entry.anchor));
                            const nextAt = (at + delta + pool.length) % pool.length;
                            onElementPatch && onElementPatch(id, i, { anchor: pool[nextAt].id });
                        });
                        live.buttons.push(btn);
                        return btn;
                    };
                    const readout = document.createElement('span');
                    readout.className = 'flex-1 text-center text-[11px] text-gray-600 '
                        + 'dark:text-zinc-300 tabular-nums';
                    const hit = anchors.find(o => o.id === entry.anchor);
                    readout.textContent = hit ? hit.label : (entry.anchor || 'no mount');
                    mount.append(step(-1), readout, step(1));
                }
                card.appendChild(mount);
            } else {
                const note = document.createElement('p');
                note.className = 'text-[11px] text-gray-400 dark:text-zinc-500 mt-1';
                note.textContent = 'This frame has no mount points.';
                card.appendChild(note);
            }

            // Its own numbers: the light model's own schema, emitted against
            // THIS model alone - one fixture's focus never moves another's.
            // Hue and saturation never show as sliders: the colour square
            // below is the one colour control every fixture shares.
            if (lm && lm.params) {
                for (const [k, p] of Object.entries(lm.params)) {
                    if (p.type !== 'range' || k === 'hue' || k === 'sat') continue;
                    // A floor mount may only aim up: the slider tops out at
                    // -30 so the whole cone can never point at the ground.
                    // (Mirrors FLOOR_TILT_MAX in app.js.)
                    const pp = k === 'tilt' && /^(uplight|base)-/.test(entry.anchor || '')
                        ? { ...p, max: -30 } : p;
                    const built = rangeBlock(`light-${i}-${k}`, pp, lm.state[k]);
                    built.input.addEventListener('input', e => {
                        const v = parseFloat(e.target.value);
                        if (!Number.isFinite(v)) return;
                        built.value.textContent = fmt(v, p.unit);
                        emit({ [k]: v }, [lm]);
                    });
                    live.selects.push(built.input);
                    card.appendChild(built.wrap);
                }
                if (lm.params.hue && lm.params.sat) {
                    const pal = paletteBlock({
                        hue: Number.isFinite(lm.state.hue)
                            ? lm.state.hue : lm.params.hue.value,
                        sat: Number.isFinite(lm.state.sat)
                            ? lm.state.sat : lm.params.sat.value
                    }, (h, s) => emit({ hue: h, sat: s }, [lm]),
                    { id: `param-palette-${i}` });
                    card.appendChild(pal);
                }
            }
            parent.appendChild(card);
        });
        };

        // One card for the whole group: the union of every fixture's
        // numbers, one slider row per number, each change written to every
        // fixture in the group that understands it. Mount and remove stay
        // per-fixture, in Separate.
        const paintGroup = (parent, mode, typeFilter, prefix) => {
            const idxs = memberIdx(mode, typeFilter);
            const card = document.createElement('div');
            card.className = 'mt-2 px-2 py-2 rounded-md border border-dashed '
                + 'border-gray-300 dark:border-zinc-600';
            const wall = mode === 'all' ? 'Whole rig'
                : mode === 'left' ? 'Left wall' : 'Right wall';
            const ch = document.createElement('div');
            ch.className = 'flex items-center justify-between';
            const nameEl = document.createElement('span');
            nameEl.className = 'text-xs font-semibold text-gray-700 dark:text-zinc-200';
            nameEl.textContent = `${wall} - ${idxs.length} light${idxs.length === 1 ? '' : 's'}`;
            ch.appendChild(nameEl);
            card.appendChild(ch);

            const params = new Map();
            for (const i of idxs) {
                const lm = lmOf(i);
                if (!lm || !lm.params) continue;
                for (const [k, p] of Object.entries(lm.params)) {
                    // Hue and saturation are the colour square's job.
                    if (p.type !== 'range' || k === 'hue' || k === 'sat') continue;
                    if (!params.has(k)) params.set(k, p);
                }
            }
            const colourLms = idxs.map(lmOf)
                .filter(lm => lm && lm.params && lm.params.hue && lm.params.sat);
            if (!params.size) {
                const note = document.createElement('p');
                note.className = 'text-[11px] text-gray-400 dark:text-zinc-500 mt-1';
                note.textContent = !ofType(typeFilter).length
                    ? 'Add a light to the frame first.'
                    : idxs.length
                        ? 'These fixtures expose no numbers yet.'
                        : `No lights on the ${mode} wall yet.`;
                card.appendChild(note);
            }
            for (const [k, p] of params) {
                const holder = idxs.map(lmOf)
                    .find(lm => lm && lm.state && k in lm.state);
                // One floor-mounted member is enough to keep the group's
                // tilt slider inside the up-only range.
                const floorTilt = k === 'tilt' && idxs.some(i => /^(uplight|base)-/
                    .test((entries[i] || {}).anchor || ''));
                const pp = floorTilt ? { ...p, max: -30 } : p;
                const built = rangeBlock(`${prefix}-${mode}-${k}`, pp,
                    holder ? holder.state[k] : pp.value);
                built.input.addEventListener('input', e => {
                    const v = parseFloat(e.target.value);
                    if (!Number.isFinite(v)) return;
                    built.value.textContent = fmt(v, p.unit);
                    const targets = idxs.map(lmOf)
                        .filter(lm => lm && lm.params && lm.params[k]);
                    // One number for the whole rig, exactly mirrored: Pan
                    // is an aim relative to each wall, so the right wall
                    // receives the negation of the left's number and the
                    // entrance stays symmetric under one drag. Every other
                    // number is shared as-is. Without a wall on both sides
                    // there is nothing to mirror against.
                    if (mode === 'all' && k === 'pan') {
                        const lt = [], rt = [];
                        for (const i of idxs) {
                            const lm = lmOf(i);
                            if (!lm || !lm.params || !lm.params[k]) continue;
                            const side = sideOf((entries[i] || {}).anchor);
                            (side === 'R' ? rt : lt).push(lm);
                        }
                        if (lt.length && rt.length) {
                            emit({ [k]: v }, lt);
                            emit({ [k]: -v }, rt);
                            return;
                        }
                    }
                    emit({ [k]: v }, targets);
                });
                live.selects.push(built.input);
                card.appendChild(built.wrap);
            }
            // One colour square for the whole group: every member of the
            // wall (or the rig) answers the same drag at once.
            if (colourLms.length) {
                const holder = colourLms
                    .find(lm => lm.state && Number.isFinite(lm.state.hue));
                const pal = paletteBlock({
                    hue: holder ? holder.state.hue : 40,
                    sat: holder ? holder.state.sat : 35
                }, (h, s) => emit({ hue: h, sat: s }, colourLms),
                { id: `param-palette-${prefix}-${mode}` });
                card.appendChild(pal);
            }
            parent.appendChild(card);
        };

        const paintInto = (parent, mode, typeFilter, prefix) => {
            parent.textContent = '';
            if (mode === 'separate') paintSeparate(parent, typeFilter);
            else paintGroup(parent, mode, typeFilter, prefix);
        };

        const parBody = document.createElement('div');
        parSec.appendChild(parBody);
        parSec.appendChild(modeRowFor(() => lightsMode, v => { lightsMode = v; },
            () => paintInto(parBody, lightsMode, 'light-par', 'lightgrp')));
        paintInto(parBody, lightsMode, 'light-par', 'lightgrp');

        if (ofType('light-led').length) {
            const ledSec = sectionOf('LED');
            const ledBody = document.createElement('div');
            ledSec.appendChild(ledBody);
            ledSec.appendChild(modeRowFor(() => ledMode, v => { ledMode = v; },
                () => paintInto(ledBody, ledMode, 'light-led', 'ledgrp')));
            paintInto(ledBody, ledMode, 'light-led', 'ledgrp');
        }

        // The strip group: an RGB mood line along the curtain's own rail
        // or hem. It only appears once a strip lives on the frame. Side
        // picks which walls the numbers reach; the palette is the main
        // control - drag it live and every filtered tube answers at once.
        // Power and a per-fixture list (mount, remove) finish the card;
        // straight-mounted strips on other frames keep a length slider of
        // their own.
        const strips = ofType('light-strip');
        if (strips.length) {
            const stripSec = sectionOf('Strip');
            const stripMatch = e => stripSide === 'both'
                || sideOf(e && e.anchor) === (stripSide === 'left' ? 'L' : 'R');
            const stripLms = () => strips.filter(x => stripMatch(x.e))
                .map(x => lmOf(x.i)).filter(Boolean);
            const straightLms = () => strips
                .filter(x => stripMatch(x.e)
                    && !String(x.e.anchor || '').startsWith('stripline-'))
                .map(x => lmOf(x.i)).filter(Boolean);

            const sideRow = document.createElement('div');
            sideRow.className = 'mt-1 flex items-center gap-2';
            const sideBtns = new Map();
            for (const [val, label] of [['left', 'Left'], ['right', 'Right'],
                ['both', 'Both']]) {
                const btn = document.createElement('button');
                btn.type = 'button';
                const on = val === stripSide;
                btn.className = chipCls(on);
                btn.setAttribute('aria-pressed', on ? 'true' : 'false');
                btn.textContent = label;
                btn.title = 'Which walls this group\'s numbers reach';
                btn.addEventListener('click', () => {
                    if (stripSide === val) return;
                    stripSide = val;
                    for (const [v, b] of sideBtns) {
                        const act = v === stripSide;
                        b.className = chipCls(act);
                        b.setAttribute('aria-pressed', act ? 'true' : 'false');
                    }
                    repaintStrip();
                });
                live.buttons.push(btn);
                sideBtns.set(val, btn);
                sideRow.appendChild(btn);
            }
            stripSec.appendChild(sideRow);

            // The shared colour square: hue across, saturation up from
            // white, dragging live to every filtered strip.
            const initEntry = (strips.find(x => lmOf(x.i) && lmOf(x.i).state
                && Number.isFinite(lmOf(x.i).state.hue)) || strips[0] || {}).e || {};
            const initLm = strips.map(x => lmOf(x.i))
                .find(lm => lm && lm.state && Number.isFinite(lm.state.hue));
            const pal = paletteBlock({
                hue: initLm ? initLm.state.hue
                    : Number.isFinite(initEntry.params && initEntry.params.hue)
                        ? initEntry.params.hue : 40,
                sat: initLm ? initLm.state.sat
                    : Number.isFinite(initEntry.params && initEntry.params.sat)
                        ? initEntry.params.sat : 25
            }, (h, s) => {
                const targets = stripLms().filter(lm => lm.params && lm.params.hue);
                if (targets.length) emit({ hue: h, sat: s }, targets);
            }, { id: 'param-strippalette' });
            stripSec.appendChild(pal);

            const power0 = stripLms().find(lm => lm.state && 'power' in lm.state);
            if (power0) {
                const pow = rangeBlock('strippower', power0.params.power,
                    power0.state.power);
                pow.input.addEventListener('input', e => {
                    const v = parseFloat(e.target.value);
                    if (!Number.isFinite(v)) return;
                    pow.value.textContent = fmt(v, power0.params.power.unit);
                    const targets = stripLms()
                        .filter(lm => lm.params && lm.params.power);
                    if (targets.length) emit({ power: v }, targets);
                });
                live.selects.push(pow.input);
                stripSec.appendChild(pow.wrap);
            }
            const straight0 = straightLms().find(lm => lm.state && 'length' in lm.state);
            if (straight0) {
                const len = rangeBlock('striplength', straight0.params.length,
                    straight0.state.length);
                len.input.addEventListener('input', e => {
                    const v = parseFloat(e.target.value);
                    if (!Number.isFinite(v)) return;
                    len.value.textContent = fmt(v, straight0.params.length.unit);
                    const targets = straightLms()
                        .filter(lm => lm.params && lm.params.length);
                    if (targets.length) emit({ length: v }, targets);
                });
                live.selects.push(len.input);
                stripSec.appendChild(len.wrap);
            }

            // One settings block for the whole filter - never a card per
            // tube. On a curtained frame the block carries the wall's own
            // mount chips and a small remove per strip; straight strips
            // (rail/pole mounts on other frames) keep their fixture cards,
            // because that is where their mounting lives.
            const railLines = anchors.some(o => o.kind === 'stripline');
            const stripLower = document.createElement('div');
            stripSec.appendChild(stripLower);
            const repaintStrip = () => {
                stripLower.textContent = '';
                if (!strips.length) return;
                if (!railLines) {
                    paintSeparate(stripLower, 'light-strip');
                    return;
                }
                const lines = () => strips.filter(x => stripMatch(x.e)
                    && String(x.e.anchor || '').startsWith('stripline-'));

                // Top / Bottom: every strip inside the filter moves to that
                // wall's rail or hem - one tap dresses the whole side (or
                // both sides at once under Both).
                const mountRow = document.createElement('div');
                mountRow.className = 'mt-1 flex items-center gap-1.5';
                const mountLab = document.createElement('span');
                mountLab.className = 'text-[11px] font-semibold uppercase '
                    + 'tracking-wider text-gray-500 dark:text-zinc-400 mr-1';
                mountLab.textContent = 'Mount';
                mountRow.appendChild(mountLab);
                for (const [suffix, label] of [['T', 'Top'], ['B', 'Bottom']]) {
                    const pool = lines();
                    const on = pool.length > 0 && pool
                        .every(x => String(x.e.anchor).endsWith(`-${suffix}`));
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = chipCls(on);
                    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
                    btn.textContent = label;
                    btn.title = 'Seat the filtered strips on the rail (Top) '
                        + 'or the hem (Bottom)';
                    btn.disabled = pool.length === 0;
                    btn.dataset.off = pool.length === 0 ? '1' : '0';
                    btn.addEventListener('click', () => {
                        if (on) return;
                        for (const x of pool) {
                            const side = sideOf(x.e.anchor) || 'L';
                            onElementPatch
                                && onElementPatch(id, x.i,
                                    { anchor: `stripline-${side}-${suffix}` });
                        }
                    });
                    live.buttons.push(btn);
                    mountRow.appendChild(btn);
                }
                stripLower.appendChild(mountRow);

                // One small remove per strip in the filter - the only
                // per-fixture control left once the cards are gone.
                const rmRow = document.createElement('div');
                rmRow.className = 'mt-2 flex items-center gap-1.5 flex-wrap';
                const rmLab = document.createElement('span');
                rmLab.className = 'text-[11px] font-semibold uppercase '
                    + 'tracking-wider text-gray-500 dark:text-zinc-400 mr-1';
                rmLab.textContent = 'Fixtures';
                rmRow.appendChild(rmLab);
                for (const x of strips.filter(y => stripMatch(y.e))) {
                    const side = sideOf(x.e.anchor) || '?';
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'w-7 h-7 rounded-md border border-gray-300 '
                        + 'dark:border-zinc-600 text-xs leading-none text-gray-500 '
                        + 'dark:text-zinc-400 hover:border-red-400 '
                        + 'hover:text-red-500 transition-colors';
                    btn.textContent = '\u00d7';
                    btn.title = `Remove the ${side === 'L' ? 'left' : side === 'R' ? 'right' : side} strip`;
                    btn.addEventListener('click', ev => {
                        ev.stopPropagation();
                        onElementRemove && onElementRemove(id, x.i);
                    });
                    live.buttons.push(btn);
                    rmRow.appendChild(btn);
                }
                stripLower.appendChild(rmRow);
            };
            repaintStrip();
        }
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

        // The same colour square the lights use: hue across, saturation
        // up, the swatch's brightness kept. Live - the curtain wears the
        // colour while the finger travels.
        const initHsv = hexToHsv(eff);
        let keepV = initHsv.v;
        const hexLabel = document.createElement('span');
        hexLabel.className = 'block text-[11px] font-mono text-gray-500 '
            + 'dark:text-zinc-400 mt-1';
        hexLabel.textContent = hexText(eff) + ' custom';
        const pal = paletteBlock(
            { hue: Math.round(initHsv.h), sat: Math.round(initHsv.s) },
            (h, s) => {
                const hex = hsvToHex(h, s, keepV);
                hexLabel.textContent = hexText(hex) + ' custom';
                onRgbChange && onRgbChange(hex);
            },
            { id: 'param-fabricpalette', v: Math.round(initHsv.v), label: 'Custom' });
        rgb.append(pal, hexLabel);

        // applyLive drives the square without firing onRgbChange.
        rgbDialRef = {
            set(hex) {
                const q = hexToHsv(hex);
                keepV = q.v;
                pal._set(Math.round(q.h), Math.round(q.s));
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

    // Structural signature only: value-level fields (set, scene, colour,
    // recipe, places, shape) travel through applyLive and never force a
    // rebuild - a SET tap must not re-render the whole panel under the
    // finger.
    function signature() {
        // Count and place are structural (they change what the shelf
        // shows); the offset sliders are value-level and must never
        // force a rebuild mid-drag.
        const pillarShape = Object.fromEntries(
            Object.entries(currentFramePillars).map(([k, c]) => [k,
                { count: c.count, place: c.place }]));
        // A light's type and hook are structural (the card must repaint);
        // its numbers are value-level like every other slider.
        const elemShape = Object.fromEntries(
            Object.entries(currentFrameElements).map(([k, list]) => [k,
                (list || []).map(el => `${el.type}@${el.anchor || ''}`)]));
        return [
            currentMode,
            currentGroups.map(g => g.id).join(','),
            activeId_ || '',
            JSON.stringify(pillarShape),
            JSON.stringify(elemShape),
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
        pillarOffsetRows.clear();
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
                    : activeTool === 'lights'
                        ? 'No frames on stage - nothing to hang lights on.'
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
            if (next.framePillars !== undefined) {
                currentFramePillars = next.framePillars;
            }
            if (next.frameElements !== undefined) {
                currentFrameElements = next.frameElements;
            }
            if (next.frameAnchors !== undefined) {
                currentFrameAnchors = next.frameAnchors;
            }
            if (next.frameSpacing !== undefined) {
                currentFrameSpacing = next.frameSpacing;
            }
            if (next.places !== undefined) currentPlaces = next.places;
            if (next.model !== undefined) current = next.model;
            if (next.colorways !== undefined) currentColorways = next.colorways;
            if (Array.isArray(next.folds)) {
                folded.clear();
                for (const k of next.folds) folded.add(k);
            }
            renderIfChanged(force);
            return this;
        },

        // Value-level repaint: the SET select, Look chips, scene select,
        // colour chips, RGB dial, the four shape sliders and the position
        // numbers all move in place. A SET tap must feel like a state
        // change, not a reload - so nothing here rebuilds the DOM.
        applyLive(next = {}) {
            if (next.framePillars !== undefined) {
                currentFramePillars = next.framePillars;
                // Nudge the gap and offset sliders in place - a drag must
                // never rebuild the shelf under the finger.
                for (const [pid, slot] of pillarOffsetRows) {
                    const c = currentFramePillars[pid];
                    const off = (c && c.offset) || {};
                    for (const [prop, refs] of Object.entries(slot)) {
                        const v = prop === 'gap'
                            ? (Number(c && c.gap) || 3)
                            : (Number(off[prop]) || 0);
                        refs.input.value = String(Math.round(v * 100) / 100);
                        refs.value.textContent = fmt(v,
                            prop === 'ry' ? '\u00b0' : ' ft');
                    }
                }
            }
            // Lights: value-level only - the card repaints through refresh()
            // when a type or hook changes; numbers move their own inputs.
            if (next.frameElements !== undefined) {
                currentFrameElements = next.frameElements;
            }
            if (next.frameAnchors !== undefined) {
                currentFrameAnchors = next.frameAnchors;
            }
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
                        if (k === 'lobeGaps') {
                            // Sync each per-lobe gap slider in place.
                            const meta = schema && schema.params
                                ? schema.params.lobeGaps : null;
                            if (!meta || !Array.isArray(v)) continue;
                            const count = meta.count || 11;
                            const lobesNow = Math.round(
                                schema.state && schema.state.lobes) || 6;
                            for (let i = 0; i < count; i++) {
                                const row = sec.rows && sec.rows[`lobeGap${i}`];
                                if (!row) continue;
                                const val = Number.isFinite(v[i]) ? v[i] : meta.value;
                                row.input.value = String(val);
                                if (row.value) {
                                    row.value.textContent = lobeGapText(val, lobesNow, meta);
                                }
                            }
                            continue;
                        }
                        const row = sec.rows && sec.rows[k];
                        const meta = schema && schema.params ? schema.params[k] : null;
                        if (!row || !meta) continue;
                        row.input.value = String(v);
                        if (row.value) row.value.textContent = fmt(v, meta.unit);
                        // Keep lobe-gap visibility in sync when lobes arrives
                        // from outside (SET switch, project load), and refresh
                        // the lean degrees, which depend on the lobe count.
                        if (k === 'lobes') {
                            const n = Math.round(v) || 6;
                            const gMeta = schema && schema.params
                                ? schema.params.lobeGaps : null;
                            const gCount = (gMeta && gMeta.count) || 11;
                            const gapsNow = schema && Array.isArray(schema.state.lobeGaps)
                                ? schema.state.lobeGaps : [];
                            for (let i = 0; i < gCount; i++) {
                                const gRow = sec.rows && sec.rows[`lobeGap${i}`];
                                if (!gRow) continue;
                                gRow.wrap.style.display = i < n ? '' : 'none';
                                if (gMeta && gRow.value) {
                                    const gv = Number.isFinite(gapsNow[i])
                                        ? gapsNow[i] : gMeta.value;
                                    gRow.value.textContent = lobeGapText(gv, n, gMeta);
                                }
                            }
                        }
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
                    if (k.startsWith('lobeGap')) {
                        const i = Number(k.slice(8));
                        const gaps = owner.state.lobeGaps;
                        const meta = owner.params.lobeGaps;
                        if (meta && Array.isArray(gaps)) {
                            const v = Number.isFinite(gaps[i]) ? gaps[i] : meta.value;
                            r.input.value = String(v);
                            if (r.value) {
                                const lobesNow = Math.round(owner.state.lobes) || 6;
                                r.value.textContent = lobeGapText(v, lobesNow, meta);
                            }
                        }
                        continue;
                    }
                    const v = owner.state[k];
                    if (r.value) r.value.textContent = fmt(v, owner.params[k].unit);
                    if (r.input.type === 'checkbox') r.input.checked = !!v;
                    else r.input.value = v;
                }
            }
        }
    };
}
