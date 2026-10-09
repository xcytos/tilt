import fs from 'node:fs';
import net from 'node:net';
import http from 'node:http';
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

// ------------------------------------------------- 1. the project file format
console.log('\nproject file: parsing');
const proj = await import(pathToFileURL(path.join(DECOR, 'js/project.js')).href);

check('nothing to parse is not a project', proj.parseProject(null) === null);
check('invalid JSON is not a project', proj.parseProject('{ nope') === null);
check('an array is not a project', proj.parseProject('[]') === null);
check('an empty document still yields a usable project', (() => {
  const p = proj.parseProject('{}');
  return p && p.mode === 'single' && p.activeId === null && p.mounted.length === 0
    && p.overlayIds.length === 0 && Object.keys(p.presets).length === 0;
})());

check('junk fields are filtered out', (() => {
  const p = proj.parseProject(JSON.stringify({
    mode: 'banana',
    activeId: 42,
    mounted: ['a', 3, '', 'b'],
    overlayIds: ['b', null, 'a'],
    presets: {
      good: { x: 1, y: 'text', z: Infinity, w: true },
      bad: 'not an object',
      worse: [1, 2]
    }
  }));
  return p.mode === 'single'
    && p.activeId === null
    && p.mounted.join(',') === 'a,b'
    && p.overlayIds.join(',') === 'b,a'
    && JSON.stringify(p.presets.good) === JSON.stringify({ x: 1, w: true })
    && Object.keys(p.presets).length === 1;
})());

check('overlay mode survives a round trip through JSON', (() => {
  const p = proj.parseProject(proj.projectToJSON({
    version: 1, mode: 'overlay', activeId: 'o2tilt-arc',
    mounted: ['o2tilt-classic', 'o2tilt-arc'], overlayIds: ['o2tilt-arc'],
    presets: { 'o2tilt-arc': { gap: 3.5 } }
  }));
  return p.mode === 'overlay' && p.activeId === 'o2tilt-arc'
    && p.mounted.length === 2 && p.presets['o2tilt-arc'].gap === 3.5;
})());

check('a scene choice survives a round trip through JSON', (() => {
  const p = proj.parseProject(proj.projectToJSON({ scene: 'white-stage', name: 'S' }));
  return p.scene === 'white-stage';
})());
check('an unknown or hostile scene id is dropped', (() => {
  const junk = proj.parseProject(JSON.stringify({ scene: '../../etc/passwd' }));
  const wrongType = proj.parseProject(JSON.stringify({ scene: 42 }));
  const missing = proj.parseProject('{}');
  return junk.scene === null && wrongType.scene === null && missing.scene === null;
})());

console.log('\nproject file: the SET the set is staged in');
const layouts = await import(pathToFileURL(path.join(DECOR, 'js/layouts.js')).href);

check('a set survives a round trip through JSON',
  proj.parseProject(proj.projectToJSON({ layout: 'cross-flow' })).layout === 'cross-flow');
check('an unknown set is dropped',
  proj.parseProject(JSON.stringify({ layout: 'not-a-set' })).layout === null
  && proj.parseProject('{}').layout === null);
check('every set has at least two frames on finite ground', layouts.LAYOUTS.every(l =>
  l.placements.filter(p => p.kind === 'frame').length >= 2
  && l.placements.filter(p => p.kind === 'frame')
    .every(p => [p.x, p.z, p.ry].every(Number.isFinite))));
check('set ids are unique', new Set(layouts.LAYOUT_IDS).size === layouts.LAYOUT_IDS.length,
  layouts.LAYOUT_IDS.join(', '));
check('sets stage frames only - pillars are yours to add, not the drawing',
  layouts.LAYOUTS.every(l => l.placements.every(p => p.kind === 'frame')));
check('frame slots stand clear of one another (an O2 spans gap+24 ft)',
  layouts.LAYOUTS.every(l => {
    const f = l.placements.filter(p => p.kind === 'frame');
    if (f.length < 2) return true;
    for (let i = 0; i < f.length; i++) {
      for (let j = i + 1; j < f.length; j++) {
        if (Math.abs(f[i].x - f[j].x) < 30 && Math.abs(f[i].z - f[j].z) < 8) return false;
      }
    }
    return true;
  }));
