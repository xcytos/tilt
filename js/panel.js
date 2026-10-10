import { PILLAR_ID } from './objects/pillar.js';

const LABEL_CLS = 'font-semibold text-gray-600 dark:text-zinc-300';
const VALUE_CLS = 'text-sky-600 dark:text-sky-400 font-mono';
const CHECK_CLS = 'custom-checkbox';
const FIELD_CLS = 'w-full text-sm px-2 py-1.5 rounded-md border border-gray-300 '
    + 'dark:border-zinc-600 bg-white/70 dark:bg-zinc-800/70 '
    + 'text-gray-800 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-sky-400';
const HEADING_CLS = 'text-xs font-semibold text-gray-600 dark:text-zinc-300 mb-1';

const fmt = (value, unit) =>
    (typeof value === 'number' ? parseFloat(value.toFixed(2)) : value) + (unit || '');

function blockShell(key, label) {
    const wrap = document.createElement('div');
    wrap.className = 'mb-3';
    const head = document.createElement('div');
    head.className = 'flex justify-between text-xs mb-1';
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

function rangeBlock(key, p, current) {
    const { wrap, value } = blockShell(key, p.label);
    const input = document.createElement('input');
    input.type = 'range';
    input.id = `param-${key}`;
    input.min = p.min;
    input.max = p.max;
    input.step = p.step;
    input.value = current;
    value.textContent = fmt(current, p.unit);
    wrap.appendChild(input);
    return { wrap, input, value };
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

function themeBlock(isDark, onChange) {
    const wrap = document.createElement('label');
    wrap.className = 'flex items-center gap-2 text-sm cursor-pointer hover:text-sky-600 transition-colors';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = 'toggle-theme';
    input.className = CHECK_CLS;
    input.checked = isDark;
    input.addEventListener('change', e => onChange(e.target.checked));
    const span = document.createElement('span');
    span.className = 'font-medium tracking-wide';
    span.textContent = 'Dark Mode';
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
        colorways = [], colorway = '',
        recipes = [], recipe = '',
        onSelect, onToggle, onModeChange, onParamsChange, onThemeChange,
        onSceneChange, onColorwayChange, onRecipeChange, onSetChange,
        onFramePillarsChange, onPlaceChange, onReset, themeIsDark = false
    } = opts;

    const titleEl = document.getElementById('model-name');
    const subEl = document.getElementById('model-sub');

    let currentMode = mode;
    let currentGroups = groups;
    let current = model;
    let activeId_ = activeId;
    let currentScene = scene;
    let currentSet = set;
    let currentFramePillars = framePillars;
    let currentPlaces = places;
    let currentColorway = colorway;
    let currentRecipe = recipe;

    let sections = [];
    let live = { selects: [], checks: [], buttons: [] };
    let busy = false;
    let themeInput = null;
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
    function section(group, collapsible, open) {
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

        const isPillar = group.id === PILLAR_ID;
        const rows = {};
        const normalToggles = [];
        const advancedRanges = [];
        const advancedToggles = [];
        const gearRanges = [];
        const gearToggles = [];

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
                // A pillar's look lives behind one settings icon; everything
                // else is laid out plainly. The pillar is configured through
                // its frame's section - count and place - never by numbers.
                if (isPillar) {
                    (p.type === 'range' ? gearRanges : gearToggles).push([k, p]);
                } else if (p.advanced) {
                    (p.type === 'range' ? advancedRanges : advancedToggles)
                        .push([k, p]);
                } else if (p.type === 'range') {
                    inner.appendChild(addRange(k, p));
                } else if (p.type === 'toggle') {
                    normalToggles.push([k, p]);
                }
            }
        }

        if (normalToggles.length) {
            const row = document.createElement('div');
            row.className = 'flex flex-wrap gap-4 pt-1';
            for (const [k, p] of normalToggles) row.appendChild(addToggle(k, p));
            inner.appendChild(row);
        }

        if (gearRanges.length || gearToggles.length) {
            const details = document.createElement('details');
            details.className = 'mt-2 rounded-md border border-dashed '
                + 'border-gray-300 dark:border-zinc-600';
            const summary = document.createElement('summary');
            summary.className = 'cursor-pointer select-none px-2 py-1.5 text-[11px] '
                + 'font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-400';
            summary.append(gearIcon(), document.createTextNode('Pillar settings'));
            const gearBody = document.createElement('div');
            gearBody.className = 'px-2 pb-2';
            for (const [k, p] of gearRanges) gearBody.appendChild(addRange(k, p));
            if (gearToggles.length) {
                const row = document.createElement('div');
                row.className = 'flex flex-wrap gap-4 pt-1';
                for (const [k, p] of gearToggles) row.appendChild(addToggle(k, p));
                gearBody.appendChild(row);
            }
            details.append(summary, gearBody);
            inner.appendChild(details);
        }

        // Everything the panel shows must come from the schema; "advanced" is
        // just a flag on a param, not a separate hardcoded list.
        if (advancedRanges.length || advancedToggles.length) {
            const details = document.createElement('details');
            details.className = 'mt-2 rounded-md border border-dashed '
                + 'border-gray-300 dark:border-zinc-600';
            const summary = document.createElement('summary');
            summary.className = 'cursor-pointer select-none px-2 py-1.5 text-[11px] '
                + 'font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-400';
            summary.textContent = 'Advanced';
            const bodyEl = document.createElement('div');
            bodyEl.className = 'px-2 pb-2';
            for (const [k, p] of advancedRanges) bodyEl.appendChild(addRange(k, p));
            if (advancedToggles.length) {
                const row = document.createElement('div');
                row.className = 'flex flex-wrap gap-4 pt-1';
                for (const [k, p] of advancedToggles) row.appendChild(addToggle(k, p));
                bodyEl.appendChild(row);
            }
            details.append(summary, bodyEl);
            inner.appendChild(details);
        }

        // Position: where THIS frame instance stands - numbers, not
        // dragging. Pillars never appear here: they follow their frame.
        if (!isPillar) {
            const place = (currentPlaces[key] || [])[idx];
            if (place) inner.appendChild(positionBlock(key, idx, place));
            inner.appendChild(framePillarsBlock(key));
        }

        const sec = { key, targets, rows, root };
        sections.push(sec);
        return root;
    }

    // One frame instance's coordinates: numbers, not dragging.
    function positionBlock(key, idx, place) {
        const wrap = document.createElement('div');
        wrap.className = 'mt-3 pt-2 border-t border-dashed '
            + 'border-gray-300 dark:border-zinc-600';

        const title = document.createElement('div');
        title.className = 'text-[11px] font-semibold uppercase tracking-wider '
            + 'text-gray-500 dark:text-zinc-400 mb-1';
        title.textContent = 'Position';
        wrap.appendChild(title);

        const row = document.createElement('div');
        row.className = 'grid grid-cols-3 gap-2';
        for (const [label, prop, step] of [
            ['X', 'x', 0.5], ['Depth', 'z', 0.5], ['Turn', 'ry', 1]
        ]) {
            const cell = document.createElement('label');
            cell.className = 'block text-[11px] text-gray-500 dark:text-zinc-400';
            cell.textContent = label;
            const input = document.createElement('input');
            input.type = 'number';
            input.step = String(step);
            input.value = String(Math.round(place[prop] * 100) / 100);
            input.className = 'w-full mt-0.5 text-sm px-1.5 py-1 rounded-md border '
                + 'border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 '
                + 'text-gray-800 dark:text-zinc-100 tabular-nums';
            input.addEventListener('change', e => {
                const v = parseFloat(e.target.value);
                if (!Number.isFinite(v)) {
                    e.target.value = String(Math.round(place[prop] * 100) / 100);
                    return;
                }
                onPlaceChange && onPlaceChange(key, idx, { [prop]: v });
            });
            cell.appendChild(input);
            row.appendChild(cell);
            live.selects.push(input);
        }
        wrap.appendChild(row);
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

    // This frame's own pillars: how many stand beside it (0-2, per instance)
    // and where the pair anchors - the centre of its O2, the outer ends of
    // its modules, or the complete inner ends beside the gap.
    function framePillarsBlock(id) {
        const cfg = currentFramePillars[id] || { count: 0, place: 'outer' };
        const wrap = document.createElement('div');
        wrap.className = 'mt-3 pt-2 border-t border-dashed '
            + 'border-gray-300 dark:border-zinc-600';

        const title = document.createElement('div');
        title.className = 'text-[11px] font-semibold uppercase tracking-wider '
            + 'text-gray-500 dark:text-zinc-400 mb-1';
        title.textContent = 'Pillars';
        wrap.appendChild(title);

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
        wrap.appendChild(row);

        if (cfg.count > 0) {
            const placeSel = document.createElement('select');
            placeSel.id = 'param-pillars-place';
            placeSel.className = FIELD_CLS;
            placeSel.setAttribute('aria-label', 'Pillar place');
            const options = cfg.count === 1
                ? [['centre', 'Centre of the O2']]
                : [['outer', 'Outer ends of each module'],
                   ['inner', 'Inner ends (beside the gap)']];
            for (const [val, text] of options) {
                const opt = document.createElement('option');
                opt.value = val;
                opt.textContent = text;
                placeSel.appendChild(opt);
            }
            placeSel.value = options.some(o => o[0] === cfg.place)
                ? cfg.place : options[0][0];
            placeSel.addEventListener('change', e => {
                onFramePillarsChange && onFramePillarsChange(id, { place: e.target.value });
            });
            placeSel.style.marginTop = '0.5rem';
            live.selects.push(placeSel);
            wrap.appendChild(placeSel);
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
        const shell = blockShell('model', 'Model');
        shell.value.remove();
        const select = document.createElement('select');
        select.id = 'param-model';
        select.className = FIELD_CLS;
        for (const entry of catalog) {
            const opt = document.createElement('option');
            opt.value = entry.id;
            opt.textContent = entry.name;
            select.appendChild(opt);
        }
        select.value = activeId_ || (catalog[0] && catalog[0].id);
        select.addEventListener('change', e => onSelect && onSelect(e.target.value));
        shell.wrap.appendChild(select);
        live.selects.push(select);
        return shell.wrap;
    }

    // The arrangement the frames and pillars are dropped into. "None" hands
    // placement back to the display mode, which spaces presets side by side.
    function setBlock() {
        const wrap = document.createElement('div');
        wrap.className = 'mb-3';
        wrap.appendChild(heading('Set'));
        const select = document.createElement('select');
        select.id = 'param-set';
        select.className = FIELD_CLS;
        const none = document.createElement('option');
        none.value = '';
        none.textContent = 'None (free placement)';
        select.appendChild(none);
        for (const s of sets) {
            const opt = document.createElement('option');
            opt.value = s.id;
            opt.textContent = s.name;
            select.appendChild(opt);
        }
        select.value = currentSet || '';
        select.addEventListener('change', e => onSetChange && onSetChange(e.target.value));
        live.selects.push(select);
        wrap.appendChild(select);
        if (currentSet) {
            const hit = sets.find(s => s.id === currentSet);
            const note = document.createElement('p');
            note.className = 'mt-1 text-[11px] text-gray-500 dark:text-zinc-400';
            note.textContent = hit
                ? `${hit.subtitle} - a starting point; every position below is yours to change.`
                : '';
            wrap.appendChild(note);
        }
        return wrap;
    }


    // Looks: a whole project in one tap - SET, room and fabric palette
    // together. The chip matching the current three fields lights up; the
    // parts stay editable underneath.
    function recipesBlock() {
        const wrap = document.createElement('div');
        wrap.className = 'mb-3';
        wrap.appendChild(heading('Looks'));
        const row = document.createElement('div');
        row.className = 'flex flex-wrap gap-2';
        for (const r of recipes) {
            const btn = document.createElement('button');
            btn.type = 'button';
            const on = r.id === currentRecipe;
            btn.className = 'px-2 py-1.5 rounded-lg border text-xs transition-colors '
                + (on
                    ? 'border-sky-500 ring-1 ring-sky-400 font-semibold'
                    : 'border-gray-300 dark:border-zinc-600 hover:border-sky-400');
            btn.setAttribute('aria-pressed', on ? 'true' : 'false');
            btn.textContent = r.name;
            btn.addEventListener('click', () => {
                onRecipeChange && onRecipeChange(r.id);
            });
            live.buttons.push(btn);
            row.appendChild(btn);
        }
        wrap.appendChild(row);
        return wrap;
    }

    // Fabric palettes from the boards: one tap recolours every curtain on
    // stage. The pillar's stone stays stone in every palette.
    function colorwayBlock() {
        const wrap = document.createElement('div');
        wrap.className = 'mb-3';
        wrap.appendChild(heading('Colorway'));
        const row = document.createElement('div');
        row.className = 'flex flex-wrap gap-2';
        for (const c of colorways) {
            const btn = document.createElement('button');
            btn.type = 'button';
            const on = c.id === currentColorway;
            btn.className = 'flex items-center gap-2 px-2 py-1.5 rounded-lg border text-xs '
                + 'transition-colors ' + (on
                    ? 'border-sky-500 ring-1 ring-sky-400 font-semibold'
                    : 'border-gray-300 dark:border-zinc-600 hover:border-sky-400');
            btn.setAttribute('aria-pressed', on ? 'true' : 'false');
            const chip = document.createElement('span');
            chip.className = 'w-4 h-4 rounded-full border border-black/10 shrink-0';
            chip.style.background = '#' + c.fabric.toString(16).padStart(6, '0');
            const label = document.createElement('span');
            label.textContent = c.name;
            btn.append(chip, label);
            btn.addEventListener('click', () => {
                onColorwayChange && onColorwayChange(c.id);
            });
            live.buttons.push(btn);
            row.appendChild(btn);
        }
        wrap.appendChild(row);
        return wrap;
    }

    // The room the set stands in. Kept next to the display controls rather
    // than in the model sections: a scene belongs to the project, not to a
    // preset.
    function sceneBlock() {
        const wrap = document.createElement('div');
        wrap.className = 'mb-3';
        wrap.appendChild(heading('Scene'));
        const select = document.createElement('select');
        select.id = 'param-scene';
        select.className = FIELD_CLS;
        for (const s of scenes) {
            const opt = document.createElement('option');
            opt.value = s.id;
            opt.textContent = s.name;
            select.appendChild(opt);
        }
        select.value = currentScene || (scenes[0] && scenes[0].id) || '';
        select.addEventListener('change', e => onSceneChange && onSceneChange(e.target.value));
        live.selects.push(select);
        wrap.appendChild(select);
        return wrap;
    }

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

    function themeFooter() {
        const footer = document.createElement('div');
        footer.className = 'flex items-center gap-4 pt-3 mt-1 border-t '
            + 'border-gray-200 dark:border-zinc-700';
        const theme = themeBlock(liveTheme, isDark => onThemeChange && onThemeChange(isDark));
        themeInput = theme.input;
        footer.appendChild(theme.wrap);

        if (onReset) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = 'Reset project';
            btn.title = 'Forget every saved setting and start from the defaults';
            btn.className = 'ml-auto text-[11px] px-2 py-1 rounded border '
                + 'border-gray-300 dark:border-zinc-600 text-gray-500 dark:text-zinc-400 '
                + 'hover:text-red-600 hover:border-red-400 transition-colors';
            btn.addEventListener('click', () => onReset());
            live.buttons.push(btn);
            footer.appendChild(btn);
        }
        return footer;
    }

    function signature() {
        return [
            currentMode,
            currentGroups.map(g => g.id).join(','),
            activeId_ || '',
            currentScene || '',
            currentSet || '',
            currentColorway || '',
            currentRecipe || '',
            JSON.stringify(currentFramePillars),
            JSON.stringify(currentPlaces),
            (current && current.name) || ''
        ].join('|');
    }

    function render() {
        host.textContent = '';
        sections = [];
        live = { selects: [], checks: [], buttons: [] };

        const overlay = currentMode === 'overlay';
        if (overlay || catalog.length > 1) host.appendChild(modeBlock());
        if (overlay) {
            if (catalog.length > 1) host.appendChild(pickerBlock());
        } else if (catalog.length > 1) {
            host.appendChild(selectBlock());
        }
        // Every group on stage gets a section - the frame (with its own
        // pillar options), then each pillar with its look behind a gear.
        currentGroups.forEach((g, i) => host.appendChild(
            section(g, currentGroups.length > 1, i === 0)));

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

        if (recipes.length > 1) host.appendChild(recipesBlock());
        if (sets.length > 1) host.appendChild(setBlock());
        if (scenes.length > 1) host.appendChild(sceneBlock());
        if (colorways.length > 1) host.appendChild(colorwayBlock());
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
            if (next.recipe !== undefined) currentRecipe = next.recipe;
            if (next.framePillars !== undefined) currentFramePillars = next.framePillars;
            if (next.places !== undefined) currentPlaces = next.places;
            if (next.model !== undefined) current = next.model;
            renderIfChanged(force);
            return this;
        },

        setBusy(value) { busy = !!value; applyBusy(); },
        setError(text) {
            msg.textContent = text || '';
            msg.classList.toggle('hidden', !text);
        },
        setTheme(isDark) {
            liveTheme = isDark;
            if (themeInput) themeInput.checked = isDark;
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
