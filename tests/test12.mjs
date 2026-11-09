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

// ------------------------------------------------- 1. the files and wiring
console.log('\nmodels page: files exist and stay out of the editor bundle');
check('models.html is present', fs.existsSync(path.join(DECOR, 'models.html')));
check('home/models.css is present', fs.existsSync(path.join(DECOR, 'home', 'models.css')));
check('home/models.js is present', fs.existsSync(path.join(DECOR, 'home', 'models.js')));
check('home/assetlib.js is present', fs.existsSync(path.join(DECOR, 'home', 'assetlib.js')));

const modelsHtml = read('models.html');
const modelsJs = read('home/models.js');
// The preview pipeline moved into the shared hub (used by the editor's
// Objects tray too) - framing/dispose pins now read that source.
const previewJs = read('js/preview.js');
const assetlibSrc = read('home/assetlib.js');
const modelsCss = read('home/models.css');
const serveSrc = read('tools/serve.mjs');
const buildSrc = read('tools/build.mjs');
const indexHtml = read('index.html');

check('the catalog lives outside js/, so test6\'s ORDER walk is untouched',
  !fs.existsSync(path.join(DECOR, 'js', 'assetlib.js'))
  && !fs.existsSync(path.join(DECOR, 'js', 'models.js')));
check('neither page file enters the editor bundle',
  !/home\/models\.js/.test(buildSrc) && !/assetlib/.test(buildSrc)
  && !/models\.html/.test(buildSrc));
check('the homepage links the models page',
  indexHtml.includes('href="./models.html"')
  && indexHtml.includes('<strong>Models</strong>'));
check('the server watches models.html for live reload',
  /'models\.html'/.test(serveSrc));

// --------------------------------------------------------------- 2. markup
console.log('\nmodels page: markup and shell');
check('it is titled for the models library', /<title>Models — TILT<\/title>/.test(modelsHtml));
check('the viewport covers the notch', /viewport-fit=cover/.test(modelsHtml));
check('the stylesheet is local', modelsHtml.includes('href="./home/models.css"'));
check('the script is a module (it drives three.js factories)',
  /<script type="module" src="\.\/home\/models\.js"><\/script>/.test(modelsHtml));
check('it carries the same importmap as the editor',
  /<script type="importmap">/.test(modelsHtml) && /three@0\.160\.0/.test(modelsHtml));
check('the theme is decided before first paint, on the shared key',
  /localStorage\.getItem\('o2tilt-theme'\)/.test(modelsHtml));
check('live reload only runs over http', /EventSource\('\/__events'\)/.test(modelsHtml)
  && /\^https\?\:\$\/\.test\(location\.protocol\)/.test(modelsHtml));
check('search, sort, the type list and the category rail are in the shell',
  ['search-input', 'sort', 'type-chips', 'cat-chips', 'grid', 'empty', 'sheet', 'scrim', 'toast']
    .every(id => modelsHtml.includes(`id="${id}"`)));
check('the lead sentence is gone and sort sits beside the title',
  !modelsHtml.includes('class="lead"')
  && !modelsHtml.includes('classified by what it actually is')
  && /<div class="head-row">\s*<h1>Models<\/h1>[\s\S]{0,200}id="sort"/.test(modelsHtml));
check('sort lives in the head row, not under the sticky filters',
  (() => {
    const filters = /<section class="filters"[\s\S]*?<\/section>/.exec(modelsHtml);
    return !!filters && !filters[0].includes('id="sort"');
  })());
check('the type filter is an option list, not a rail of tabs',
  /<select id="type-chips"/.test(modelsHtml)
  && /createElement\('option'\)/.test(modelsJs)
  && /typeBox\.value = state\.type/.test(modelsJs)
  && !/role="tab"/.test(modelsHtml)
  && !/setAttribute\('role', 'tab'\)/.test(modelsJs));
check('choosing a type refilters like the old chips did',
  /'#type-chips'\)\.addEventListener\('change'/.test(modelsJs)
  && /state\.type = e\.target\.value/.test(modelsJs));
check('the inspect sheet is a labelled dialog',
  modelsHtml.includes('role="dialog"') && modelsHtml.includes('aria-modal="true"'));