check('the pillar count, its lock, its place and your placements survive', (() => {
  const doc = proj.parseProject(proj.projectToJSON({
    layout: 'classic-symmetry', pillars: 2, lock: false, place: 'inner',
    places: { pillar: [{ x: 4, z: 2, ry: 0 }, { x: -4, z: 2, ry: 0 }] },
    mirror: { pillar: true }
  }));
  const fresh = proj.parseProject('{}');
  const odd = proj.parseProject(JSON.stringify({ place: 'sideways' }));
  return doc.layout === 'classic-symmetry' && doc.pillars === 2
    && doc.lock === false && doc.mirror.pillar === true
    && doc.place === 'inner'
    && doc.places.pillar[1].x === -4
    && fresh.pillars === 0 && fresh.lock === true && fresh.place === 'outer'
    && odd.place === 'outer';
})());
check('the pillar count is clamped to a pair',
  proj.parseProject(JSON.stringify({ pillars: 9 })).pillars === 2
  && proj.parseProject(JSON.stringify({ pillars: -3 })).pillars === 0
  && proj.parseProject(JSON.stringify({ pillars: 'x' })).pillars === 0);
check('a hostile placement is cleaned, not trusted', (() => {
  const bad = proj.parseProject(JSON.stringify({
    places: { pillar: [{ x: 1e9, z: 'no', ry: 5 }, 'junk'], 'a"; drop': [{ x: 1 }] }
  }));
  return bad.places.pillar[0].x === 300 && bad.places.pillar[0].z === 0
    && bad.places.pillar[1] === null && !('a"; drop' in bad.places);
})());

console.log('\nproject file: applying saved values to a model');
const schema = {
  gap: { key: 'gap', name: 'Gap', type: 'range', min: 0, max: 10, default: 2 },
  dark: { key: 'dark', name: 'Dark', type: 'toggle', default: false },
  shape: { key: 'shape', name: 'Shape', type: 'choice', options: ['a', 'b'], default: 'a' }
};
const freshState = () => ({ gap: 2, dark: false, shape: 'a' });

check('a saved range value is applied', (() => {
  const s = freshState();
  return proj.applySaved(s, schema, { gap: 7 }) === true && s.gap === 7;
})());
check('a saved range value is clamped to its schema', (() => {
  const hi = freshState(), lo = freshState();
  proj.applySaved(hi, schema, { gap: 99 });
  proj.applySaved(lo, schema, { gap: -5 });
  return hi.gap === 10 && lo.gap === 0;
})());
check('a saved toggle value is applied', (() => {
  const s = freshState();
  return proj.applySaved(s, schema, { dark: true }) === true && s.dark === true;
})());
check('keys the schema does not know are ignored', (() => {
  const s = freshState();
  return proj.applySaved(s, schema, { nope: 1, gap: 4 }) === true && !('nope' in s) && s.gap === 4;
})());
check('a value of the wrong type is refused', (() => {
  const s = freshState();
  const a = proj.applySaved(s, schema, { gap: 'wide' });
  const b = proj.applySaved(s, schema, { dark: 'yes' });
  return a === false && b === false && s.gap === 2 && s.dark === false;
})());
check('an unchanged value reports no change', (() => {
  const s = freshState();
  return proj.applySaved(s, schema, { gap: 2 }) === false;
})());
check('unsupported value types are left alone', (() => {
  const s = freshState();
  return proj.applySaved(s, schema, { shape: 'b' }) === false && s.shape === 'a';
})());
check('nothing saved reports no change',
  proj.applySaved(freshState(), schema, {}) === false
  && proj.applySaved(freshState(), schema, null) === false);
check('two saved values land together', (() => {
  const s = freshState();
  proj.applySaved(s, schema, { gap: 4.5, dark: true });
  return s.gap === 4.5 && s.dark === true;
})());

console.log('\nproject file: loading without a browser');
check('no window means no project, not a crash', await proj.loadProject() === null);

// ---------------------------------------------------- 2. live reload + POSTs
console.log('\nserve.mjs: live reload and the project endpoint');
const PROJECT_PATH = path.join(DECOR, 'project.json');
const hadProject = fs.existsSync(PROJECT_PATH);
const projectBackup = hadProject ? fs.readFileSync(PROJECT_PATH) : null;
const PROBE = path.join(DECOR, 'models', '.reload-probe');

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

