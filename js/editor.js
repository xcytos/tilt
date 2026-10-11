// The project chrome: the bar across the top of the editor with the back
// button, the project name, the save status and the overflow menu. It owns
// DOM only - every action is a callback, so app.js keeps the scene logic.

export function createEditor(opts) {
    const {
        hasProject = false,
        name = '',
        onHome, onSave, onRename, onDuplicate, onExport, onSaveAs, onReset,
        onToggleTheme, isDark: isDark0 = false
    } = opts || {};
    let isDark = isDark0;

    const bar = document.getElementById('topbar');
    const back = document.getElementById('btn-back');
    const more = document.getElementById('btn-overflow');
    const titleBtn = document.getElementById('project-title');
    const nameEl = document.getElementById('project-name');
    const statusEl = document.getElementById('save-status');
    const menuEl = document.getElementById('overflow');

    // An older shell without the bar must not break the editor - but the
    // silent fallback is worth a shout in the console, because a missing id
    // here means the ⋮ button has no listener at all.
    if (!bar || !back || !more || !titleBtn || !nameEl || !statusEl || !menuEl) {
        const missing = { topbar: bar, 'btn-back': back, 'btn-overflow': more,
            'project-title': titleBtn, 'project-name': nameEl,
            'save-status': statusEl, overflow: menuEl };
        console.error('[editor] bar controls missing from the shell:',
            Object.keys(missing).filter(k => !missing[k]).join(', '));
        if (typeof window !== 'undefined') {
            window.__tiltWired = 'stub: missing '
                + Object.keys(missing).filter(k => !missing[k]).join(', ');
        }
        return { setName() {}, setStatus() {}, flash() {}, promptName: async () => null, setTheme() {} };
    }

    const STATUS_TEXT = { saving: 'Saving…', saved: 'Saved', offline: 'Offline' };

    let currentName = name || 'Untitled project';
    let state = 'saved';
    let flashTimer = 0;
    let menuOpen = false;
    let sheetHost = null;

    nameEl.textContent = currentName;
    statusEl.textContent = STATUS_TEXT[state];

    function setStatus(next) {
        if (!STATUS_TEXT[next]) return;
        state = next;
        clearTimeout(flashTimer);
        statusEl.dataset.state = next;
        statusEl.textContent = STATUS_TEXT[next];
    }

    // A short-lived message in the status line - used for confirmations that
    // have nowhere else to go, like "Duplicated".
    function flash(text) {
        clearTimeout(flashTimer);
        statusEl.dataset.state = 'note';
        statusEl.textContent = text;
        flashTimer = setTimeout(() => {
            statusEl.dataset.state = state;
            statusEl.textContent = STATUS_TEXT[state];
        }, 2600);
    }

    function setName(next) {
        currentName = (next && String(next).trim()) || currentName;
        nameEl.textContent = currentName;
    }

    // ------------------------------------------------------------ the menu
        const MENU = [
            { act: 'save', label: 'Save now' },
            { act: 'rename', label: 'Rename' },
            hasProject ? { act: 'duplicate', label: 'Duplicate' } : null,
            { act: 'export', label: 'Export file' },
            !hasProject ? { act: 'saveas', label: 'Save as project' } : null,
            { sep: true },
            { act: 'theme', label: isDark ? 'Dark mode: On' : 'Dark mode: Off' },
            { act: 'reset', label: 'Reset to defaults', danger: true },
            { act: 'home', label: 'All projects' }
        ];

    function closeMenu() {
        if (!menuOpen) return;
        menuOpen = false;
        menuEl.hidden = true;
        menuEl.textContent = '';
        more.setAttribute('aria-expanded', 'false');
    }

    function openMenu() {
        if (menuOpen) return closeMenu();
        menuEl.textContent = '';
        for (const item of MENU) {
            if (!item) continue;
            if (item.sep) {
                const sep = document.createElement('div');
                sep.className = 'menu-sep';
                menuEl.appendChild(sep);
                continue;
            }
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'menu-item' + (item.danger ? ' is-danger' : '');
            btn.textContent = item.label;
            btn.addEventListener('click', () => { closeMenu(); void run(item.act); });
            menuEl.appendChild(btn);
        }
        // The popup is fixed to the screen, so pin it to the bar's real
        // bottom rather than trusting a CSS guess at the bar's height.
        const barBottom = bar.getBoundingClientRect().bottom;
        if (barBottom) menuEl.style.top = `${Math.round(barBottom + 4)}px`;
        menuEl.hidden = false;
        menuOpen = true;
        more.setAttribute('aria-expanded', 'true');
    }

    // ------------------------------------------------------- the name sheet
    function promptName(current) {
        return new Promise(resolve => {
            const scrim = document.createElement('div');
            scrim.id = 'sheet';
            const card = document.createElement('div');
            card.className = 'sheet-card';

            const heading = document.createElement('h2');
            heading.textContent = 'Rename project';
            card.appendChild(heading);

            const input = document.createElement('input');
            input.id = 'sheet-input';
            input.type = 'text';
            input.maxLength = 80;
            input.placeholder = 'Project name';
            input.value = current || '';
            input.setAttribute('aria-label', 'Project name');
            card.appendChild(input);

            const actions = document.createElement('div');
            actions.className = 'sheet-actions';
            const make = (label, primary) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = primary ? 'btn primary' : 'btn';
                b.textContent = label;
                actions.appendChild(b);
                return b;
            };
            const cancel = make('Cancel', false);
            const ok = make('Rename', true);
            card.appendChild(actions);
            scrim.appendChild(card);

            let done = false;
            const finish = value => {
                if (done) return;
                done = true;
                document.removeEventListener('keydown', onKey, true);
                scrim.remove();
                sheetHost = null;
                resolve(value);
            };
            const onKey = e => {
                if (e.key === 'Escape') { e.stopPropagation(); finish(null); }
            };

            cancel.addEventListener('click', () => finish(null));
            ok.addEventListener('click', () => finish(input.value));
            input.addEventListener('keydown', e => {
                if (e.key === 'Enter') { e.preventDefault(); finish(input.value); }
            });
            scrim.addEventListener('click', e => { if (e.target === scrim) finish(null); });

            document.addEventListener('keydown', onKey, true);
            document.body.appendChild(scrim);
            sheetHost = scrim;
            input.focus();
            input.select();
        });
    }

    // ------------------------------------------------------------- actions
    async function run(act) {
        try {
            if (act === 'home' || act === 'back') return void (onHome && onHome());
            if (act === 'save') return void (onSave && onSave());
            if (act === 'export') return void (onExport && onExport());
            if (act === 'reset') return void (onReset && onReset());
            if (act === 'theme') {
                isDark = !isDark;
                onToggleTheme && onToggleTheme(isDark);
                return;
            }

            if (act === 'rename') {
                const next = await promptName(currentName);
                if (next === null || !onRename) return;
                const trimmed = next.trim();
                if (!trimmed || trimmed === currentName) return;
                const saved = await onRename(trimmed);
                if (saved !== false) setName(trimmed);
                return;
            }

            if (act === 'duplicate' && onDuplicate) {
                const copy = await onDuplicate();
                if (copy && copy.name) flash('Copied to "' + copy.name + '"');
                return;
            }

            if (act === 'saveas' && onSaveAs) {
                flash('Saving…');
                await onSaveAs();
                return;
            }
        } catch (err) {
            console.error('[editor]', err);
            flash('Could not reach the server');
        }
    }

    back.addEventListener('click', () => { closeMenu(); onHome && onHome(); });
    more.addEventListener('click', e => { e.stopPropagation(); openMenu(); });
    titleBtn.addEventListener('click', e => { e.stopPropagation(); closeMenu(); void run('rename'); });

    document.addEventListener('click', e => {
        if (!menuOpen) return;
        if (menuEl.contains(e.target) || more.contains(e.target)) return;
        closeMenu();
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && menuOpen && !sheetHost) closeMenu();
    });

    setStatus('saved');

    // Only now that every listener is on: the self-check reads this as
    // "the bar answers", and an early flag would claim it before it is true.
    if (typeof window !== 'undefined') window.__tiltWired = true;

    function setTheme(dark) { isDark = !!dark; }

    return { setName, setStatus, flash, promptName, setTheme };
}
