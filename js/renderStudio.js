// Photoreal Render Studio: talks to the local TILT FORGE service
// (forge/forge_server.py, 127.0.0.1:8765). Dynamically imported by app.js
// when the overflow menu opens the studio, so the main bundle never pays
// for this. Same-machine origins only; the bearer token comes from
// /v1/handshake, artifact images from /v1/artifact/{job}/{file}.

const FORGE = 'http://127.0.0.1:8765';

const QUALITY = [
    { id: 'draft', label: 'Draft', samples: 128 },
    { id: 'standard', label: 'Standard', samples: 384 },
    { id: 'high', label: 'High', samples: 512 }
];

const SHOTS = [
    { id: 'grand-wide', label: 'Grand wide' },
    { id: 'grand-front', label: 'Front' },
    { id: 'three-q', label: 'Three quarter' },
    { id: 'dj-booth', label: 'DJ wing' },
    { id: 'dance-floor', label: 'Dance floor' }
];

const SHEET_CLS = 'fixed inset-0 z-50 bg-black/40 backdrop-blur-sm '
    + 'flex items-end sm:items-center justify-center p-4';

const CHIP_CLS = 'px-2.5 py-1.5 rounded-lg border text-xs font-semibold '
    + 'transition-colors ';
const CHIP_ON = 'border-sky-500 bg-sky-50 text-sky-700 '
    + 'dark:bg-sky-900/40 dark:text-sky-300 dark:border-sky-700';
const CHIP_OFF = 'border-gray-300 bg-white/70 text-gray-600 hover:border-sky-400 '
    + 'dark:border-zinc-600 dark:bg-zinc-800/70 dark:text-zinc-300';

function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
}

// Bearer token: fetched once from the handshake endpoint, cached in
// sessionStorage so the studio never re-fires it during an app session.
async function forgeToken() {
    try {
        const cached = sessionStorage.getItem('tilt-forge-token');
        if (cached) return cached;
        const r = await fetch(FORGE + '/v1/handshake');
        if (!r.ok) return null;
        const body = await r.json();
        if (body && body.token) {
            sessionStorage.setItem('tilt-forge-token', body.token);
            return body.token;
        }
    } catch (e) { /* forge offline */ }
    return null;
}

// A row of toggle chips bound to a Set of picked ids, optionally
// single-choice (single=true clears before adding, so the set stays len 1).
function selRow(options, picked, single) {
    const row = el('div', 'flex flex-wrap gap-1.5');
    const btnOf = new Map();
    for (const opt of options) {
        const b = el('button', '', opt.label);
        b.type = 'button';
        b.addEventListener('click', () => {
            if (single) {
                picked.clear();
                picked.add(opt.id);
            } else if (picked.has(opt.id)) {
                if (picked.size > 1 || options.length === 1) picked.delete(opt.id);
            } else {
                picked.add(opt.id);
            }
            paint();
        });
        btnOf.set(opt.id, b);
        row.appendChild(b);
    }
    function paint() {
        for (const opt of options) {
            const b = btnOf.get(opt.id);
            const on = picked.has(opt.id);
            b.setAttribute('aria-pressed', on ? 'true' : 'false');
            b.className = CHIP_CLS + (on ? CHIP_ON : CHIP_OFF);
        }
    }
    paint();
    return row;
}

