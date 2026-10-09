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
        pillars = false,
        onSelect, onToggle, onModeChange, onParamsChange, onThemeChange,
        onSceneChange, onSetChange, onPillarsChange, onReset, themeIsDark = false
    } = opts;

    const titleEl = document.getElementById('model-name');
    const subEl = document.getElementById('model-sub');

    let currentMode = mode;
    let currentGroups = groups;
    let current = model;
    let activeId_ = activeId;
    let currentScene = scene;
    let currentSet = set;
    let currentPillars = pillars;

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

    function applyBusy() {
        for (const el of live.selects) el.disabled = busy;
        for (const el of live.checks) el.disabled = busy;
        for (const el of live.buttons) el.disabled = busy;
    }

    // One collapsible block of parameters for one preset. `targets` is the
    // preset's models, so a preset holding several objects is edited at once.
    function section(group, collapsible, open) {
        const key = group.id || 'active';
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
            summary.textContent = schema ? schema.name : group.id;
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
                if (p.advanced) {
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

        const sec = { key, targets, rows, root };
        sections.push(sec);
        return root;
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
            const count = hit ? hit.placements.filter(p => p.kind === 'pillar').length : 0;
            if (count) {
                // Pillars belong to the drawing, not to the selection: they
                // are offered here, never mounted on their own.
                const lab = document.createElement('label');
                lab.className = 'mt-2 flex items-center gap-2 text-sm cursor-pointer '
                    + 'hover:text-sky-600 transition-colors';
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.id = 'param-pillars';
                cb.className = CHECK_CLS;
                cb.checked = !!currentPillars;
                cb.addEventListener('change', e => {
                    onPillarsChange && onPillarsChange(e.target.checked);
                });
                const span = document.createElement('span');
                span.className = 'font-medium';
                span.textContent = `Pillars (${count})`;
                lab.append(cb, span);
                wrap.appendChild(lab);
                live.checks.push(cb);
            }
            const note = document.createElement('p');
            note.className = 'mt-1 text-[11px] text-gray-500 dark:text-zinc-400';
            note.textContent = hit
                ? `${hit.subtitle} - one frame on stage, pillars at its centre or outer edge.`
                : '';
            wrap.appendChild(note);
        }
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
            currentPillars ? 'p' : '',
            (current && current.name) || ''
        ].join('|');
    }

    function render() {
        host.textContent = '';
        sections = [];
        live = { selects: [], checks: [], buttons: [] };

        const overlay = currentMode === 'overlay';
        // A SET shows every group it mounted - frames and pillars - not just
        // the one a single-model view would have picked.
        const staged = !!currentSet;
        if (overlay || catalog.length > 1) host.appendChild(modeBlock());

        if (overlay) {
            if (catalog.length > 1) host.appendChild(pickerBlock());
            currentGroups.forEach((g, i) => host.appendChild(section(g, true, i === 0)));
        } else {
            if (catalog.length > 1) host.appendChild(selectBlock());
            const shown = staged ? currentGroups : currentGroups.slice(0, 1);
            const collapsible = staged && shown.length > 1;
            shown.forEach((g, i) => host.appendChild(section(g, collapsible, i === 0)));
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

        if (sets.length > 1) host.appendChild(setBlock());
        if (scenes.length > 1) host.appendChild(sceneBlock());
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
            if (next.pillars !== undefined) currentPillars = next.pillars;
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
