// The Objects chip - a CapCut-style add tray: a category tab bar over a
// grid of cards, one tap drops the object on stage. It ships as its own
// module (the way objects/flowerchip.js does) so panel.js only wires it
// in: the chip splices into the toolbar after Sets, and a tap opens this
// overlay instead of swapping the shelf's content.
//
// buildObjectCards(input) is pure data with no DOM - tests pin it directly.
// createObjectChip(ctx) owns the overlay's DOM and calls back on taps.
//
// ctx: {
//   icon(paths)        - the panel.js inline-SVG helper
//   getCardsInput()    - live input for buildObjectCards
//   onAction(action)   - a card was tapped: { kind, ... } (panel.js maps
//                        each kind onto its existing add callbacks)
//   getStageRows()      - optional: instances already on stage for the
//                        "On stage" strip [{ key, assetId?, name, x, y, z, ry }]
//   onStageAction(...) - optional: 'remove' | 'place' ({ x | y | z | ry })
//                        for one instance
//   stepBar(opts)      - optional: panel.js's hold-to-traverse number box
//                        ({ label, value, step, min, max, onChange })
//   live               - the panel's button registry (busy dimming)
// }

export const OBJECT_CHIP_ID = 'objects';

// One path per card category - tiny inline glyphs, no icon font.
const GLYPHS = {
    all: 'M4 7l8-4 8 4v10l-8 4-8-4V7z',
    frames: 'M4 5h16M7 5v14M17 5v14',
    pillars: 'M6 21V7M12 21V7M18 21V7M4 7h16',
    lights: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2'
        + 'M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2'
        + 'M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
    flowers: 'M12 21c-4-3-7-6-7-10a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 4-3 7-7 10z',
    panels: 'M5 21V10a7 7 0 0 1 14 0v11'
};

// Tab order and labels. A category only appears when it has cards, so an
// empty Flowers library never shows a dead tab.
const CATEGORY_ORDER = ['all', 'frames', 'pillars', 'lights', 'flowers', 'panels'];
const CATEGORY_LABELS = {
    all: 'All', frames: 'Frames', pillars: 'Pillars',
    lights: 'Lighting', flowers: 'Flowers', panels: 'Panels'
};

// The three fixture cards. Kept here (not imported from elements/light.js)
// so this module stays pure data + DOM - no three.js on its import graph.
const LIGHT_CHOICES = [
    { type: 'light-par', short: 'PAR' },
    { type: 'light-led', short: 'LED' },
    { type: 'light-strip', short: 'Strip' }
];

// input: {
//   frames:   [{ id, name, subtitle, onStage }],
//   pillars:  { frameId, frameName, count, max } | null,
//   lights:   { frameId, frameName, counts: { type: n } } | null,
//   flowers:  [{ id, name, meta }],
//   decor:    [{ assetId, name, category, sub, qty, placed }]  (loop 2)
// }
// returns { categories: [{ id, label, count }], cards: [...] }
export function buildObjectCards(input) {
    const in_ = input || {};
    const cards = [];

    for (const f of (in_.frames || [])) {
        cards.push({
            key: 'frame:' + f.id,
            category: 'frames',
            name: f.name || f.id,
            sub: f.subtitle || 'Curtain frame',
            badge: f.onStage ? 'On stage' : '',
            on: !!f.onStage,
            action: { kind: 'frame', id: f.id }
        });
    }

    const p = in_.pillars;
    if (p && p.frameId) {
        // One card per pillar type: the classical column and the two rails.
        // Tapping adds one of that type to the active frame's ends.
        const types = p.types && p.types.length ? p.types
            : [{ type: 'classical', label: 'Pillars', count: p.count || 0, max: p.max || 2 }];
        for (const t of types) {
            const n = t.count || 0;
            cards.push({
                key: 'pillar:' + t.type,
                category: 'pillars',
                name: t.label || t.type,
                sub: n ? `${n} standing by ${p.frameName || 'the frame'}`
                    : 'Attached to the frame ends',
                badge: n ? `${n}/${t.max || 2}` : 'Add',
                on: n > 0,
                action: { kind: 'pillar', type: t.type, label: t.label }
            });
        }
    }

    const l = in_.lights;
    if (l && l.frameId) {
        for (const choice of LIGHT_CHOICES) {
            const n = (l.counts && l.counts[choice.type]) || 0;
            cards.push({
                key: 'light:' + choice.type,
                category: 'lights',
                name: choice.short,
                sub: `On ${l.frameName || 'the frame'}`,
                badge: n ? String(n) : 'Add',
                on: n > 0,
                action: { kind: 'light', type: choice.type }
            });
        }
    }

    for (const fl of (in_.flowers || [])) {
        cards.push({
            key: 'flower:' + fl.id,
            previewKey: fl.previewKey || 'flower:' + fl.id,
            category: 'flowers',
            name: fl.name || fl.id,
            sub: fl.meta || 'Studio arrangement',
            badge: '',
            on: false,
            action: { kind: 'flower', id: fl.id }
        });
    }

    for (const d of (in_.decor || [])) {
        cards.push({
            key: 'decor:' + d.assetId,
            category: d.category || 'panels',
            name: d.name || d.assetId,
            sub: d.sub || '',
            badge: d.placed ? String(d.placed) : (d.qty ? 'x' + d.qty : 'Add'),
            on: !!d.placed,
            action: { kind: 'decor', assetId: d.assetId }
        });
    }

    const present = new Set(cards.map(c => c.category));
    const categories = [{ id: 'all', label: CATEGORY_LABELS.all, count: cards.length }];
    for (const id of CATEGORY_ORDER) {
        if (id === 'all' || !present.has(id)) continue;
        categories.push({
            id,
            label: CATEGORY_LABELS[id] || id,
            count: cards.filter(c => c.category === id).length
        });
    }
    return { categories, cards };
}