export async function openRenderStudio(name) {
    // Forge reachable? Everything below is meaningless without it - the
    // token probe doubles as the reachability check.
    const token = await forgeToken();

    const scrim = el('div', SHEET_CLS);
    scrim.id = 'render-studio';

    const card = el('div', 'bg-white dark:bg-zinc-900 w-full max-w-lg '
        + 'max-h-[85vh] overflow-y-auto rounded-xl shadow-2xl p-4 space-y-3');
    scrim.appendChild(card);

    card.appendChild(el('h2', 'text-base font-bold text-gray-900 dark:text-zinc-100',
        'Photoreal render studio'));
    const sub = name
        ? 'Rendering "' + name + '" on the local Forge (Blender Cycles).'
        : 'Ray-traced render on the local Forge (Blender Cycles).';
    card.appendChild(el('p', 'text-[11px] text-gray-500 dark:text-zinc-400', sub));

    const qLabel = el('div', 'text-[11px] font-semibold uppercase tracking-wider '
        + 'text-gray-500 dark:text-zinc-400', 'Quality');
    card.appendChild(qLabel);
    const qPick = new Set(['standard']);
    card.appendChild(selRow(QUALITY, qPick, true));

    const sLabel = el('div', 'text-[11px] font-semibold uppercase tracking-wider '
        + 'text-gray-500 dark:text-zinc-400', 'Shots');
    card.appendChild(sLabel);
    const picked = new Set(['grand-wide', 'grand-front']);
    card.appendChild(selRow(SHOTS, picked, false));

    // Simple state objects: clicking flips the boolean and the helper
    // repaints, so the submit handler just reads .on.
    const collage = { on: true };
    const fourK = { on: false };
    const extras = el('div', 'flex flex-wrap gap-2 text-xs');

    function toggle(label, state) {
        const b = el('button', CHIP_CLS + (state.on ? CHIP_ON : CHIP_OFF), label);
        b.type = 'button';
        b.setAttribute('aria-pressed', state.on ? 'true' : 'false');
        b.addEventListener('click', () => {
            state.on = !state.on;
            b.setAttribute('aria-pressed', state.on ? 'true' : 'false');
            b.className = CHIP_CLS + (state.on ? CHIP_ON : CHIP_OFF);
        });
        return b;
    }
    extras.appendChild(toggle('Labeled collage', collage));
    extras.appendChild(toggle('4K resolution', fourK));
    card.appendChild(extras);

    const status = el('div', 'text-xs text-gray-500 dark:text-zinc-400',
        token ? '' : 'Forge not reachable — start forge_server.py first.');
    card.appendChild(status);

    const gallery = el('div', 'grid grid-cols-2 gap-2');
    card.appendChild(gallery);

    const actions = el('div', 'flex justify-end gap-2 pt-1');
    const close = el('button', 'px-3 py-1.5 rounded-lg text-sm font-semibold '
        + 'text-gray-600 dark:text-zinc-300 hover:bg-gray-100 '
        + 'dark:hover:bg-zinc-800', 'Close');
    const go = el('button', 'px-3 py-1.5 rounded-lg text-sm font-semibold '
        + 'bg-sky-600 text-white hover:bg-sky-500 disabled:opacity-50', 'Render');
    go.type = 'button';
    close.type = 'button';
    actions.append(close, go);
    card.appendChild(actions);

    function onKey(e) { if (e.key === 'Escape') close.click(); }
    close.addEventListener('click', () => {
        document.removeEventListener('keydown', onKey, true);
        scrim.remove();
    });
    document.addEventListener('keydown', onKey, true);
    scrim.addEventListener('click', e => { if (e.target === scrim) close.click(); });

    go.addEventListener('click', async () => {
        if (!token) return;
        go.disabled = true;
        gallery.textContent = '';
        const qualityId = [...qPick][0] || 'standard';
        const samples = (QUALITY.find(q => q.id === qualityId) || QUALITY[1]).samples;
        try {
            status.textContent = 'Sending job to Forge…';
            const r = await fetch(FORGE + '/v1/render.json', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + token,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    scene: 'ballroom',
                    shots: SHOTS.filter(s => picked.has(s.id)).map(s => s.id),
                    quality: { samples, '4k': !!fourK.on },
                    collage: !!collage.on
                })
            });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const job = await r.json();
            status.textContent = 'Queued as ' + job.id
                + ' — Forge is reconstructing…';

            const poll = setInterval(async () => {
                let data;
                try {
                    const jr = await fetch(FORGE + '/v1/jobs/' + job.id);
                    data = await jr.json();
                } catch (e) { return; }
                if (data.status === 'failed') {
                    clearInterval(poll);
                    status.textContent = 'Render failed: '
                        + (data.error || 'unknown');
                    go.disabled = false;
                    return;
                }
                if (data.status === 'done') {
                    clearInterval(poll);
                    status.textContent = 'Finished — '
                        + (data.artifacts || []).length + ' image(s)';
                    go.disabled = false;
                    for (const file of (data.artifacts || [])) {
                        const cell = el('div', 'rounded-lg overflow-hidden border '
                            + 'border-gray-200 dark:border-zinc-700 bg-gray-50 '
                            + 'dark:bg-zinc-800');
                        const img = document.createElement('img');
                        img.src = FORGE + '/v1/artifact/' + job.id + '/' + file;
                        img.alt = file;
                        img.loading = 'lazy';
                        img.className = 'w-full h-32 object-cover';
                        const cap = el('div', 'px-2 py-1 text-[10px] font-semibold '
                            + 'text-gray-500 dark:text-zinc-400 truncate', file);
                        cell.append(img, cap);
                        gallery.appendChild(cell);
                    }
                    return;
                }
                if (data.status.startsWith('rendering:')) {
                    status.textContent = 'Rendering shot: '
                        + data.status.split(':')[1] + '…';
                } else {
                    status.textContent = 'Status: ' + data.status;
                }
            }, 1200);
        } catch (err) {
            status.textContent = 'Could not reach Forge ('
                + ((err && err.message) || 'offline') + ')';
            go.disabled = false;
        }
    });

    document.body.appendChild(scrim);
}