function rawRequest(port, method, urlPath) {
  return new Promise(resolve => {
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', err => resolve({ status: 0, body: err.message }));
    req.end();
  });
}

const port = await freePort();
const child = spawn(process.execPath, [path.join(DECOR, 'tools', 'serve.mjs')], {
  env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe']
});
let serverLog = '';
child.stdout.on('data', d => { serverLog += d; });
child.stderr.on('data', d => { serverLog += d; });

const BASE = `http://127.0.0.1:${port}`;
let sse = null;

async function waitForServer(ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(BASE + '/TILT.html');
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await sleep(100);
  }
  return false;
}

try {
  const up = await waitForServer();
  check('server comes up on a free port', up, serverLog.trim().split('\n').pop());

  if (up) {
    const shell = await fetch(BASE + '/TILT.html');
    check('serves the shell', shell.status === 200
      && String(shell.headers.get('content-type')).includes('text/html'));
    const mod = await fetch(BASE + '/js/app.js');
    check('serves modules as javascript',
      mod.status === 200 && String(mod.headers.get('content-type')).includes('javascript'));
    check('marks assets no-cache',
      String(mod.headers.get('cache-control')).includes('no-cache'));
    check('assets are never stored, or the browser replays stale modules',
      String(mod.headers.get('cache-control')).includes('no-store') && !!mod.headers.get('etag'),
      `cache-control=${mod.headers.get('cache-control')} etag=${mod.headers.get('etag')}`);
    const revalidate = await fetch(BASE + '/js/app.js',
      { headers: { 'If-None-Match': mod.headers.get('etag') } });
    check('an unchanged asset answers 304', revalidate.status === 304,
      `got ${revalidate.status}`);
    const missing = await fetch(BASE + '/definitely-not-here.html');
    check('a missing file is a 404', missing.status === 404);
    const escape = await rawRequest(port, 'GET', '/x%2f..%2f..%2fetc/passwd');
    check('path traversal is refused', escape.status === 403, `got ${escape.status}`);

    // --- SSE
    const ctrl = new AbortController();
    const events = await fetch(BASE + '/__events', { signal: ctrl.signal });
    check('live reload speaks text/event-stream',
      String(events.headers.get('content-type')).includes('text/event-stream'));
    check('live reload is not cached',
      String(events.headers.get('cache-control')).includes('no-cache'));

    const reader = events.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let gotReload = false;
    const pump = (async () => {
      while (!gotReload) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        if (buf.includes('data: reload')) gotReload = true;
      }
    })();
    pump.catch(() => {});

    await sleep(400);
    const started = Date.now();
    fs.writeFileSync(PROBE, 'reload probe');
    await Promise.race([pump, sleep(5000)]);
    check('editing models/ pushes a reload event', gotReload,
      `${Date.now() - started}ms`);
    if (fs.existsSync(PROBE)) fs.unlinkSync(PROBE);
    ctrl.abort();

    // --- project.json over HTTP
    const body = JSON.stringify({
      version: 1, mode: 'overlay', activeId: 'o2tilt-slope',
      overlayIds: ['o2tilt-slope'], presets: { 'o2tilt-slope': { gap: 4 } }
    }, null, 2);

    const post = await fetch(BASE + '/project.json', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body
    });
    check('POST writes the project', post.status === 200, `got ${post.status}`);
    check('the project really landed on disk',
      fs.existsSync(PROJECT_PATH) && fs.readFileSync(PROJECT_PATH, 'utf8') === body);

    const get = await fetch(BASE + '/project.json');
    check('GET reads it back', get.status === 200 && (await get.text()) === body);

    const del = await fetch(BASE + '/project.json', { method: 'DELETE' });
    check('DELETE clears it', del.status === 204, `got ${del.status}`);
    check('the file is gone', !fs.existsSync(PROJECT_PATH));
    const gone = await fetch(BASE + '/project.json');
    check('GET after DELETE is a 404', gone.status === 404, `got ${gone.status}`);

    const put = await rawRequest(port, 'PUT', '/project.json');
    check('an unsupported method is a 405', put.status === 405, `got ${put.status}`);

    const huge = await fetch(BASE + '/project.json', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: 'x'.repeat(200 * 1024)
    });
    check('an oversized project is refused', huge.status === 413, `got ${huge.status}`);
    check('the refused write did not leave a file', !fs.existsSync(PROJECT_PATH));

    const saving = await fetch(BASE + '/project.json', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body
    });
    check('saving again still works', saving.status === 200, `got ${saving.status}`);
    fs.unlinkSync(PROJECT_PATH);
  }
} finally {
  try { if (fs.existsSync(PROBE)) fs.unlinkSync(PROBE); } catch { /* ignore */ }
  try {
    if (hadProject) fs.writeFileSync(PROJECT_PATH, projectBackup);
    else if (fs.existsSync(PROJECT_PATH)) fs.unlinkSync(PROJECT_PATH);
  } catch { /* ignore */ }
  child.kill('SIGTERM');
  await Promise.race([new Promise(r => child.once('exit', r)), sleep(2000)]);
}

