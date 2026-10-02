/* TILT homepage. Classic script (no modules) so index.html also runs from a
   file:// open, where the API is unreachable and the launch card takes over.
   Everything user-supplied goes in through textContent, never innerHTML. */

(function () {
    'use strict';

    var API = './api/projects';

    var $ = function (id) { return document.getElementById(id); };
    var grid = $('grid');
    var toolbar = $('toolbar');
    var chips = $('chips');
    var count = $('count');
    var empty = $('empty');
    var emptyTitle = $('empty-title');
    var emptyText = $('empty-text');
    var emptyAction = $('empty-action');
    var notice = $('notice');
    var fab = $('fab');
    var scrim = $('scrim');
    var panel = $('panel');
    var toastEl = $('toast');
    var fileInput = $('file');
    var search = $('search');
    var searchInput = $('search-input');
    var barActions = $('bar-actions');

    var state = { projects: [], order: 'recent', query: '' };
    var finishPanel = null;
    var toastTimer = 0;

    // ------------------------------------------------------------- helpers
    function make(tag, className, text) {
        var el = document.createElement(tag);
        if (className) el.className = className;
        if (text !== undefined && text !== null) el.textContent = text;
        return el;
    }

    var ICONS = {
        rename: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
        copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
        download: '<path d="M12 4v12"/><path d="m8 12 4 4 4-4"/><path d="M4 20h16"/>',
        trash: '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/><path d="M9 7V4h6v3"/>',
        close: '<path d="M18 6 6 18M6 6l12 12"/>'
    };

    function icon(name) {
        var host = document.createElement('div');
        host.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICONS[name] + '</svg>';
        return host.firstChild;
    }

    function relativeTime(ts) {
        var s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
        if (s < 45) return 'just now';
        if (s < 3600) return Math.floor(s / 60) + 'm ago';
        if (s < 86400) return Math.floor(s / 3600) + 'h ago';
        if (s < 172800) return 'yesterday';
        var d = new Date(ts);
        var text = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
        return d.getFullYear() !== new Date().getFullYear() ? text + ' ' + d.getFullYear() : text;
    }

    function toast(message) {
        toastEl.textContent = message;
        toastEl.hidden = false;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { toastEl.hidden = true; }, 2400);
    }

    function report(err) {
        console.error('[home]', err);
        toast(err && err.message ? err.message : 'Something went wrong');
    }

    async function api(method, route, body) {
        var res = await fetch(API + (route || ''), {
            method: method,
            headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
            cache: 'no-store'
        });
        if (!res.ok) {
            var detail = '';
            try { detail = ((await res.json()).error) || ''; } catch (e) { /* not json */ }
            throw new Error(detail || ('Request failed (' + res.status + ')'));
        }
        return res.status === 204 ? null : res.json();
    }

    // ------------------------------------------------------- panel (sheet)
    function openPanel(build) {
        return new Promise(function (resolve) {
            var settled = false;
            function done(value) {
                if (settled) return;
                settled = true;
                finishPanel = null;
                panel.hidden = true;
                scrim.hidden = true;
                panel.textContent = '';
                document.removeEventListener('keydown', onKey, true);
                resolve(value);
            }
            function onKey(e) {
                if (e.key === 'Escape') { e.stopPropagation(); done(null); }
            }

            finishPanel = done;
            panel.textContent = '';
            build(panel, done);
            panel.hidden = false;
            scrim.hidden = false;
            document.addEventListener('keydown', onKey, true);

            var focusable = panel.querySelector('input, .btn-primary, .sheet-item');
            if (focusable) {
                focusable.focus();
                if (focusable.select) focusable.select();
            }
        });
    }

    scrim.addEventListener('click', function () { if (finishPanel) finishPanel(null); });

    function grip() { return make('div', 'grip'); }

    function promptName(opts) {
        return openPanel(function (host, done) {
            host.appendChild(grip());
            host.appendChild(make('h2', null, opts.title));

            var input = document.createElement('input');
            input.className = 'field';
            input.type = 'text';
            input.maxLength = 80;
            input.placeholder = opts.placeholder || 'Project name';
            input.value = opts.value || '';
            input.setAttribute('aria-label', opts.title);
            input.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') { e.preventDefault(); done(input.value); }
            });
            host.appendChild(input);

            var actions = make('div', 'actions');
            actions.appendChild(makeBtn('Cancel', 'btn btn-ghost', function () { done(null); }));
            actions.appendChild(makeBtn(opts.confirm || 'Save', 'btn btn-primary',
                function () { done(input.value); }));
            host.appendChild(actions);
        });
    }

    function confirmAction(opts) {
        return openPanel(function (host, done) {
            host.appendChild(grip());
            host.appendChild(make('h2', null, opts.title));
            host.appendChild(make('p', 'hint', opts.message));
            var actions = make('div', 'actions');
            actions.appendChild(makeBtn('Cancel', 'btn btn-ghost', function () { done(false); }));
            actions.appendChild(makeBtn(opts.confirm || 'Confirm', 'btn btn-danger',
                function () { done(true); }));
            host.appendChild(actions);
        });
    }

    function makeBtn(label, className, onClick) {
        var b = make('button', className, label);
        b.type = 'button';
        b.addEventListener('click', onClick);
        return b;
    }

    function chooseAction(project) {
        return openPanel(function (host, done) {
            host.appendChild(grip());

            var head = make('div', 'panel-title-row');
            head.appendChild(make('h2', null, project.name));
            head.appendChild(make('span', null, 'Edited ' + relativeTime(project.updatedAt)));
            host.appendChild(head);

            var list = make('div', 'sheet-list');
            [['rename', 'Rename', 'rename', false],
             ['duplicate', 'Duplicate', 'copy', false],
             ['export', 'Export file', 'download', false],
             ['delete', 'Delete', 'trash', true]].forEach(function (entry) {
                var item = makeBtn(null, 'sheet-item' + (entry[3] ? ' is-danger' : ''),
                    function () { done(entry[0]); });
                item.appendChild(icon(entry[2]));
                item.appendChild(make('span', null, entry[1]));
                list.appendChild(item);
            });
            host.appendChild(list);

            host.appendChild(make('div', 'sheet-divider'));
            host.appendChild(makeBtn('Cancel', 'btn btn-ghost', function () { done(null); }));
        });
    }

    // ----------------------------------------------------------- rendering
    function card(project) {
        var el = make('article', 'card');
        el.addEventListener('click', function () { goTo(project.id); });

        var thumb = make('button', 'thumb');
        thumb.type = 'button';
        thumb.setAttribute('aria-label', 'Open ' + project.name);
        if (project.hasThumb) {
            var img = document.createElement('img');
            img.alt = '';
            img.loading = 'lazy';
            img.src = API + '/' + project.id + '/thumb';
            img.addEventListener('error', function () { img.remove(); });
            thumb.appendChild(img);
        } else {
            thumb.appendChild(make('span', 'ph', (project.name || '?').trim().charAt(0).toUpperCase() || '?'));
        }
        el.appendChild(thumb);

        var meta = make('div', 'meta');
        meta.appendChild(make('h3', null, project.name));
        meta.appendChild(make('p', null, 'Edited ' + relativeTime(project.updatedAt)));
        el.appendChild(meta);

        var menu = make('button', 'menu', '\u22ef');
        menu.type = 'button';
        menu.setAttribute('aria-label', 'Options for ' + project.name);
        menu.addEventListener('click', function (e) {
            e.stopPropagation();
            openCardMenu(project);
        });
        el.appendChild(menu);

        return el;
    }

    function render() {
        var q = state.query.trim().toLowerCase();
        var all = state.projects;
        var shown = q
            ? all.filter(function (p) { return String(p.name || '').toLowerCase().indexOf(q) !== -1; })
            : all;

        grid.textContent = '';
        for (var i = 0; i < shown.length; i++) grid.appendChild(card(shown[i]));

        toolbar.hidden = all.length === 0;
        count.textContent = shown.length
            ? shown.length + (shown.length === 1 ? ' project' : ' projects')
            : '';

        if (!all.length) {
            empty.hidden = false;
            emptyTitle.textContent = 'No projects yet';
            emptyText.textContent = 'Create your first one and it will show up here.';
            emptyAction.hidden = false;
            emptyAction.textContent = 'Create project';
        } else if (!shown.length) {
            empty.hidden = false;
            emptyTitle.textContent = 'No matches';
            emptyText.textContent = 'Nothing matches "' + state.query.trim() + '".';
            emptyAction.hidden = true;
        } else {
            empty.hidden = true;
        }
    }

    async function load() {
        try {
            var data = await api('GET', '?order=' + encodeURIComponent(state.order));
            state.projects = (data && data.projects) || [];
            notice.hidden = true;
        } catch (err) {
            state.projects = [];
            notice.hidden = false;
        }
        render();
    }

    // ------------------------------------------------------------- actions
    function goTo(id) {
        location.href = './TILT.html?p=' + encodeURIComponent(id);
    }

    async function newProject() {
        var name = await promptName({
            title: 'New project',
            placeholder: 'Untitled project',
            confirm: 'Create'
        });
        if (name === null) return;
        try {
            var created = await api('POST', '', { name: name });
            goTo(created.id);
        } catch (err) { report(err); }
    }

    async function renameProject(project) {
        var name = await promptName({
            title: 'Rename project',
            value: project.name,
            confirm: 'Rename'
        });
        if (name === null) return;
        try {
            await api('PATCH', '/' + project.id, { name: name });
            toast('Renamed');
            await load();
        } catch (err) { report(err); }
    }

    async function duplicateProject(project) {
        try {
            await api('POST', '/' + project.id + '/duplicate', {});
            toast('Duplicated');
            await load();
        } catch (err) { report(err); }
    }

    async function deleteProject(project) {
        var sure = await confirmAction({
            title: 'Delete project?',
            message: '"' + project.name + '" and every setting saved in it will be '
                + 'removed. This cannot be undone.',
            confirm: 'Delete'
        });
        if (!sure) return;
        try {
            await api('DELETE', '/' + project.id);
            toast('Deleted');
            await load();
        } catch (err) { report(err); }
    }

    function exportProject(project) {
        var a = document.createElement('a');
        a.href = API + '/' + project.id + '/export';
        a.download = '';
        document.body.appendChild(a);
        a.click();
        a.remove();
        toast('Exporting ' + project.name);
    }

    async function openCardMenu(project) {
        var action = await chooseAction(project);
        if (action === 'rename') return renameProject(project);
        if (action === 'duplicate') return duplicateProject(project);
        if (action === 'export') return exportProject(project);
        if (action === 'delete') return deleteProject(project);
    }

    async function importFile(file) {
        try {
            var text = await file.text();
            var created = await api('POST', '/import', JSON.parse(text));
            toast('Imported ' + created.name);
            goTo(created.id);
        } catch (err) {
            report(err && err.message === 'Unexpected end of JSON input'
                ? new Error('That file is not a TILT project')
                : err);
        } finally {
            fileInput.value = '';
        }
    }

    // ------------------------------------------------------------ controls
    function setTheme(dark) {
        document.documentElement.classList.toggle('dark', dark);
        try { localStorage.setItem('o2tilt-theme', dark ? 'dark' : 'light'); } catch (e) { /* private */ }
    }

    function openSearch() {
        search.hidden = false;
        barActions.hidden = true;
        searchInput.focus();
    }

    function closeSearch() {
        search.hidden = true;
        barActions.hidden = false;
        searchInput.value = '';
        if (state.query) { state.query = ''; render(); }
    }

    $('btn-search').addEventListener('click', openSearch);
    $('search-close').addEventListener('click', closeSearch);
    searchInput.addEventListener('input', function () {
        state.query = searchInput.value;
        render();
    });
    searchInput.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { e.stopPropagation(); closeSearch(); }
    });

    $('btn-theme').addEventListener('click', function () {
        setTheme(!document.documentElement.classList.contains('dark'));
    });

    $('btn-import').addEventListener('click', function () { fileInput.click(); });
    fileInput.addEventListener('change', function () {
        if (fileInput.files && fileInput.files[0]) importFile(fileInput.files[0]);
    });

    $('hero').addEventListener('click', newProject);
    emptyAction.addEventListener('click', newProject);
    fab.addEventListener('click', newProject);

    chips.addEventListener('click', function (e) {
        var btn = e.target.closest ? e.target.closest('[data-order]') : null;
        if (!btn) return;
        state.order = btn.getAttribute('data-order');
        var all = chips.querySelectorAll('[data-order]');
        for (var i = 0; i < all.length; i++) {
            all[i].classList.toggle('is-on', all[i] === btn);
        }
        load();
    });

    window.addEventListener('scroll', function () {
        fab.classList.toggle('is-on', window.scrollY > 240);
    }, { passive: true });

    load();
})();