export function createObjectChip(ctx) {
    let active = false;
    let host = null;
    let closeBtn = null;
    let tabRow = null;
    let grid = null;
    let stage = null;
    let activeCat = 'all';
    let lastFocus = null;

    const chip = {
        id: OBJECT_CHIP_ID,
        label: 'Objects',
        icon: ctx.icon(GLYPHS.all),
        // Always shown: adding things is the first move a session makes,
        // and the tray explains itself when a category is empty.
        show: () => true
    };

    function ensure() {
        if (host) return;
        host = document.createElement('div');
        host.id = 'objpick';
        host.hidden = true;

        const scrim = document.createElement('div');
        scrim.className = 'objpick-scrim';

        const sheet = document.createElement('div');
        sheet.className = 'objpick-sheet';
        sheet.setAttribute('role', 'dialog');
        sheet.setAttribute('aria-modal', 'true');
        sheet.setAttribute('aria-labelledby', 'objpick-title');

        const head = document.createElement('div');
        head.className = 'objpick-head';
        const title = document.createElement('h2');
        title.id = 'objpick-title';
        title.textContent = 'Add object';
        closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'objpick-close';
        closeBtn.setAttribute('aria-label', 'Close');
        closeBtn.textContent = 'x';
        head.append(title, closeBtn);

        tabRow = document.createElement('div');
        tabRow.className = 'objpick-tabs';
        tabRow.setAttribute('role', 'group');
        tabRow.setAttribute('aria-label', 'Categories');

        grid = document.createElement('div');
        grid.className = 'objpick-grid';

        stage = document.createElement('div');
        stage.className = 'objpick-stage';
        stage.hidden = true;

        sheet.append(head, tabRow, grid, stage);
        host.append(scrim, sheet);
        document.body.appendChild(host);

        scrim.addEventListener('click', close);
        closeBtn.addEventListener('click', close);
        document.addEventListener('keydown', e => {
            if (!active) return;
            if (e.key === 'Escape') {
                e.stopPropagation();
                e.preventDefault();
                close();
            }
        }, true);
    }

    function cardEl(card) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'objcard' + (card.on ? ' is-on' : '');
        b.setAttribute('aria-pressed', card.on ? 'true' : 'false');

        const tile = document.createElement('span');
        tile.className = 'objcard-tile';
        tile.appendChild(ctx.icon(GLYPHS[card.category] || GLYPHS.all));

        const name = document.createElement('span');
        name.className = 'objcard-name';
        name.textContent = card.name;

        const sub = document.createElement('span');
        sub.className = 'objcard-sub';
        sub.textContent = card.sub || '';

        b.append(tile, name, sub);

        if (card.badge) {
            const badge = document.createElement('span');
            badge.className = 'objcard-badge';
            badge.textContent = card.badge;
            b.appendChild(badge);
        }

        // Real 3D thumbnail through the shared preview hub; the glyph above
        // is the loading state and the permanent fallback when there is no
        // WebGL or the render fails.
        if (ctx.preview && ctx.preview.request) {
            attachPreview(tile, b, card.previewKey || card.key);
        }

        b.addEventListener('click', () => {
            if (ctx.onAction) ctx.onAction(card.action);
            tile.classList.add('is-added');
            setTimeout(() => tile.classList.remove('is-added'), 600);
            // Repaint badges from live state right away; panel.render()
            // refreshes again once the scene sync lands.
            refresh();
        });
        if (ctx.live) ctx.live.buttons.push(b);
        return b;
    }

    // Cached hit paints immediately; a miss observes the card (the tray may
    // be closed and rebuilt often, so the cache does the heavy lifting) and
    // swaps the glyph for the PNG once it renders.
    function attachPreview(tile, btn, pkey) {
        const p = ctx.preview;
        if (typeof p.ok === 'function' && !p.ok()) return;
        // cardEl runs before grid.appendChild, so a cached hit lands while
        // the tile is still detached - only the async path may gate on
        // isConnected (to skip cards the tray discarded meanwhile).
        const paint = url => {
            if (!url) return;
            const img = document.createElement('img');
            img.alt = '';
            img.src = url;
            tile.textContent = '';
            tile.appendChild(img);
        };
        const hit = p.cached(pkey);
        if (hit !== undefined) { paint(hit); return; }
        const io = new IntersectionObserver(entries => {
            if (!entries.some(e => e.isIntersecting)) return;
            io.disconnect();
            Promise.resolve(p.request(pkey)).then(url => {
                if (!url || !tile.isConnected) return;
                paint(url);
            });
        }, { rootMargin: '160px' });
        io.observe(btn);
    }

    function stageEl(row) {
        const card = document.createElement('div');
        card.className = 'objpick-stage-row';
        const name = document.createElement('strong');
        name.textContent = row.name || row.key;
        card.appendChild(name);
        if (ctx.onStageAction) {
            // Placement: X / Height / Depth / Turn, each a number box with
            // hold-to-traverse arrows (panel.js owns the control, so the
            // tray and the shelf behave identically).
            const bar = (label, key, step, min, max) => {
                if (ctx.stepBar) {
                    return ctx.stepBar({
                        label, value: row[key], step, min, max,
                        onChange: v => ctx.onStageAction('place', row, { [key]: v })
                    });
                }
                const w = document.createElement('label');
                w.className = 'objpick-stage-num';
                w.textContent = label;
                const inp = document.createElement('input');
                inp.type = 'number';
                inp.step = String(step);
                inp.value = String(Number(row[key]) || 0);
                inp.addEventListener('change', () => {
                    const v = Number(inp.value);
                    if (!Number.isFinite(v)) return;
                    ctx.onStageAction('place', row, { [key]: v });
                });
                w.appendChild(inp);
                return w;
            };
            card.append(
                bar('X', 'x', 0.25),
                bar('Y', 'y', 0.25, -5, 40),
                bar('Z', 'z', 0.25),
                bar('Turn', 'ry', 1, -180, 180)
            );
            const rm = document.createElement('button');
            rm.type = 'button';
            rm.className = 'objpick-stage-rm';
            rm.textContent = 'Remove';
            rm.title = 'Take this off the stage';
            rm.addEventListener('click', () => {
                ctx.onStageAction('remove', row);
                // Counts, badges and the strip itself all changed.
                refresh();
            });
            if (ctx.live) ctx.live.buttons.push(rm);
            card.appendChild(rm);
        }
        return card;
    }

    function refresh() {
        ensure();
        const { categories, cards } = buildObjectCards(ctx.getCardsInput ? ctx.getCardsInput() : {});
        if (!categories.some(c => c.id === activeCat)) activeCat = 'all';

        tabRow.textContent = '';
        for (const c of categories) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'objtab' + (c.id === activeCat ? ' is-on' : '');
            b.setAttribute('aria-pressed', c.id === activeCat ? 'true' : 'false');
            b.textContent = `${c.label} ${c.count}`;
            b.addEventListener('click', () => {
                activeCat = c.id;
                refresh();
            });
            if (ctx.live) ctx.live.buttons.push(b);
            tabRow.appendChild(b);
        }

        grid.textContent = '';
        const shown = cards.filter(c => activeCat === 'all' || c.category === activeCat);
        if (!shown.length) {
            const empty = document.createElement('p');
            empty.className = 'objpick-empty';
            empty.textContent = 'Nothing here yet.';
            grid.appendChild(empty);
        }
        for (const card of shown) grid.appendChild(cardEl(card));

        const rows = ctx.getStageRows ? (ctx.getStageRows() || []) : [];
        stage.textContent = '';
        stage.hidden = !rows.length;
        if (rows.length) {
            const title = document.createElement('div');
            title.className = 'objpick-stage-title';
            title.textContent = 'On stage';
            stage.appendChild(title);
            for (const row of rows) stage.appendChild(stageEl(row));
        }
    }

    function open() {
        if (active) return;
        ensure();
        lastFocus = document.activeElement;
        active = true;
        refresh();
        host.hidden = false;
        // Raises the project bar above the scrim (TILT.html) so the
        // diagnostics badge on the ⋮ stays reachable while the tray is up.
        document.body.classList.add('objpick-open');
        if (closeBtn) closeBtn.focus({ preventScroll: true });
    }

    function close() {
        if (!active) return;
        active = false;
        if (host) host.hidden = true;
        document.body.classList.remove('objpick-open');
        if (lastFocus && typeof lastFocus.focus === 'function') {
            try { lastFocus.focus({ preventScroll: true }); } catch (e) { /* gone */ }
        }
        lastFocus = null;
    }

    function toggle() {
        if (active) close();
        else open();
        return active;
    }

    return {
        chip,
        open,
        close,
        toggle,
        isOpen: () => active,
        refresh
    };
}