check('the palette matches the homepage', /--accent: #0284c7/.test(modelsCss)
  && /--bg: #f4f5f7/.test(modelsCss) && /\.dark\s*\{[^}]*--bg: #0b0b0d/.test(modelsCss));
check('mobile gets the bottom sheet',
  /@media \(max-width: 640px\)/.test(modelsCss) && /slide-up/.test(modelsCss));
check('reduced motion is respected', /prefers-reduced-motion/.test(modelsCss));

// ------------------------------------------------------- 3. the assetlib
console.log('\nasset catalog: classification runs against the real sources');
check('assetlib is pure - no three, no DOM',
  !/from 'three'/.test(assetlibSrc) && !/document\./.test(assetlibSrc)
  && !/window\./.test(assetlibSrc));

// Fixtures mirror home/models.js exactly, but the values come from the real
// files: manifest, module exports, species self-registrations.
const manifestRaw = JSON.parse(read('models/manifest.json'));
const defs = {};
for (const m of manifestRaw.models) {
  const def = JSON.parse(read('models/' + m.file));
  defs[m.id] = {
    objects: (def.objects || []).map(o => ({ type: o.type })),
    elements: (def.objects || []).flatMap(o => (o.elements || []).map(e => ({ type: e.type })))
  };
}
const pillarName = /export const PILLAR_NAME = '([^']+)'/.exec(read('js/objects/pillar.js'))[1];
const pillarSub = /export const PILLAR_SUBTITLE = '([^']+)'/.exec(read('js/objects/pillar.js'))[1];
const panelName = /export const FLOWERPANEL_NAME = '([^']+)'/.exec(read('js/objects/flowerpanel.js'))[1];
const panelSub = /export const FLOWERPANEL_SUBTITLE = '([^']+)'/.exec(read('js/objects/flowerpanel.js'))[1];
const panelParamsBlock = /export const FLOWERPANEL_PARAMS = \{([\s\S]*?)\n\};/.exec(read('js/objects/flowerpanel.js'))[1];
const panelParams = [...panelParamsBlock.matchAll(/^\s{4}(\w+):/gm)].map(m => m[1]);
check('the flowerpanel source exposes its params block', panelParams.includes('enabled'),
  JSON.stringify(panelParams));
const lightSrc = read('js/elements/light.js');
const lightNamesBlock = /export const LIGHT_NAMES = \{([\s\S]*?)\};/.exec(lightSrc)[1];
const lightNames = {};
for (const m of lightNamesBlock.matchAll(/'(light-[a-z]+)':\s*'([^']+)'/g)) lightNames[m[1]] = m[2];

const speciesOf = dir => fs.readdirSync(path.join(DECOR, 'js', dir))
  .filter(f => !['core.js', 'greenery-core.js', 'flower-factory.js', 'greenery-factory.js', 'scene.js'].includes(f))
  .map(f => {
    const src = read('js/' + dir + '/' + f);
    const t = /type:\s*'([a-z-]+)'/.exec(src);
    const l = /label:\s*'([^']+)'/.exec(src);
    return { type: t && t[1], label: l && l[1], file: f };
  });

const flowers = speciesOf('flowers');
const greenery = speciesOf('greenery');
check('species files self-register with a type and label',
  flowers.length === 5 && flowers.every(s => s.type && s.label)
  && greenery.length === 7 && greenery.every(s => s.type && s.label),
  JSON.stringify({ flowers, greenery }));

const { buildCatalog, matchesQuery, filterAssets, facetCounts, ASSET_TYPES } =
  await import(pathToFileURL(path.join(DECOR, 'home', 'assetlib.js')).href);

