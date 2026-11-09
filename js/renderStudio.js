// Photoreal Render Studio: talks to the local TILT FORGE service
// (forge/forge_server.py, 127.0.0.1:8765). Dynamically imported by app.js
// when the overflow menu opens the studio, so the main bundle never pays
// for this. Same-machine origins only; the bearer token comes from
// /v1/handshake, artifact images from /v1/artifact/{job}/{file}.
//
// Primary lane: "Render current view" - the exact WebGL camera (position/
// target/fov/aspect captured live by app.js through opts.getView) is sent
// to forge, which loads its cached prepared scene and matches the Blender
// camera to it (see render-lab/render_from_blend.py exact-view branch).
// Studio presets stay available as a secondary, clearly demoted lane.

const FORGE = 'http://127.0.0.1:8765';

const QUALITY = [
    { id: 'draft', label: 'Draft', samples: 128, res: [1280, 720] },
    { id: 'standard', label: 'Standard', samples: 384, res: [2048, 1152] },
    { id: 'high', label: 'High', samples: 512, res: [3840, 2160] }
];

// Secondary lane only: camera presets mirror ballroom_common.py SHOTS.
const SHOTS = [
    { id: 'grand-wide', label: 'Grand wide' },
    { id: 'grand-front', label: 'Front' },
    { id: 'grand-threeQ', label: 'Three quarter' },
    { id: 'grand-low', label: 'Low angle' },
    { id: 'grand-high', label: 'High angle' },
    { id: 'grand-side', label: 'Side' },
    { id: 'det-chand', label: 'Chandelier' },
    { id: 'det-table', label: 'Gala table' },
    { id: 'det-rail', label: 'Rail detail' },
    { id: 'det-drape', label: 'Drape detail' }
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

export async function openRenderStudio(name, opts) {
    // Forge reachable? Everything below is meaningless without it - the
    // token probe doubles as the reachability check.
    const token = await forgeToken();
    // A render started in a previous modal session (the tab reload, the
    // scrim got closed) can be reattached: the job id + submit time live
    // in sessionStorage and the poll resumes from the live job record.
    const reattachMeta = (() => {
        try { return JSON.parse(sessionStorage.getItem('tilt-forge-job') || 'null'); }
        catch { return null; }
    })();

    const scrim = el('div', SHEET_CLS);
    scrim.id = 'render-studio';

    const card = el('div', 'bg-white dark:bg-zinc-900 w-full max-w-lg '
        + 'max-h-[85vh] overflow-y-auto rounded-xl shadow-2xl p-4 space-y-3');
    scrim.appendChild(card);

    card.appendChild(el('h2', 'text-base font-bold text-gray-900 dark:text-zinc-100',
        'Photoreal render studio'));
    const sub = name
        ? 'Ray-traced render of "' + name + '" on the local Forge (Blender Cycles).'
        : 'Ray-traced render on the local Forge (Blender Cycles).';
    card.appendChild(el('p', 'text-[11px] text-gray-500 dark:text-zinc-400', sub));

    const qLabel = el('div', 'text-[11px] font-semibold uppercase tracking-wider '
        + 'text-gray-500 dark:text-zinc-400', 'Quality');
    card.appendChild(qLabel);
    const qPick = new Set(['draft']);
    card.appendChild(selRow(QUALITY, qPick, true));

    const watch = { on: false };
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
    extras.appendChild(toggle('Show Blender window', watch));
    extras.appendChild(toggle('4K resolution', fourK));
    card.appendChild(extras);

    const status = el('div', 'text-xs text-gray-500 dark:text-zinc-400',
        token ? '' : 'Forge not reachable — start forge_server.py first.');
    card.appendChild(status);

    // Progress bar. Hidden until a job is submitted; the poll loop drives
    // the fill straight from the forge job's progress field (the worker
    // streams Blender's sample ticks into it), animated by a small CSS
    // transition so 1.2s polls still read as continuous motion.
    const barWrap = el('div', 'hidden', '');
    const track = el('div', 'h-2 w-full rounded-full bg-gray-200 '
        + 'dark:bg-zinc-700 overflow-hidden', '');
    const fill = el('div', 'h-full w-0 rounded-full bg-gradient-to-r '
        + 'from-sky-500 to-teal-400 transition-all duration-300', '');
    track.appendChild(fill);
    barWrap.appendChild(track);
    card.appendChild(barWrap);
    const setBar = (pct, failed) => {
        barWrap.classList.remove('hidden');
        fill.className = 'h-full rounded-full transition-all duration-300 '
            + (failed
                ? 'bg-red-500'
                : 'bg-gradient-to-r from-sky-500 to-teal-400');
        fill.style.width = Math.max(0, Math.min(100, failed ? 100 : pct)) + '%';
    };

    const gallery = el('div', 'grid grid-cols-2 gap-2');
    card.appendChild(gallery);

    const actions = el('div', 'flex justify-end gap-2 pt-1');
    const close = el('button', 'px-3 py-1.5 rounded-lg text-sm font-semibold '
        + 'text-gray-600 dark:text-zinc-300 hover:bg-gray-100 '
        + 'dark:hover:bg-zinc-800', 'Close');
    const go = el('button', 'px-3 py-2 rounded-lg text-sm font-semibold '
        + 'bg-sky-600 text-white hover:bg-sky-500 disabled:opacity-50 '
        + 'disabled:cursor-not-allowed', 'Render current view');
    go.type = 'button';
    close.type = 'button';
    actions.append(close, go);
    card.appendChild(actions);

    const cardHint = el('p', 'text-[10px] text-gray-400 dark:text-zinc-500',
        'You can close this window while a render runs - Forge keeps working, '
        + 'and reopening the studio reattaches to it.');
    card.appendChild(cardHint);

    // Secondary, demoted lane: fixed camera presets for catalog shots.
    const presets = el('details', 'pt-1 border-t border-gray-100 dark:border-zinc-800');
    const pSum = el('summary', 'text-[11px] font-semibold text-gray-500 '
        + 'dark:text-zinc-400 cursor-pointer select-none',
        'Studio presets (fixed cameras)');
    presets.appendChild(pSum);
    const pBody = el('div', 'pt-2 space-y-2');
    const picked = new Set(['grand-wide', 'grand-front']);
    pBody.appendChild(selRow(SHOTS, picked, false));
    const collage = { on: false };
    const pExtras = el('div', 'flex flex-wrap gap-2 text-xs');
    pExtras.appendChild(toggle('Labeled collage', collage));
    const pGo = el('button', CHIP_CLS + CHIP_OFF.replace('text-gray-600', 'text-sky-700'),
        'Render presets');
    pGo.type = 'button';
    pBody.appendChild(pExtras);
    pBody.appendChild(pGo);
    presets.appendChild(pBody);
    card.appendChild(presets);

    function onKey(e) { if (e.key === 'Escape') close.click(); }
    close.addEventListener('click', () => {
        document.removeEventListener('keydown', onKey, true);
        stopElapsed();
        scrim.remove();
    });
    document.addEventListener('keydown', onKey, true);
    scrim.addEventListener('click', e => { if (e.target === scrim) close.click(); });

    const qualityId = 'draft';
    function qualityOf() {
        const q = QUALITY.find(v => v.id === ([...qPick][0] || qualityId)) || QUALITY[0];
        const res = fourK.on ? [3840, 2160] : q.res;
        return { samples: q.samples, res, '4k': !!fourK.on };
    }

    // The PNG must crop like the viewer screen does: the render frame keeps
    // the captured aspect (same vertical fov, same horizontal fov), so a
    // wide WebGL canvas yields a wide panoramic render instead of a tiny
    // band inside a tall 16:9 frame.
    function resFor(aspect, tier) {
        let a = Math.max(0.5, Math.min(4.5, Number(aspect) || 1.333));
        const short = { draft: 720, standard: 1152, high: 2160 }[tier || 'draft'] || 720;
        let w, h;
        if (a >= 1) { w = Math.round(short * a); h = short; }
        else { w = short; h = Math.round(short / a); }
        return [Math.min(3840, Math.max(320, w)), Math.min(2160, Math.max(320, h))];
    }

    // One render at a time, regardless of which submit button fired: both
    // lane buttons lock together so two jobs can never write into the same
    // sidecar progress lane.
    const busy = { on: false };
    function lockBusy(on) {
        busy.on = on;
        go.disabled = on;
        pGo.disabled = on;
        presets.disabled = on;
    }
    let elapsedTimer = 0;
    const startElapsed = (fromTs) => {
        const t0 = fromTs || Date.now();
        stopElapsed();
        elapsedTimer = setInterval(() => {
            const s = Math.max(0, Math.round((Date.now() - t0) / 1000));
            if (s >= 5) {
                const base = status.textContent.replace(/\s*\(\d+s\)\s*$/, '');
                status.textContent = base + ' (' + s + 's elapsed)';
            }
        }, 1000);
    };
    function stopElapsed() {
        if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = 0; }
    }
    const elapsedOf = () => {
        if (!reattachMeta || !reattachMeta.started) return undefined;
        return (Date.now() - reattachMeta.started) / 1000;
    };

    async function submit(spec, busyBtn) {
        if (!token || busy.on) return;
        lockBusy(true);
        gallery.textContent = '';
        try {
            status.textContent = 'Sending job to Forge… (view: '
                + (spec.view ? 'your current camera' : 'studio presets') + ')';
            setBar(1);
            const r = await fetch(FORGE + '/v1/render.json', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + token,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(spec)
            });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const job = await r.json();
            const started = Date.now();
            sessionStorage.setItem('tilt-forge-job', JSON.stringify({
                id: job.id, started, mode: spec.view ? 'view' : 'presets'
            }));
            watchJob(job.id, started);
        } catch (err) {
            setBar(100, true);
            status.textContent = 'Could not reach Forge ('
                + ((err && err.message) || 'offline') + ')';
            lockBusy(false);
        }
    }

    // One shared poll loop, also used by reattach: the modal is disposable
    // (close/reopen) but the job keeps running on Forge, so the poll is the
    // ONLY source of truth for terminal states and gallery fills.
    const guess = (data) => {
        if (typeof data.progress === 'number') return data.progress;
        if (data.status === 'done') return 100;
        if (data.status === 'collage') return 95;
        if (data.status === 'preparing') return 10;
        if (data.status && data.status.startsWith('rendering:')) return 50;
        return 2;
    };

    async function fillGallery(id, artifacts) {
        gallery.textContent = '';
        for (const file of artifacts) {
            const cell = el('div', 'rounded-lg overflow-hidden border '
                + 'border-gray-200 dark:border-zinc-700 bg-gray-50 '
                + 'dark:bg-zinc-800');
            const img = document.createElement('img');
            img.src = FORGE + '/v1/artifact/' + id + '/' + file;
            img.alt = file;
            img.loading = 'lazy';
            img.className = 'w-full h-32 object-cover';
            const cap = el('div', 'px-2 py-1 text-[10px] font-semibold '
                + 'text-gray-500 dark:text-zinc-400 truncate', file);
            cell.append(img, cap);
            gallery.appendChild(cell);
        }
    }

    function watchJob(id, startedTs) {
        stopElapsed();
        startElapsed(startedTs);
        let poll = setInterval(() => pollTick(), 1200);

        async function pollTick() {
            let data;
            try {
                const jr = await fetch(FORGE + '/v1/jobs/' + id);
                if (!jr.ok) return;
                data = await jr.json();
            } catch (e) { return; }
            const pct = guess(data);
            setBar(pct);
            const label = (data.detail
                ? (data.detail.charAt(0).toUpperCase() + data.detail.slice(1))
                : (data.status.startsWith('preparing')
                    ? 'Building photoreal scene (one-time)…'
                    : data.status.startsWith('rendering:')
                        ? 'Rendering ' + data.status.split(':')[1] + '…'
                        : data.status));
            status.textContent = label + ' (' + pct + '%)'
                + (data.cache ? ' · scene cache: ' + data.cache : '');
            if (data.status === 'failed') {
                clearInterval(poll); poll = 0;
                setBar(100, true);
                stopElapsed();
                status.textContent = 'Render failed: ' + (data.error || 'unknown');
                sessionStorage.removeItem('tilt-forge-job');
                lockBusy(false);
                return;
            }
            if (data.status === 'done') {
                clearInterval(poll); poll = 0;
                setBar(100);
                stopElapsed();
                status.textContent = 'Finished — '
                    + (data.artifacts || []).length + ' image(s)'
                    + (typeof data.seconds === 'number'
                        ? ' in ' + data.seconds.toFixed(1) + 's' : '');
                sessionStorage.removeItem('tilt-forge-job');
                lockBusy(false);
                fillGallery(id, data.artifacts || []);
            }
        }
    }

    // Reattach on open: a job submitted before the modal closed (or the tab
    // reloaded) resumes the bar where Forge is now.
    if (reattachMeta && token) {
        fetch(FORGE + '/v1/jobs/' + reattachMeta.id)
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (!data || data.status === 'failed') {
                    sessionStorage.removeItem('tilt-forge-job');
                    if (data && data.status === 'failed') {
                        setBar(100, true);
                        status.textContent = 'Previous render failed: '
                            + (data.error || 'unknown');
                    }
                    return;
                }
                if (data.status === 'done') {
                    sessionStorage.removeItem('tilt-forge-job');
                    stopElapsed();
                    status.textContent = 'Previous render finished — '
                        + (data.artifacts || []).length + ' image(s)';
                    fillGallery(reattachMeta.id, data.artifacts || []);
                    return;
                }
                status.textContent = 'Reattached to the render started earlier…';
                watchJob(reattachMeta.id, reattachMeta.started);
            })
            .catch(() => { /* forge offline - normal path handles it */ });
    }

    // Primary: exact current viewer camera, captured when clicked.
    go.addEventListener('click', async () => {
        if (!token) return;
        if (typeof (opts && opts.getView) !== 'function') {
            status.textContent = 'Current-view capture unavailable here - '
                + 'use Studio presets below.';
            return;
        }
        let view;
        try {
            view = opts.getView();
        } catch (e) { view = null; }
        if (!view || !view.position || !view.target) {
            status.textContent = 'Camera state unavailable in this scene - '
                + 'use Studio presets below.';
            return;
        }
        // Catch unsupported scenes at capture time: a failed round-trip
        // tells the same story with worse UX (dead job record, red bar).
        if ((view.scene || 'ballroom') !== 'ballroom') {
            status.textContent = '"' + view.scene + '" is WebGL-only for now - '
                + 'photoreal rendering covers the Ballroom. Switch the scene to '
                + 'Ballroom and render again, or use Studio presets below.';
            setBar(0);
            barWrap.classList.add('hidden');
            return;
        }
        const q = qualityOf();
        const res = fourK.on
            ? [3840, 2160]
            : resFor(view.aspect, [...qPick][0]);
        const rig = (() => {
            try {
                return typeof (opts && opts.getRig) === 'function'
                    ? opts.getRig() : null;
            } catch { return null; }
        })();
        const payload = {
            scene: view.scene || 'ballroom',
            view: {
                position: view.position, target: view.target,
                fov: view.fov || 45, aspect: view.aspect || 1.333
            },
            quality: { samples: q.samples, '4k': false, res },
            watch: !!watch.on
        };
        if (rig) payload.rig = rig;
        await submit(payload, go);
    });

    // Secondary: preset shots (multi), optional labeled collage.
    pGo.addEventListener('click', async () => {
        if (!token) return;
        const q = qualityOf();
        const rig = (() => {
            try {
                return typeof (opts && opts.getRig) === 'function'
                    ? opts.getRig() : null;
            } catch { return null; }
        })();
        const payload = {
            scene: 'ballroom',
            shots: SHOTS.filter(s => picked.has(s.id)).map(s => s.id),
            quality: { samples: q.samples, res: q.res, '4k': q['4k'] },
            collage: !!collage.on,
            watch: !!watch.on
        };
        if (rig) payload.rig = rig;
        await submit(payload, pGo);
    });

    document.body.appendChild(scrim);
}
