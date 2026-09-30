const LABEL_CLS = 'font-semibold text-gray-600 dark:text-zinc-300';
const VALUE_CLS = 'text-sky-600 dark:text-sky-400 font-mono';
const CHECK_CLS = 'custom-checkbox';

const show = (key, value) => {
    const n = PARAM_FORMAT[key];
    return n ? `${parseFloat(value.toFixed(2))}${n}` : String(value);
};

let PARAM_FORMAT = {};

function rangeBlock(key, p) {
    const wrap = document.createElement('div');
    wrap.className = 'mb-4';

    const head = document.createElement('div');
    head.className = 'flex justify-between text-xs mb-1';

    const label = document.createElement('label');
    label.className = LABEL_CLS;
    label.textContent = p.label;
    label.htmlFor = `param-${key}`;

    const value = document.createElement('span');
    value.className = VALUE_CLS;
    value.id = `val-${key}`;

    const input = document.createElement('input');
    input.type = 'range';
    input.id = `param-${key}`;
    input.min = p.min;
    input.max = p.max;
    input.step = p.step;
    input.value = p.value;

    head.append(label, value);
    wrap.append(head, input);
    return { wrap, input, value };
}

function toggleBlock(key, p) {
    const label = document.createElement('label');
    label.className = 'flex items-center gap-2 text-sm cursor-pointer hover:text-sky-600 transition-colors w-1/2';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = `param-${key}`;
    input.className = CHECK_CLS;
    input.checked = !!p.value;

    const span = document.createElement('span');
    span.className = 'font-medium tracking-wide';
    span.textContent = p.label;

    label.append(input, span);
    return { wrap: label, input };
}

// Builds the controls bar from the active model's parameter schema, so the
// viewer never hard-codes a specific model's sliders.
export function createPanel(opts) {
    const { body, model, onParamsChange, onThemeChange } = opts;
    const titleEl = document.getElementById('model-name');
    const subEl = document.getElementById('model-sub');
    if (titleEl) titleEl.textContent = model.name;
    if (subEl) subEl.textContent = model.subtitle || '';

    PARAM_FORMAT = {};
    for (const [key, p] of Object.entries(model.params)) {
        if (p.unit) PARAM_FORMAT[key] = p.unit;
    }

    body.textContent = '';
    const rows = {};
    const toggles = [];

    for (const [key, p] of Object.entries(model.params)) {
        if (p.type === 'range') {
            const built = rangeBlock(key, p);
            built.input.addEventListener('input', e => {
                const v = parseFloat(e.target.value);
                built.value.textContent = show(key, v);
                onParamsChange({ [key]: v });
            });
            built.input.value = model.state[key];
            built.value.textContent = show(key, model.state[key]);
            rows[key] = built;
            body.appendChild(built.wrap);
        } else if (p.type === 'toggle') {
            const built = toggleBlock(key, p);
            built.input.checked = !!model.state[key];
            built.input.addEventListener('change', e => {
                onParamsChange({ [key]: e.target.checked });
            });
            toggles.push(built);
            rows[key] = built;
        }
    }

    const footer = document.createElement('div');
    footer.className = 'flex gap-4 pt-4 border-t border-gray-200 dark:border-zinc-700';
    toggles.forEach(t => footer.appendChild(t.wrap));

    const themeLabel = document.createElement('label');
    themeLabel.className = 'flex items-center gap-2 text-sm cursor-pointer hover:text-sky-600 transition-colors w-1/2';
    const themeInput = document.createElement('input');
    themeInput.type = 'checkbox';
    themeInput.id = 'toggle-theme';
    themeInput.className = CHECK_CLS;
    themeInput.checked = document.documentElement.classList.contains('dark');
    themeInput.addEventListener('change', e => onThemeChange(e.target.checked));
    const themeSpan = document.createElement('span');
    themeSpan.className = 'font-medium tracking-wide';
    themeSpan.textContent = 'Dark Mode';
    themeLabel.append(themeInput, themeSpan);
    footer.appendChild(themeLabel);
    body.appendChild(footer);

    return {
        sync() {
            for (const [key, r] of Object.entries(rows)) {
                const v = model.state[key];
                if (r.value) r.value.textContent = show(key, v);
                if (r.input.type === 'checkbox') r.input.checked = !!v;
                else r.input.value = v;
            }
        }
    };
}
