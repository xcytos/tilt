import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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

// --------------------------------------------------------------- 5. server
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

const t0 = Date.now();
try {
  let up = false;
  const deadline = Date.now() + 15000;
  while (!up && Date.now() < deadline) {
    try { up = (await fetch(BASE + '/index.html')).ok; } catch { /* not yet */ }
    if (!up) await sleep(100);
  }
  check('the server comes up', up,
    `${Date.now() - t0}ms, exit=${child.exitCode}, log=${JSON.stringify(bootLog.slice(-300))}`);

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
  }
} finally {
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
