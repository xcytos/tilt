const LABEL_CLS = 'font-semibold text-gray-600 dark:text-zinc-300';
const VALUE_CLS = 'text-sky-600 dark:text-sky-400 font-mono';
const CHECK_CLS = 'custom-checkbox';
const FIELD_CLS = 'w-full text-sm px-2 py-1.5 rounded-md border border-gray-300 '
    + 'dark:border-zinc-600 bg-white/70 dark:bg-zinc-800/70 '
    + 'text-gray-800 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-sky-400';

const fmt = (value, unit) =>
    (typeof value === 'number' ? parseFloat(value.toFixed(2)) : value) + (unit || '');

function blockShell(key, label) {
    const wrap = document.createElement('div');
    wrap.className = 'mb-4';
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
    wrap.className = 'flex items-center gap-2 text-sm cursor-pointer hover:text-sky-600 transition-colors w-1/2';
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
    wrap.className = 'flex items-center gap-2 text-sm cursor-pointer hover:text-sky-600 transition-colors w-1/2';
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

// The controls bar is generated from the active model's parameter schema, so
// the viewer never hard-codes a specific model's sliders. Switching models
// re-renders the param blocks in place and leaves the selector intact.
export function createPanel(opts) {
    const {
        body, model, catalog = [], activeId,
        onSelect, onParamsChange, onThemeChange, themeIsDark = false
    } = opts;

    const titleEl = document.getElementById('model-name');
    const subEl = document.getElementById('model-sub');

    let current = model;
    let rows = {};
    let select = null;
    let themeInput = null;

    body.textContent = '';

    if (catalog.length > 1) {
        const shell = blockShell('model', 'Model');
        shell.value.remove();
        select = document.createElement('select');
        select.id = 'param-model';
        select.className = FIELD_CLS;
        for (const entry of catalog) {
            const opt = document.createElement('option');
            opt.value = entry.id;
            opt.textContent = entry.name;
            select.appendChild(opt);
        }
        select.value = activeId || (catalog[0] && catalog[0].id);
        select.addEventListener('change', e => onSelect && onSelect(e.target.value));
        shell.wrap.appendChild(select);
        body.appendChild(shell.wrap);
    }

    const msg = document.createElement('p');
    msg.id = 'panel-msg';
    msg.className = 'hidden mb-3 text-[11px] leading-snug text-red-600 dark:text-red-400';
    body.appendChild(msg);

    const host = document.createElement('div');
    body.appendChild(host);

    function render() {
        host.textContent = '';
        rows = {};
        if (titleEl) titleEl.textContent = current.name;
        if (subEl) subEl.textContent = current.subtitle || '';

        const toggles = [];
        for (const [key, p] of Object.entries(current.params)) {
            if (p.type === 'range') {
                const built = rangeBlock(key, p, current.state[key]);
                built.input.addEventListener('input', e => {
                    const v = parseFloat(e.target.value);
                    built.value.textContent = fmt(v, p.unit);
                    onParamsChange && onParamsChange({ [key]: v });
                });
                rows[key] = built;
                host.appendChild(built.wrap);
            } else if (p.type === 'toggle') {
                const built = toggleBlock(key, p, current.state[key]);
                built.input.addEventListener('change', e => {
                    onParamsChange && onParamsChange({ [key]: e.target.checked });
                });
                rows[key] = built;
                toggles.push(built.wrap);
            }
        }

        const footer = document.createElement('div');
        footer.className = 'flex gap-4 pt-4 border-t border-gray-200 dark:border-zinc-700';
        toggles.forEach(t => footer.appendChild(t));
        const theme = themeBlock(liveTheme, isDark => onThemeChange && onThemeChange(isDark));
        themeInput = theme.input;
        footer.appendChild(theme.wrap);
        host.appendChild(footer);
    }

    // Live viewer theme, so a model-driven theme switch and the
    // prefers-color-scheme default both show the right checkbox state.
    let liveTheme = themeIsDark;

    render();

    return {
        get model() { return current; },
        setModel(m) { current = m; render(); },
        setActive(id) { if (select) select.value = id; },
        setBusy(busy) { if (select) select.disabled = busy; },
        setError(text) {
            msg.textContent = text || '';
            msg.classList.toggle('hidden', !text);
        },
        setTheme(isDark) {
            liveTheme = isDark;
            if (themeInput) themeInput.checked = isDark;
        },
        sync() {
            for (const [key, r] of Object.entries(rows)) {
                const v = current.state[key];
                if (r.value) r.value.textContent = fmt(v, current.params[key].unit);
                if (r.input.type === 'checkbox') r.input.checked = !!v;
                else r.input.value = v;
            }
        }
    };
}