const catalog = buildCatalog({
  manifest: { entries: manifestRaw.models.map(m => ({ id: m.id, name: m.name, file: m.file, tags: m.tags })), defs },
  types: [
    { type: 'o2tilt-frame', name: 'S Curve Frame', subtitle: '',
      source: { kind: 'file', path: 'js/objects/o2tilt.js' }, params: ['gap', 'pan', 'pitch'] },
    { type: 'pillar', name: pillarName, subtitle: pillarSub,
      source: { kind: 'file', path: 'js/objects/pillar.js' }, params: ['height'] },
    { type: 'flowerpanel', name: panelName, subtitle: panelSub,
      source: { kind: 'file', path: 'js/objects/flowerpanel.js' }, params: panelParams },
    ...Object.keys(lightNames).map(t => ({
      type: t, name: lightNames[t], subtitle: 'Anchor element',
      source: { kind: 'file', path: 'js/elements/light.js' }, params: ['power']
    }))
  ],
  flowers: flowers.map(s => ({ type: s.type, label: s.label })),
  greenery: greenery.map(s => ({ type: s.type, label: s.label }))
});

check('the catalog reports no problems', catalog.problems.length === 0,
  catalog.problems.join('; '));
check('19 assets: 1 model + 6 types + 5 flowers + 7 greenery',
  catalog.assets.length === 19, String(catalog.assets.length));
check('ids are unique', new Set(catalog.assets.map(a => a.id)).size === 19);
check('7 non-empty categories, counts sum to the asset count',
  catalog.categories.length === 7
  && catalog.categories.every(c => c.count > 0)
  && catalog.categories.reduce((n, c) => n + c.count, 0) === 19,
  JSON.stringify(catalog.categories));

const byId = Object.fromEntries(catalog.assets.map(a => [a.id, a]));
check('o2tilt is the complete set, not a bare object',
  byId.o2tilt && byId.o2tilt.assetType === 'model'
  && byId.o2tilt.primaryCategory === 'Sets & Stages'
  && byId.o2tilt.dependencies.includes('o2tilt-frame')
  && byId.o2tilt.dependencies.includes('light-par'));
check('the frame is its own object card beside the set',
  byId['o2tilt-frame'] && byId['o2tilt-frame'].assetType === 'object'
  && byId['o2tilt-frame'].primaryCategory === 'Structures');
check('pillar honours its own "Set component" subtitle',
  byId.pillar && byId.pillar.name === pillarName
  && byId.pillar.assetType === 'component'
  && byId.pillar.primaryCategory === 'Pillars & Columns');
check('flowerpanel is the arrangement object',
  byId.flowerpanel && byId.flowerpanel.assetType === 'object'
  && byId.flowerpanel.primaryCategory === 'Floral Arrangements');
check('the panel card advertises its Enabled knob and is configurable',
  byId.flowerpanel.capabilities && byId.flowerpanel.capabilities.configurable === true
  && Array.isArray(byId.flowerpanel.params) && byId.flowerpanel.params.includes('enabled'),
  JSON.stringify(byId.flowerpanel.params));
check('lights are elements under Lighting',
  Object.keys(lightNames).every(t =>
    byId[t] && byId[t].assetType === 'element'
    && byId[t].primaryCategory === 'Lighting'));
check('every shipped species has its own element card',
  flowers.every(s => byId['flower:' + s.type] && byId['flower:' + s.type].assetType === 'element'
    && byId['flower:' + s.type].name === s.label)
  && greenery.every(s => byId['greenery:' + s.type] && byId['greenery:' + s.type].assetType === 'element'
    && byId['greenery:' + s.type].name === s.label));
check('nothing needs review - every asset matched evidence',
  catalog.assets.every(a => !a.uncertain));
check('byType tallies the four real roles',
  JSON.stringify(catalog.stats.byType) === JSON.stringify(
    [{ type: 'model', count: 1 }, { type: 'object', count: 2 },
     { type: 'element', count: 15 }, { type: 'component', count: 1 }]),
  JSON.stringify(catalog.stats.byType));
check('every def type is covered by a card',
  Object.values(defs).every(d =>
    d.objects.concat(d.elements).every(o => byId[o.type])));
check('search spans names, ids, categories and tags',
  matchesQuery(byId['flower:rose'], 'rose')
  && matchesQuery(byId['light-par'], 'lighting')
  && matchesQuery(byId.o2tilt, 'curtain')
  && !matchesQuery(byId.pillar, 'zzz-nope'));