// ------------------------------------------------------------- 3. the wiring
console.log('\nwiring: the app restores and rewrites the project');
const app = read('js/app.js');
const panel = read('js/panel.js');
const shell = read('TILT.html');
const build = read('tools/build.mjs');
const server = read('tools/serve.mjs');

check('app reads the project module',
  /from '\.\/project\.js'/.test(app) && /\bloadProject\b/.test(app));
check('app keeps a per-preset store of saved values',
  /const savedPresets = \{\};/.test(app));
check('app writes on a debounce, not on every drag', /function scheduleSave\(\)/.test(app)
  && /setTimeout\(\(\) => \{/.test(app) && /void commit\(\);/.test(app)
  && /async function commit\(\)[\s\S]{0,400}saveProject\(/.test(app));
// Clearing `dirty` before the PATCH is known to have landed leaves the
// leaving flush with nothing to retry, which is how a project silently
// kept its old display type and controls.
check('a failed write keeps the project dirty for the leaving flush',
  /async function commit\(\)\s*\{[\s\S]{0,600}?if \(!ok\) dirty = true;/.test(app));
check('boot restores the project before the first sync',
  /await loadProject\(\)/.test(app)
  && app.indexOf('await loadProject()') < app.indexOf('await syncScene()'));
check('restored values are clamped against the schema', /applySaved\(m\.state, m\.params/.test(app));
check('saved values are kept when the panel changes a control',
  /savedPresets\[m\.id\] = Object\.assign/.test(app));
check('every project-changing action schedules a save', (app.match(/scheduleSave\(\);/g) || []).length >= 4,
  `${(app.match(/scheduleSave\(\);/g) || []).length}`);
check('mounting, mode switches and selection all save',
  /async function activate\([\s\S]*?scheduleSave\(\)/.test(app)
  && /async function setMode\([\s\S]*?scheduleSave\(\)/.test(app)
  && /async function toggleOverlay\([\s\S]*?scheduleSave\(\)/.test(app));
check('app can reset the project',
  /async function resetProject\(\)/.test(app) && /clearProject\(\)/.test(app)
  && /onReset: guard\(/.test(app));
check('a reset repaints the panel',
  /return syncScene\(true\);/.test(app) && /forcePanel/.test(app));
check('the project is exposed for inspection', /resetProject/.test(app)
  && /get savedPresets\(\)/.test(app));

console.log('\nwiring: the scene the set stands in');
check('scenes.js is in the build order', /'js\/scenes\.js'/.test(build));
check('app carries the scene choice into the document',
  /scene: sceneId/.test(app) && /let sceneId = DEFAULT_SCENE;/.test(app));
check('the viewer swaps the world, not the models', /viewer\.setScene\(id\)/.test(app));
check('the panel gets the scene list and the callback',
  /scenes: SCENES/.test(app) && /onSceneChange: guard\(/.test(app));
check('the panel renders a scene picker', /param-scene/.test(panel)
  && /onSceneChange/.test(panel));
check('the viewer falls back to the studio', /isScene\(id\) \? id : DEFAULT_SCENE/.test(read('js/viewer.js')));

console.log('\nwiring: the SET the project is staged as');
check('layouts.js and pillar.js are in the build order',
  /'js\/layouts\.js'/.test(build) && /'js\/objects\/pillar\.js'/.test(build));
check('app carries the set into the document', /layout: layoutId/.test(app));
check('app registers the pillar as a type', /registry\.register\(PILLAR_ID/.test(app));
check('a set proposes slots while the stage mounts by selection',
  /const slots = slotPick\(/.test(app)
  && /\(await syncPresets\(\)\)\.concat\(await syncPillars\(\)\)/.test(app));
check('one preset can fill several slots with separate instances',
  /function repeatDef\(/.test(app) && /registry\.instantiate\(repeatDef\(base, count\)\)/.test(app));
check('a set that stands empty fills nothing',
  /if \(count <= 0\) return \[\]/.test(app));
check('pillars mount as a count you choose, not as part of a set',
  /async function syncPillars\(/.test(app) && /Math\.min\(2/.test(app)
  && /heading\('Pillars'\)/.test(panel));
check('one pillar stands at the centre, two at the end of each module',
  /function frameAnchor\(/.test(app) && /'stand-base'/.test(app)
  && /derivePillarPlace\(i, arr\.length\)/.test(app));
check('two pillars can also stand at the opposite ends beside the gap',
  /let pillarPlace = 'outer'/.test(app) && /innerLeft/.test(app)
  && /innerRight/.test(app) && /function setPillarPlace\(/.test(app)
  && /param-pillar-place/.test(panel) && /onPillarPlaceChange: guard\(/.test(app)
  && /\['centre', 'inner', 'outer'\]\.includes\(value\)/.test(app)
  && /i === 0 \? ends\.innerLeft : ends\.innerRight/.test(app));
check('the inner pillar sits on the gap-side end, not between the poles',
  /complete inner end/.test(app)
  && /pillarPlace === 'inner'[\s\S]*?return i === 0 \? ends\.innerLeft/.test(app));
check('the lock decides whether you or the frame own the numbers',
  /function refreshLockedPillars\(/.test(app) && /function setPillarLock\(/.test(app)
  && /Lock to frame/.test(panel) && /lock: pillarLock/.test(app));
check('your numbers reach the document and come back',
  /places: Object\.fromEntries/.test(app) && /onPlaceChange: guard\(/.test(app)
  && /next\.places !== undefined/.test(panel));
check('a mirrored pair writes both halves',
  /function setMirror\(/.test(app) && /Mirror pair/.test(panel)
  && /x: -next\.x/.test(app));
check('the panel gets the set list and the callback',
  /sets: LAYOUTS/.test(app) && /onSetChange: guard\(/.test(app));
check('the panel renders the set picker', /param-set/.test(panel) && /onSetChange/.test(panel));
check('every group on stage gets a section, pillars included',
  /host\.appendChild\(pillarBlock\(\)\)/.test(panel)
  && /currentGroups\.forEach\(\(g, i\) => host\.appendChild\(/.test(panel));

check('panel offers the reset button', /onReset/.test(panel)
  && /Reset project/.test(panel));
check('the reset button is disabled while busy', /live\.buttons\.push\(btn\)/.test(panel));

console.log('\nwiring: live reload in the shell');
check('the shell opens the event stream', /EventSource\('\/__events'\)/.test(shell));
check('a reload event reloads the page', /e\.data === 'reload'\)/.test(shell)
  && /location\.reload\(\)/.test(shell));
check('the stream only runs over http', /\^https\?\:\$\/\.test\(location\.protocol\)/.test(shell));
check('a dead stream stops retrying', /es\.readyState === 2/.test(shell));

console.log('\nwiring: the server watches the right things');
const watched = /const WATCHED = \[([^\]]*)\]/.exec(server);
check('WATCHED is declared', !!watched);
if (watched) {
  const list = watched[1].split(',').map(s => s.trim().replace(/^'|'$/g, ''));
  check('it covers the modules and the shell',
    list.includes('js') && list.includes('models') && list.includes('TILT.html'),
    list.join(', '));
  check('it does not watch the project file (that would reload forever)',
    !list.includes('project.json') && !list.includes('.'));
  check('it watches the nested objects folder too', list.includes('js/objects'));
}
check('the server caps the project body', /MAX_BODY = 128 \* 1024/.test(server));
check('the SSE endpoint is registered', /pathname === '\/__events'/.test(server));

console.log('\nwiring: the bundle knows about the new module');
check('js/project.js is in the build order', /'js\/project\.js'/.test(build));
check('the shell keeps the redirect before anything else',
  /TILT\\.standalone\\.html\$/.test(shell) && /location\.replace/.test(shell));

console.log(fails === 0 ? '\nALL CHECKS PASSED' : `\n${fails} CHECK(S) FAILED`);
process.exit(fails ? 1 : 0);
