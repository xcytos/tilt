import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DECOR = path.resolve(HERE, '..');
const TMP = path.join(HERE, '.tmp');
fs.mkdirSync(TMP, { recursive: true });

let fails = 0;
const check = (l, c, x = '') => {
  if (c) console.log('  ok   ' + l);
  else { fails++; console.log('  FAIL ' + l + (x ? '  ' + x : '')); }
};

const read = rel => fs.readFileSync(path.join(DECOR, rel), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const html = read('index.html');
const homeJs = read('home/home.js');
const homeCss = read('home/home.css');
const serveSrc = read('tools/serve.mjs');
const buildSrc = read('tools/build.mjs');
const gitignore = read('.gitignore');

// ------------------------------------------------------------- 1. the files
console.log('\nhomepage: the files exist and stay out of the editor bundle');
check('index.html is present', fs.existsSync(path.join(DECOR, 'index.html')));
check('home/home.js is present', fs.existsSync(path.join(DECOR, 'home', 'home.js')));
check('home/home.css is present', fs.existsSync(path.join(DECOR, 'home', 'home.css')));
check('the homepage script is a classic script, not a module',
  /<script src="\.\/home\/home\.js"><\/script>/.test(html)
  && !/<script[^>]*type="module"/.test(html));
check('the homepage has no bundler entry to add',
  !/home\/home\.js/.test(buildSrc) && !html.includes('js/app.js'));
check('home/ lives outside js/, so test6\'s ORDER walk is untouched',
  !fs.existsSync(path.join(DECOR, 'js', 'home.js')));
check('the editor shell still points at js/app.js',
  read('TILT.html').includes('<script type="module" src="./js/app.js"></script>'));
check('the database directory is ignored', /^data\/$/m.test(gitignore));

// --------------------------------------------------------------- 2. markup
console.log('\nhomepage: markup');
check('it is the document title', /<title>TILT<\/title>/.test(html));
check('the viewport covers the notch', /viewport-fit=cover/.test(html));
check('the stylesheet is local', html.includes('href="./home/home.css"'));
check('no CDN is needed for the entry page', !/cdn\.tailwindcss|unpkg\.com/.test(html));

const ids = ['hero', 'btn-search', 'btn-theme', 'btn-import', 'search', 'search-input',
             'grid', 'toolbar', 'chips', 'count', 'empty', 'empty-action', 'notice',
             'fab', 'scrim', 'panel', 'toast', 'file'];
for (const id of ids) check(`control #${id} exists`, html.includes(`id="${id}"`));

check('three sort orders are offered',
  ['recent', 'oldest', 'name'].every(o => html.includes(`data-order="${o}"`)));
check('the launch card points at the single-file viewer',
  html.includes('href="./TILT.standalone.html"'));
check('the launch card explains the server', /bash serve\.sh/.test(html));
check('import accepts a json file', /id="file"[^>]*accept="application\/json/.test(html)
  || /accept="application\/json[^"]*"[^>]*id="file"/.test(html));
check('every icon-only button is labelled',
  (html.match(/aria-label="/g) || []).length >= 4,
  `${(html.match(/aria-label="/g) || []).length}`);
check('the theme is decided before first paint',
  /localStorage\.getItem\('o2tilt-theme'\)/.test(html));
check('live reload only runs over http', /EventSource\('\/__events'\)/.test(html)
  && /\^https\?\:\$\/\.test\(location\.protocol\)/.test(html));

// ---------------------------------------------------------------- 3. logic
console.log('\nhomepage: home.js');
check('no module syntax - it must run from file://',
  !/^\s*import\b/m.test(homeJs) && !/^\s*export\b/m.test(homeJs));
check('it talks to the project API', homeJs.includes("'./api/projects'"));
check('it asks the server for the sort order', /\?order=' \+ encodeURIComponent\(state\.order\)/.test(homeJs));
check('cards open the editor with the project id',
  /TILT\.html\?p=' \+ encodeURIComponent\(id\)/.test(homeJs));
check('user text goes in through textContent, never innerHTML', (() => {
  const inner = homeJs.match(/\.innerHTML\s*=/g) || [];
  return inner.length <= 2 && !/innerHTML\s*=[^\n]*project\./.test(homeJs);
})());
check('the only innerHTML use is the fixed icon constants', (() => {
  const lines = homeJs.split('\n').filter(l => /\.innerHTML\s*=/.test(l));
  return lines.length === 1 && lines[0].includes('ICONS[')
    && !/innerHTML\s*=[^\n]*project\./.test(homeJs);
})());
check('new, rename, duplicate and delete are all wired', [
  'async function newProject', 'async function renameProject',
  'async function duplicateProject', 'async function deleteProject'
].every(s => homeJs.includes(s)));
check('export downloads through the API', /\/export'/.test(homeJs));
check('import posts to /import', homeJs.includes("'/import'"));
check('deleting asks first', /confirmAction\(\{/.test(homeJs));
check('the search box filters what is already loaded', /state\.query/.test(homeJs));
check('the theme is remembered for the editor', /o2tilt-theme/.test(homeJs)
  && /o2tilt-theme/.test(html));
check('a failed API call shows the launch card instead of a blank page',
  /notice\.hidden = false/.test(homeJs));
check('the empty state adapts to a search with no hits', homeJs.includes("'No matches'"));

// ----------------------------------------------------------------- 4. css
console.log('\nhomepage: home.css');
check('light and dark palettes are declared',
  /:root\s*\{[^}]*--bg:/.test(homeCss) && /\.dark\s*\{[^}]*--bg:/.test(homeCss));
check('the palette matches the editor', homeCss.includes('--accent: #0284c7'));
check('bottom spacing clears the safe area', /env\(safe-area-inset-bottom\)/.test(homeCss));
check('top spacing clears the notch', /env\(safe-area-inset-top\)/.test(homeCss));
check('tap targets are 44px', /--tap: 44px/.test(homeCss)
  && /min-height: var\(--tap\)/.test(homeCss));
check('touch devices get hover-independent affordances',
  /@media \(pointer: coarse\)/.test(homeCss));
check('reduced motion is respected', /prefers-reduced-motion/.test(homeCss));
check('the grid reflows from one column upwards', /minmax\(152px, 1fr\)/.test(homeCss));
check('the action sheet rises from the bottom', /slide-up/.test(homeCss));

// --------------------------------------------------------------- 5. editor
console.log('\nlaunch: version stamp and database backup');
check('serve.sh offers a backup beside start/stop/status/logs', (() => {
  const sh = read('serve.sh');
  return /backup\)/.test(sh) && /tools\/backup\.py/.test(sh)
    && /\[start\|stop\|restart\|status\|logs\|backup\]/.test(sh);
})());
check('the backup copies through sqlite, keeps ten, never opens the live file',
  (() => {
    const py = read('tools/backup.py');
    return /src\.backup\(out\)/.test(py) && /kept\[:-10\]/.test(py)
      && /os\.environ\.get\('DB_PATH'\)/.test(py);
  })());
check('the server announces the same version as the panel',
  /TILT v\$\{VERSION\} serving/.test(serveSrc));

console.log('\neditor: the project bar in TILT.html');
const shell = read('TILT.html');

console.log('\nPWA: installable, offline shell, never the project state');
check('the manifest, worker and icons are on disk', (() => {
  const mf = JSON.parse(read('manifest.webmanifest'));
  return mf.short_name === 'TILT' && mf.start_url === '/TILT.html'
    && mf.icons.some(i => i.sizes === '192x192' && i.type === 'image/png')
    && fs.existsSync(path.join(DECOR, 'sw.js'))
    && fs.existsSync(path.join(DECOR, 'icon-192.png'))
    && fs.existsSync(path.join(DECOR, 'icon-512.png'));
})());
check('the worker caches the shell but never the project state', (() => {
  const sw = read('sw.js');
  return /\/api\//.test(sw) && /project\.json/.test(sw)
    && /caches\.open/.test(sw) && /'\/'/.test(sw);
})());
check('the server serves a webmanifest and watches the PWA files',
  /\.webmanifest/.test(serveSrc) && /'sw\.js'/.test(serveSrc)
  && /icon-192\.png/.test(serveSrc));
check('both pages link the manifest and register the worker',
  /manifest\.webmanifest/.test(html) && /serviceWorker\.register\('\/sw\.js'\)/.test(html)
  && /manifest\.webmanifest/.test(shell) && /serviceWorker\.register\('\/sw\.js'\)/.test(shell));
check('the install prompt is offered and never on file://',
  /beforeinstallprompt/.test(html) && /beforeinstallprompt/.test(shell)
  && /https\?:\$\/\.test\(location\.protocol\)/.test(html));
check('the editor viewport covers the notch too', /viewport-fit=cover/.test(shell));

const appSrc = read('js/app.js');
const projSrc = read('js/project.js');
const editorSrc = read('js/editor.js');
const viewerSrc = read('js/viewer.js');

check('the shell is branded TILT', /<title>TILT<\/title>/.test(shell));
for (const id of ['topbar', 'btn-back', 'project-title', 'project-name',
                  'save-status', 'btn-overflow', 'overflow']) {
  check(`control #${id} exists`, shell.includes(`id="${id}"`));
}
check('icon-only buttons in the bar are labelled',
  shell.includes('id="btn-back" aria-label="Back to projects"')
  && shell.includes('id="btn-overflow" aria-label="Project menu"')
  && shell.includes('id="project-title" aria-label="Rename project"'));
check('the bar clears the notch', /#topbar \{[^}]*env\(safe-area-inset-top\)/.test(shell));
check('the bar buttons are 44px tap targets',
  /\.tb-btn \{[^}]*min-height: 44px/.test(shell) && /#project-title \{[^}]*min-height: 44px/.test(shell));
check('the control panel moves below the bar',
  /\.ui-panel \{[^}]*top: calc\([\d.]+rem \+ env\(safe-area-inset-top\)\)/.test(shell));
check('the menu and the name sheet are styled without a CDN import',
  /#overflow \{/.test(shell) && /#sheet \{/.test(shell));
// The bar carries a backdrop-filter, which per spec makes it a containing
// block for positioned descendants - a popup inside it resolves against the
// bar instead of the viewport and lands where nobody can see it.
check('the popup sits beside the bar, not inside it',
  shell.indexOf('id="overflow"') > shell.indexOf('</header>'));
check('...and is pinned to the screen',
  /#overflow \{[^}]*position: fixed;/.test(shell)
  && /#overflow \{[^}]*env\(safe-area-inset-top\)/.test(shell));
check('...at the bar\'s measured bottom, every time it opens',
  /getBoundingClientRect\(\)\.bottom/.test(editorSrc));
check('a missing control is reported instead of silently dropped',
  /bar controls missing from the shell/.test(editorSrc));

console.log('\neditor: what the app does with a project');
check('the app creates the bar', /import \{ createEditor \} from '\.\/editor\.js'/.test(appSrc)
  && /editor = createEditor\(\{/.test(appSrc));
check('every save carries the camera and the theme',
  /function buildDoc\(\)/.test(appSrc) && /view\.theme = viewer\.isDark/.test(appSrc)
  && /viewer\.getCameraState\(\)/.test(appSrc));
check('the saved camera is restored only after the first framing',
  appSrc.indexOf('await syncScene()') < appSrc.indexOf('viewer.setCameraState'),
  `${appSrc.indexOf('await syncScene()')} vs ${appSrc.indexOf('viewer.setCameraState')}`);
check('leaving the page flushes the last change',
  /addEventListener\('pagehide'/.test(appSrc) && /flushProject\(buildDoc\(\)\)/.test(appSrc));
check('the thumbnail is uploaded after the scene settles',
  /viewer\.captureThumbnail\(\)/.test(appSrc) && /\/thumb`/.test(appSrc)
  && /}, 5000\);/.test(appSrc));
check('renaming goes through the API when a project is open',
  /renameProject\(next\)/.test(appSrc) && /createProject\(/.test(appSrc)
  && /duplicateProject\(\)/.test(appSrc));
check('exporting saves first, so the file matches the screen',
  /onExport: async \(\) => \{ await saveNow\(\); exportDoc\(\); \}/.test(appSrc));

console.log('\neditor: project.js picks a target from the URL');
check('?p= is read once, from location.search', /new URLSearchParams\(location\.search\)/.test(projSrc)
  && /^let target = readTarget\(\);/m.test(projSrc));
check('a named project is saved with PATCH, not POST',
  /method: target \? 'PATCH' : 'POST'/.test(projSrc));
check('the escape hatch uses keepalive, because sendBeacon cannot PATCH',
  /keepalive: true/.test(projSrc) && !/navigator\.sendBeacon\(/.test(projSrc));
check('a 404 detaches the target instead of failing forever',
  /res\.status === 404/.test(projSrc) && /target = null;/.test(projSrc));
check('reset keeps a named project and clears its document',
  /method: target \? 'PATCH' : 'DELETE'/.test(projSrc)
  && /JSON\.stringify\(\{ doc: \{\} \}\)/.test(projSrc));

console.log('\neditor: the bar itself');
check('the menu is built from one list',
  /const MENU = \[/.test(editorSrc) && /act: 'saveas'/.test(editorSrc)
  && /act: 'duplicate'/.test(editorSrc) && /hasProject \?/.test(editorSrc));
check('renaming opens a name sheet', /function promptName\(/.test(editorSrc)
  && /setName\(trimmed\)/.test(editorSrc));
check('actions report failure instead of throwing',
  /catch \(err\)/.test(editorSrc) && /flash\('Could not reach the server'\)/.test(editorSrc));
check('the bar degrades to no-ops if the shell is older',
  /return \{ setName\(\) \{\}, setStatus\(\) \{\}, flash\(\) \{\}, promptName: async \(\) => null \};/
    .test(editorSrc));

console.log('\neditor: the viewer can save and restore a view');
for (const method of ['getCameraState', 'setCameraState', 'captureThumbnail']) {
  check(`${method} exists`, new RegExp(`\\b${method}\\(`).test(viewerSrc));
}
check('the thumbnail is drawn in the same tick as the render',
  /renderer\.render\(this\.scene, this\.camera\);\s*\n\s*const source = this\.renderer\.domElement/
    .test(viewerSrc)
  && /drawImage\(source, 0, 0, w, h\)/.test(viewerSrc));
check('a restored view is written straight through, without damping',
  /setCameraState\(state\) \{/.test(viewerSrc)
  && /this\.controls\.target, state\.target/.test(viewerSrc)
  && /this\.controls\.update\(\);/.test(viewerSrc));

console.log('\neditor: the view gives up space for the sheet');
check('the drawing buffer follows the canvas box, not the window',
  /resize\(\) \{/.test(viewerSrc) && /clientWidth/.test(viewerSrc)
  && /this\.renderer\.setSize\(w, h\)/.test(viewerSrc));
check('...and the box is watched, so it re-fits as the sheet moves',
  /new ResizeObserver\(\(\) => this\.resize\(\)\)/.test(viewerSrc)
  && /_watchBox\.disconnect\(\)/.test(viewerSrc));
check('the sheet height is measured instead of guessed',
  /function syncSheet\(\)/.test(appSrc) && /innerHeight - sheet/.test(appSrc)
  && /getElementById\('ui-panel'\)/.test(appSrc));
check('the canvas follows every change of the sheet',
  /new ResizeObserver\(\(\) => syncSheet\(\)\)/.test(appSrc)
  && /addEventListener\('resize', syncSheet\)/.test(appSrc));
check('the container clips the canvas it owns',
  /#canvas-container \{[^}]*overflow: hidden/.test(shell));

console.log('\neditor: it rides along in the bundle');
const order = /export const ORDER = \[([^\]]*)\]/.exec(buildSrc);
const orderList = order ? order[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')) : [];
check('js/editor.js is bundled', orderList.includes('js/editor.js'), orderList.join(', '));
check('...before the module that uses it',
  orderList.indexOf('js/editor.js') < orderList.indexOf('js/app.js'));
const standalone = read('TILT.standalone.html');
check('the standalone build carries the bar too',
  standalone.includes('id="topbar"') && standalone.includes('createEditor')
  && /<title>TILT<\/title>/.test(standalone));

// -------------------------------------------------------------- 6. mobile
console.log('\nmobile: the editor on a phone');
const media = shell.match(/@media[^{]+\{/g) || [];
check('the shell has breakpoints at all', media.length >= 3, media.length + '');
const sheet = /@media \(max-width: 640px\) \{([\s\S]*?)\n        \}/.exec(shell);
check('there is a phone layout', !!sheet);
if (sheet) {
  const m = sheet[1];
  check('the panel docks to the bottom', /\.ui-panel \{[^}]*top: auto; bottom: 0;/.test(m));
  check('...and spans the full width',
    /\.ui-panel \{[^}]*width: 100%; max-width: none;/.test(m));
  check('...with a sheet-shaped top edge',
    /\.ui-panel \{[^}]*border-radius: 16px 16px 0 0;/.test(m));
  check('the sheet clears the home indicator', /env\(safe-area-inset-bottom\)/.test(m));
  check('the sheet cannot swallow the canvas',
    /\.panel-body \{[^}]*max-height: min\([\d.]+vh,/.test(m));
  check('...and it gives up exactly the space the sheet takes',
    /\.ui-panel::before/.test(m) && /app\.js measures it/.test(shell)
    && /\.panel-body \.flex-1 \{ min-height: 38px; \}/.test(m));
  check('the canvas keeps the top bar clear',
    /#topbar \{[^}]*position: fixed;/.test(shell));
}
const fingers = /@media \(pointer: coarse\) \{([\s\S]*?)\n        \}/.exec(shell);
check('there is a touch layout', !!fingers);
if (fingers) {
  const f = fingers[1];
  check('the collapse button reaches 44px', /min-height: 44px/.test(f));
  check('checkboxes grow', /\.custom-checkbox \{[^}]*height: 1\.5rem/.test(f));
  check('slider thumbs grow and stay centred on the track',
    /::-webkit-slider-thumb \{\s*height: 22px; width: 22px; margin-top: -8px;/.test(f));
}
check('reduced motion is respected',
  /@media \(prefers-reduced-motion: reduce\)/.test(shell));
check('the bundled shell picks all of that up',
  (standalone.match(/@media[^{]+\{/g) || []).length >= media.length,
  `${(standalone.match(/@media[^{]+\{/g) || []).length} vs ${media.length}`);

// ---------------------------------------------------------------- 7. server
console.log('\nhomepage: served at /');
const WATCHED = /const WATCHED = \[([^\]]*)\]/.exec(serveSrc);
const watched = WATCHED ? WATCHED[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')) : [];
check('the shell and the homepage are watched',
  watched.includes('index.html') && watched.includes('home'), watched.join(', '));
check('the database is not watched - that would reload forever',
  !watched.includes('data') && !watched.includes('project.json')
  && !watched.includes('.') && !watched.includes(''), watched.join(', '));
check('a directory resolves to index.html',
  /fs\.statSync\(file\)\.isDirectory\(\)/.test(serveSrc)
  && /index\.html/.test(serveSrc));
check('the private-path guard is in the static path',
  /isPrivate\(pathname\)/.test(serveSrc));

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.on('error', reject);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

const DB = path.join(TMP, 'home-test.db');
const sweep = () => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(DB + suffix); } catch { /* gone */ }
  }
};
sweep();

const port = await freePort();
const child = spawn(process.execPath, [path.join(DECOR, 'tools', 'serve.mjs')], {
  env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), DB_PATH: DB },
  stdio: ['ignore', 'pipe', 'pipe']
});
let bootLog = '';
child.stdout.on('data', d => { bootLog += d; });
child.stderr.on('data', d => { bootLog += d; });
child.on('error', err => { bootLog += 'spawn: ' + err.message; });
const BASE = `http://127.0.0.1:${port}`;
const nativeFetch = globalThis.fetch;

// The editor writes the shared session file when no project is open; leave
// the tree exactly as it was found.
const PROJECT_PATH = path.join(DECOR, 'project.json');
const hadProject = fs.existsSync(PROJECT_PATH);
const projectBackup = hadProject ? fs.readFileSync(PROJECT_PATH) : null;

const t0 = Date.now();
try {
  let up = false;
  let lastErr = '';
  const deadline = Date.now() + 15000;
  while (!up && Date.now() < deadline) {
    try {
      const r = await fetch(BASE + '/index.html');
      lastErr = 'status ' + r.status;
      up = r.ok;
    } catch (err) {
      lastErr = (err.cause && err.cause.code) || err.message;
    }
    if (!up) await sleep(100);
  }
  const heard = /listening on (\S+)/.exec(bootLog);
  check('the server comes up', up,
    `${Date.now() - t0}ms, port=${port}, bound=${heard && heard[1]}, ` +
    `last=${lastErr}, exit=${child.exitCode}`);

  if (up) {
    const root = await fetch(BASE + '/');
    const body = await root.text();
    check('/ serves the homepage', root.status === 200, `${root.status}`);
    check('...as html',
      String(root.headers.get('content-type')).includes('text/html'),
      String(root.headers.get('content-type')));
    check('...and it is the TILT homepage',
      body.includes('id="hero"') && body.includes('home/home.js'));

    const css = await fetch(BASE + '/home/home.css');
    check('the stylesheet is served', css.status === 200
      && String(css.headers.get('content-type')).includes('text/css'),
      `${css.status} ${css.headers.get('content-type')}`);
    const js = await fetch(BASE + '/home/home.js');
    check('the script is served as javascript', js.status === 200
      && String(js.headers.get('content-type')).includes('javascript'),
      `${js.status} ${js.headers.get('content-type')}`);
    check('assets are not cached', String(js.headers.get('cache-control')).includes('no-cache'));

    check('a missing page is still a 404', (await fetch(BASE + '/nope.html')).status === 404);
    check('the database stays private', (await fetch(BASE + '/data/o2tilt.db')).status === 403);

    // The homepage is useless without an API; prove the two are wired.
    const list = await (await fetch(BASE + '/api/projects')).json();
    check('the homepage can list projects', Array.isArray(list.projects));

    // ---------------------------------------------------- the editor's I/O
    console.log('\neditor: js/project.js against that same API');
    const created = await (await fetch(BASE + '/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Editor round trip',
        doc: { mode: 'overlay', activeId: 'o2tilt-arc', overlayIds: ['o2tilt-arc'] }
      })
    })).json();
    check('a project can be created for the editor', !!created.id, JSON.stringify(created));

    const loadModule = async i => import(
      pathToFileURL(path.join(DECOR, 'js', 'project.js')).href + '?i=' + i);

    // The module fetches './api/projects/...' the way a browser does; Node
    // only accepts absolute URLs, so resolve the relative ones for it.
    const realFetch = globalThis.fetch;
    const siteFetch = (url, init) => realFetch(
      /^https?:/.test(String(url)) ? String(url) : new URL(String(url), BASE).href,
      init);
    globalThis.fetch = siteFetch;
    // ...and there is no browser storage here, which is what the mirror
    // checks for. Remove the accessor so nothing reads it and warns.
    delete globalThis.localStorage;
    globalThis.location = { protocol: 'http:', search: '?p=' + created.id };
    const named = await loadModule(1);
    check('?p= selects the project to open', named.projectId() === created.id,
      String(named.projectId()));

    const opened = await named.loadProject();
    check('the editor boots into that project',
      !!opened && opened.mode === 'overlay' && opened.activeId === 'o2tilt-arc'
      && opened.name === 'Editor round trip',
      JSON.stringify(opened && { mode: opened.mode, activeId: opened.activeId }));

    const wrote = await named.saveProject({
      version: 2, name: 'Editor round trip', mode: 'single',
      activeId: 'o2tilt-classic', mounted: ['o2tilt-classic'], overlayIds: [],
      presets: { 'o2tilt-classic': { gap: 3 } }
    });
    check('an autosave reaches the database', wrote === true, String(wrote));
    const afterSave = await (await fetch(BASE + '/api/projects/' + created.id)).json();
    check('...and the document really changed',
      afterSave.doc.mode === 'single'
      && afterSave.doc.presets['o2tilt-classic'].gap === 3,
      JSON.stringify(afterSave.doc));
    check('saving the document never renames the project',
      afterSave.name === 'Editor round trip', afterSave.name);

    const sent = [];
    globalThis.fetch = (url, init) => {
      sent.push([(init && init.method) || 'GET', !!(init && init.keepalive), String(url)]);
      return Promise.resolve({ ok: true });
    };
    named.flushProject({ version: 2, mode: 'single', activeId: 'o2tilt-classic' });
    globalThis.fetch = siteFetch;
    check('the leaving write is a keepalive PATCH',
      sent.length === 1 && sent[0][0] === 'PATCH' && sent[0][1] === true,
      JSON.stringify(sent));

    await named.clearProject();
    const afterReset = await (await fetch(BASE + '/api/projects/' + created.id)).json();
    check('a reset empties the document but keeps the project',
      afterReset.doc.mode === 'single'
      && !Object.keys(afterReset.doc.presets).length
      && afterReset.name === 'Editor round trip',
      JSON.stringify(afterReset.doc));

    // A URL for a project that has since been deleted.
    globalThis.location = { protocol: 'http:', search: '?p=gone404' };
    const orphan = await loadModule(2);
    const fallback = await orphan.loadProject();
    check('a vanished project is reported, not silently reused',
      orphan.loadNotice() === 'missing' && orphan.projectId() === null
      && fallback !== undefined,
      `${orphan.loadNotice()} / ${orphan.projectId()}`);
    check('...and the editor detaches to the local session',
      await orphan.saveProject({ version: 2, mode: 'single' }) === true);

    // No project at all: the shared session file, as a file:// open uses it.
    globalThis.location = { protocol: 'http:', search: '' };
    const bare = await loadModule(3);
    const session = await bare.loadProject();
    check('without ?p= the module falls back to the session file',
      bare.projectId() === null && bare.loadNotice() === ''
      && (session === null || typeof session === 'object'),
      `${bare.projectId()} / ${bare.loadNotice()}`);
  }
} finally {
  globalThis.fetch = nativeFetch;
  delete globalThis.location;
  delete globalThis.localStorage;
  if (hadProject) fs.writeFileSync(PROJECT_PATH, projectBackup);
  else if (fs.existsSync(PROJECT_PATH)) fs.unlinkSync(PROJECT_PATH);
  child.kill('SIGTERM');
  const exited = await Promise.race([
    new Promise(r => child.once('exit', () => r(true))),
    sleep(3000).then(() => child.exitCode !== null)
  ]);
  if (!exited) {
    fails++;
    console.log('  FAIL the spawned server outlived SIGTERM');
    child.kill('SIGKILL');
  }
  sweep();
}

console.log(fails === 0 ? '\nALL CHECKS PASSED' : `\n${fails} CHECK(S) FAILED`);
process.exit(fails ? 1 : 0);