check('an unknown type degrades to a flagged Objects card', (() => {
  const c = buildCatalog({
    manifest: { entries: [], defs: {} },
    types: [{ type: 'mystery-bracket', name: 'Mystery Bracket', subtitle: '',
              source: { kind: 'file', path: 'js/objects/x.js' }, params: [] }],
    flowers: [], greenery: []
  });
  return c.assets.length === 1 && c.assets[0].uncertain === true
    && c.assets[0].primaryCategory === 'Objects';
})());

// ------------------------------------------------- filter/facet semantics
console.log('\nasset catalog: chips count what a click would really show');
const A = catalog.assets;
check('each type filter alone returns its advertised count',
  filterAssets(A, { type: 'model' }).length === 1
  && filterAssets(A, { type: 'object' }).length === 2
  && filterAssets(A, { type: 'component' }).length === 1
  && filterAssets(A, { type: 'element' }).length === 15);
check('a cross-filter can empty the grid (the bug this guards)',
  filterAssets(A, { type: 'object', category: 'Pillars & Columns' }).length === 0
  && filterAssets(A, { type: 'component', category: 'Lighting' }).length === 0);
check('...but every facet still shows reachable counts to escape it', (() => {
  const f = facetCounts(A, { type: 'component', category: 'Lighting' });
  // Type rail counts under the category filter: Lighting holds 3 elements,
  // so "All assets (3)" is a working way out; Components itself is 0+inert.
  return f.types.all === 3 && f.types.element === 3 && f.types.component === 0
    // Category rail counts under the type filter: Pillars still shows 1.
    && f.categories['Pillars & Columns'] === 1 && !f.categories['Lighting']
    && f.visible === 0;
})());
check('facet counts shrink with the search, never lie',
  facetCounts(A, { query: 'rose' }).types.all === 1
  && facetCounts(A, { query: 'rose' }).categories['Flowers'] === 1
  && facetCounts(A, { type: 'element', query: 'monstera' }).visible === 1
  && facetCounts(A, { query: 'zzz-nothing' }).visible === 0);
check('search alone never empties a matchable query',
  filterAssets(A, { query: 'pillar' }).length === 1
  && filterAssets(A, { query: 'light' }).length === 3);

// ------------------------------------------------------------- 4. the page
console.log('\nmodels page: what home/models.js actually does');
check('it reuses the real registries, not a copied list',
  /from '\.\.\/js\/registry\.js'/.test(modelsJs)
  && /new Registry\('\.\/models'\)/.test(modelsJs)
  && /registry\.loadManifest\(\)/.test(modelsJs)
  && /buildCatalog\(/.test(modelsJs));
check('it registers the same factories app.js does',
  ['createO2TiltModel', 'createPillarModel', 'createFlowerPanelModel', 'createLightModel',
   'FlowerEngine', 'GreeneryEngine'].every(s => modelsJs.includes(s)));
check('it never touches the project API', !/\/api\/projects/.test(modelsJs));
check('dynamic names go in through textContent, never interpolated innerHTML',
  !/innerHTML\s*=`/.test(modelsJs)
  && !/innerHTML\s*=[^\n]*\$\{/.test(modelsJs)
  && (modelsJs.match(/\.textContent\s*=/g) || []).length >= 8);
check('previews render lazily through an IntersectionObserver',
  /new IntersectionObserver/.test(modelsJs) && /enqueuePreview/.test(modelsJs)
  && /from '\.\.\/js\/preview\.js'/.test(modelsJs));
check('preview geometry is disposed after every render',
  /disposeTree\(/.test(modelsJs) && /geometry\.dispose\(\)/.test(previewJs));
check('the GL context is released when the page leaves',
  /pagehide/.test(modelsJs) && /forceContextLoss|dispose\(\)/.test(modelsJs));
check('a dead preview falls back to a labelled placeholder',
  /Preview unavailable/.test(modelsJs));
check('the sheet closes on escape and on the scrim',
  /'Escape'/.test(modelsJs) && /\$\('#scrim'\)\.addEventListener\('click'/.test(modelsJs));
check('chip counts are contextual facets, not global numbers',
  /facetCounts\(/.test(modelsJs) && /filterAssets\(/.test(modelsJs)
  && !/typeCounts\(/.test(modelsJs));
check('an unreachable option or chip is inert, the active one can switch off',
  /o\.disabled = state\.type !== key && n === 0/.test(modelsJs)
  && /b\.disabled = !selected && c\.count === 0/.test(modelsJs)
  && /selected \? 'all' : c\.name/.test(modelsJs));
check('an empty grid offers a way out',
  modelsHtml.includes('id="empty-clear"')
  && /empty-clear/.test(modelsJs) && /function clearFilters\(/.test(modelsJs));
check('the search refilters the chips too, not just the grid',
  /'input'[\s\S]{0,120}renderChips\(\)/.test(modelsJs));

console.log('\nmodels page: the PAR reads big and card clicks open live 3d');
check('the PAR beam cone is kept out of preview framing',
  /userData\.noFraming = true/.test(lightSrc)
  && /function fitBox\(/.test(previewJs) && /noFraming/.test(previewJs));
check('fitting ignores noFraming meshes instead of the whole subtree',
  /!o\.isMesh \|\| !o\.geometry \|\| \(o\.userData && o\.userData\.noFraming\)/.test(previewJs));
check('the inspect sheet mounts a live 3d canvas, not a still image',
  /attachLive\(hero, asset\)/.test(modelsJs)
  && /className = 'sheet-3d'/.test(modelsJs)
  && /drag to rotate/.test(modelsJs)
  && modelsCss.includes('.sheet-3d'));
check('the live preview auto-rotates and accepts a drag',
  /requestAnimationFrame\(liveTick\)/.test(modelsJs)
  && /onLiveMove/.test(modelsJs)
  && /live\.drag/.test(modelsJs));
check('reduced motion draws one frame and only redraws on drag',
  /prefers-reduced-motion/.test(modelsJs)
  && /if \(reduced\) liveDraw\(\)/.test(modelsJs));
check('the live context is torn down on close, reopen and pagehide',
  /function liveStop\(\)/.test(modelsJs)
  && /function closeSheet\(\) \{[\s\S]{0,60}liveStop\(\)/.test(modelsJs)
  && /function openSheet\(asset\) \{[\s\S]{0,60}liveStop\(\)/.test(modelsJs)
  && /pagehide[\s\S]{0,120}liveStop\(\)/.test(modelsJs));
check('a failed live build falls back to the static queued render',
  /staticPreview\(hero, asset\)/.test(modelsJs));
check('the close button stays above the canvas',
  modelsCss.includes('z-index: 3') && /\.sheet-close/.test(modelsCss));

console.log('\nmodels page: card sizes follow the real spans, phones can gesture');
check('preview scale compresses the real span, log-wise, not to one depth',
  /SPAN_MIN = 0\.5, SPAN_MAX = 30/.test(previewJs)
  && /Math\.log\(span \/ SPAN_MIN\) \/ Math\.log\(SPAN_MAX \/ SPAN_MIN\)/.test(previewJs)
  && /FILL_MIN = 0\.65, FILL_MAX = 1/.test(previewJs)
  && !/2\.6 \/ maxDim\)/.test(previewJs));
check('sub-half-foot blooms drop below the light floor, ordered by size',
  /TINY_MIN = 0\.05, TINY_FILL = 0\.2/.test(previewJs)
  && /if \(span >= SPAN_MIN\)/.test(previewJs)
  && /Math\.max\(TINY_MIN, maxDim\)/.test(previewJs)
  && /TINY_FILL \+ \(FILL_MIN - TINY_FILL\) \* t/.test(previewJs));
check('re-framing starts from unit scale, so resize and pinch stay put',
  /group\.scale\.setScalar\(1\);[\s\S]{0,80}fitBox\(group\)/.test(previewJs));
check('two fingers pinch-zoom the live preview, clamped',
  /pinch\.zoom0 \* \(d \/ pinch\.d0\)/.test(modelsJs)
  && /Math\.min\(2\.4, Math\.max\(0\.45,/.test(modelsJs)
  && /function applyZoom\(\)/.test(modelsJs));
check('lifted fingers hand rotation back to the remaining finger',
  /livePts\.size === 1\)/.test(modelsJs) && /live\.drag = \{ x: p\.x, yaw: live\.yaw \}/.test(modelsJs));
check('the canvas refuses to become page scroll or page zoom',
  modelsCss.includes('touch-action: none') && modelsCss.includes('-webkit-tap-highlight-color'));
check('rotating the phone re-fits the preview instead of smearing it',
  /window\.addEventListener\('resize', onLiveResize\)/.test(modelsJs)
  && /window\.removeEventListener\('resize', onLiveResize\)/.test(modelsJs)
  && /function onLiveResize\(\)/.test(modelsJs));
check('the phone sheet gives the preview a squarer stage',
  /\.sheet-hero \{ aspect-ratio: 4 \/ 3; \}/.test(modelsCss)
  && /@media \(max-width: 640px\)/.test(modelsCss));

console.log('\nmodels page: flowers sprig through the real API, uplights aim up');
check('flower cards build through flowers[]/colors[], never the greenery items API',
  /primaryCategory === 'Flowers'\)[\s\S]{0,600}flowers: \[/.test(modelsJs)
  && /seed: 11, colorIndex: 0/.test(modelsJs)
  && /colors: \[new THREE\.Color\(0xe8a4b8\), new THREE\.Color\(0xf6c9d8\)\]/.test(modelsJs));
check('the sprig is compact - blooms about one bloom-width apart',
  /\{ x: 0, y: 0\.08, seed: 11[\s\S]{0,200}\{ x: 0\.3, y: -0\.08[\s\S]{0,200}\{ x: -0\.28, y: -0\.12/.test(modelsJs)
  && !/x: 0\.85, y: 0\.35/.test(modelsJs));
check('floor uplights are built aimed up, not at the ground',
  /'light-par': \{ tilt: -45 \}/.test(previewJs) && /'light-led': \{ tilt: -55 \}/.test(previewJs)
  && /PREVIEW_INIT\[asset\.id\]/.test(modelsJs) && /reg\.factory\(init\)/.test(modelsJs));
check('the phone filter bar is one-line rails, not a wrapped stack',
  /\.chips \{[\s\S]{0,200}flex-wrap: nowrap[\s\S]{0,80}overflow-x: auto/.test(modelsCss)
  && /\.sort > span \{ display: none; \}/.test(modelsCss)
  && /\.type-pick > span \{ display: none; \}/.test(modelsCss)
  && /search input \{ font-size: 16px/.test(modelsCss)
  && !/\.lead \{/.test(modelsCss));

// --------------------------------------------------------------- 5. server
console.log('\nmodels page: served next to the homepage');
const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.on('error', reject);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

const DB = path.join(TMP, 'models-test.db');
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
  check('the server comes up', up,
    `${Date.now() - t0}ms, port=${port}, last=${lastErr}, exit=${child.exitCode}`);

  if (up) {
    const page = await fetch(BASE + '/models.html');
    check('/models.html is served as html', page.status === 200
      && String(page.headers.get('content-type')).includes('text/html'),
      `${page.status} ${page.headers.get('content-type')}`);
    const body = await page.text();
    check('...and it is the models library',
      body.includes('id="grid"') && body.includes('home/models.js'));

    const js = await fetch(BASE + '/home/models.js');
    check('the page script is served as javascript', js.status === 200
      && String(js.headers.get('content-type')).includes('javascript'),
      `${js.status} ${js.headers.get('content-type')}`);
    const lib = await fetch(BASE + '/home/assetlib.js');
    check('the catalog module is served', lib.status === 200
      && String(lib.headers.get('content-type')).includes('javascript'),
      `${lib.status}`);
    const css = await fetch(BASE + '/home/models.css');
    check('the stylesheet is served', css.status === 200
      && String(css.headers.get('content-type')).includes('text/css'),
      `${css.status}`);
    const mf = await fetch(BASE + '/models/manifest.json');
    check('the manifest the page fetches is reachable', mf.status === 200, String(mf.status));
    const home = await fetch(BASE + '/index.html');
    check('the homepage reaches it too', (await home.text()).includes('href="./models.html"'));
  }
} finally {
  globalThis.fetch = nativeFetch;
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
