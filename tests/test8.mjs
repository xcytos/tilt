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
const colorways = await import(pathToFileURL(path.join(DECOR, 'js/colorways.js')).href);
const recipes = await import(pathToFileURL(path.join(DECOR, 'js/recipes.js')).href);
const scenesSrc = fs.readFileSync(path.join(DECOR, 'js/scenes.js'), 'utf8');

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
check('the merged sets leave five, Divided Entrance folded away',
  layouts.LAYOUTS.length === 5 && !layouts.LAYOUT_IDS.includes('divided-entrance')
  && layouts.layoutById('classic-symmetry').placements.every(p => Math.abs(p.ry) === 10));
check('old divided-entrance documents land on Classic Symmetry',
  proj.parseProject(JSON.stringify({ layout: 'divided-entrance' })).layout === 'classic-symmetry');
check("the boards' fabric palettes are pure, unique data",
  colorways.COLORWAYS.length === 5
  && new Set(colorways.COLORWAY_IDS).size === 5
  && colorways.DEFAULT_COLORWAY === 'ivory'
  && colorways.COLORWAYS.every(c => typeof c.fabric === 'number' && c.name));
check('a saved colorway survives, junk drops to the default',
  proj.parseProject(JSON.stringify({ colorway: 'sage' })).colorway === 'sage'
  && proj.parseProject(JSON.stringify({ colorway: 'plaid' })).colorway === 'ivory'
  && proj.parseProject('{}').colorway === 'ivory');
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
check('each frame carries its pillar options through a round trip', (() => {
  const doc = proj.parseProject(proj.projectToJSON({
    layout: 'classic-symmetry',
    pillars: { o2tilt: { count: 2, place: 'inner' } },
    places: { o2tilt: [{ x: 4, z: 2, ry: 0 }] }
  }));
  const fresh = proj.parseProject('{}');
  return doc.layout === 'classic-symmetry'
    && doc.pillars.o2tilt.count === 2 && doc.pillars.o2tilt.place === 'inner'
    && doc.places.o2tilt[0].x === 4
    && typeof fresh.pillars === 'object'
    && !Object.keys(fresh.pillars).length;
})());
check("a frame's pillar count is clamped to a pair", (() => {
  const doc = proj.parseProject(JSON.stringify({
    pillars: { o2tilt: { count: 9, place: 'sideways' }, 'a"; drop': { count: 1 } }
  }));
  return doc.pillars.o2tilt.count === 2 && doc.pillars.o2tilt.place === 'outer'
    && !('a"; drop' in doc.pillars);
})());
check('old documents with a global pillar count pass through',
  proj.parseProject(JSON.stringify({ pillars: 2 })).pillars === 2);
check('a hostile placement is cleaned, not trusted', (() => {
  const bad = proj.parseProject(JSON.stringify({
    places: { o2tilt: [{ x: 1e9, z: 'no', ry: 5 }, 'junk'], 'a"; drop': [{ x: 1 }] }
  }));
  return bad.places.o2tilt[0].x === 300 && bad.places.o2tilt[0].z === 0
    && bad.places.o2tilt[1] === null && !('a"; drop' in bad.places);
})());

console.log('\nproject file: mounted flower panels');
{
  const fresh = proj.parseProject('{}');
  check('a fresh project starts with no flower panels',
    Array.isArray(fresh.flowerPanels) && fresh.flowerPanels.length === 0
    && !('arrangements' in fresh)); // the arrangement library lives in the Studio

  const good = proj.parseProject(proj.projectToJSON({
    flowerPanels: [
      { id: 'panel-1', name: 'Front', arrangementId: 'arr-abc', settings: { width: 8, height: 6, flowerType: 'dahlia' }, x: 5, z: -3, ry: 45 },
      { id: 'BAD ID', name: 'X', settings: { width: 2, height: 2 } },
      { id: 'panel-2', name: 'NoSettings', settings: 42 }
    ]
  }));
  check('keeps valid panels, drops bad-id / no-settings ones',
    good.flowerPanels.length === 1 && good.flowerPanels[0].id === 'panel-1');
  check('panel placement is kept and linked to its Studio arrangement by id',
    good.flowerPanels[0].x === 5 && good.flowerPanels[0].z === -3 && good.flowerPanels[0].ry === 45
    && good.flowerPanels[0].arrangementId === 'arr-abc');
  check('panel settings fallback is normalized (flowerType survives)', (() => {
    const f = good.flowerPanels[0].settings;
    return f.flowerType === 'dahlia' && typeof f.border === 'object' && typeof f.greenery === 'object';
  })());

  const many = proj.parseProject(proj.projectToJSON({
    flowerPanels: Array.from({ length: 20 }, (_, i) => ({ id: 'p' + i, settings: { width: 2, height: 2 } }))
  }));
  check('the panel list is capped', many.flowerPanels.length <= 12);

  check('enabled:false survives a round trip; old panels default to visible', (() => {
    const doc = proj.parseProject(proj.projectToJSON({
      flowerPanels: [
        { id: 'panel-off', settings: { width: 4, height: 4 }, enabled: false, x: 1, z: 2, ry: 3 },
        { id: 'panel-old', settings: { width: 4, height: 4 } }
      ]
    }));
    const off = doc.flowerPanels.find(p => p.id === 'panel-off');
    const old = doc.flowerPanels.find(p => p.id === 'panel-old');
    return !!off && !!old && off.enabled === false && old.enabled === true
      && off.x === 1 && off.z === 2 && off.ry === 3;
  })());
  check('junk enabled values fall back to visible',
    (() => {
      const doc = proj.parseProject(proj.projectToJSON({
        flowerPanels: [{ id: 'panel-junk', settings: { width: 4, height: 4 }, enabled: 'no' }]
      }));
      return doc.flowerPanels[0].enabled === true;
    })());

  check('decor instances round-trip with asset id and placement', (() => {
    const doc = proj.parseProject(proj.projectToJSON({
      decor: [
        { id: 'decor-1', assetId: 'pillar_rail_large', x: 5, z: -3, ry: 45 },
        { id: 'decor-2', assetId: 'decorative_arch_panel_sheet', x: -8, z: 2, ry: 0 }
      ]
    }));
    return doc.decor.length === 2
      && doc.decor[0].assetId === 'pillar_rail_large'
      && doc.decor[0].x === 5 && doc.decor[0].z === -3 && doc.decor[0].ry === 45
      && doc.decor[1].assetId === 'decorative_arch_panel_sheet';
  })());
  check('junk decor is dropped: bad ids, unknown assets, non-objects', (() => {
    const doc = proj.parseProject(proj.projectToJSON({
      decor: [
        { id: 'BAD ID', assetId: 'pillar_rail_large' },
        { id: 'decor-3', assetId: 'not-an-asset' },
        { id: 'decor-4' },
        'nope',
        { id: 'decor-5', assetId: 'pillar_rail_small', x: 1, z: 2, ry: 3 }
      ]
    }));
    return doc.decor.length === 1
      && doc.decor[0].id === 'decor-5' && doc.decor[0].assetId === 'pillar_rail_small'
      && doc.decor[0].x === 1 && doc.decor[0].z === 2 && doc.decor[0].ry === 3;
  })());
  check('the decor list is capped', (() => {
    const doc = proj.parseProject(proj.projectToJSON({
      decor: Array.from({ length: 60 }, (_, i) =>
        ({ id: 'decor-' + i, assetId: 'pillar_rail_small' }))
    }));
    return doc.decor.length <= 40;
  })());
  check('decor placement clamps instead of rejecting', (() => {
    const doc = proj.parseProject(proj.projectToJSON({
      decor: [{ id: 'decor-9', assetId: 'pillar_rail_large',
                x: 9999, z: 'far', ry: 720 }]
    }));
    const d = doc.decor[0];
    return d && d.x === 300 && d.z === 0 && d.ry === 360;
  })());

  check('a light element carries its Shown flag through the file', (() => {
    const doc = proj.parseProject(proj.projectToJSON({
      elements: { 'frame-1': [
        { type: 'light-par', anchor: 'pole-R-1', params: { power: 77, enabled: false } },
        { type: 'light-led', anchor: 'pole-L-2', params: { power: 50, enabled: 'no' } }
      ] }
    }));
    const els = doc.elements['frame-1'];
    return !!els && els.length === 2
      && els[0].params.enabled === false && els[0].params.power === 77
      && els[0].anchor === 'pole-R-1'
      && !('enabled' in els[1].params) && els[1].params.power === 50;
  })());

console.log('\nflower studio: a save reaches the open editor');
check('studio and editor share one BroadcastChannel name', (() => {
  const editor = read('js/app.js');
  const studio = read('studio/app.js');
  const ed = /new BroadcastChannel\('([^']+)'\)/.exec(editor);
  const st = /new BroadcastChannel\('([^']+)'\)/.exec(studio);
  return !!ed && !!st && ed[1] === st[1] && ed[1] === 'flower-panel-changed';
})());
check('the editor re-reads the studio localStorage store on that ping',
  /BroadcastChannel\('flower-panel-changed'\)/.test(read('js/app.js'))
  && /flower-panel-studio-v2/.test(read('js/app.js'))
  && /flower-panel-studio-v2/.test(read('studio/app.js')));
}

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

async function waitForServer(ms = 20000) {
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
const editor = read('js/editor.js');
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
  && /onReset: \(\) => resetProject\(\)/.test(app));
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
check('the room lives as chips inside the Look section', (() => {
  return /function lookBlock\(/.test(panel) && /function chipRow\(/.test(panel)
    && /sceneChips\.set/.test(panel) && /onSceneChange && onSceneChange\(id\)/.test(panel)
    && !/param-scene/.test(panel) && !/function sceneBlock\(/.test(panel);
})());
check('the viewer falls back to the studio', /isScene\(id\) \? id : DEFAULT_SCENE/.test(read('js/viewer.js')));

console.log('\nwiring: the SET the project is staged as');
check('the catalog is the one S Curve - Arc is the Swing Pan slider now', (() => {
  const manifest = JSON.parse(fs.readFileSync(
    path.join(DECOR, 'models/manifest.json'), 'utf8'));
  return manifest.models.length === 1
    && manifest.models[0].id === 'o2tilt' && manifest.models[0].name === 'S Curve'
    && !fs.existsSync(path.join(DECOR, 'models/o2tilt-classic.json'))
    && !fs.existsSync(path.join(DECOR, 'models/o2tilt-slope.json'))
    && !fs.existsSync(path.join(DECOR, 'models/o2tilt-arc.json'));
})());
check('old Classic, Slope and Arc documents remap onto S Curve',
  /'o2tilt-classic': 'o2tilt'/.test(app) && /'o2tilt-slope': 'o2tilt'/.test(app)
  && /'o2tilt-arc': 'o2tilt'/.test(app));
check('every SET keeps a front look - frame turns are mirrored pairs', (() => {
  // A frame never turns its back on the audience: ry comes in +x/-x pairs.
  return layouts.LAYOUTS.every(l => {
    const f = l.placements.filter(p => p.kind === 'frame');
    if (f.length % 2) return f.every(p => Math.abs(p.ry) < 1e-9);
    for (let i = 0; i < f.length; i += 2) {
      if (Math.abs(f[i].ry + f[i + 1].ry) > 1e-9) return false;
    }
    return true;
  });
})());
check('every SET carries its own shape sliders, all five different', (() => {
  const keys = ['gap', 'pan', 'pitch', 'decline', 'declineIn'];
  return layouts.LAYOUTS.length === 5
    && layouts.LAYOUTS.every(l => l.params
      && keys.every(k => Number.isFinite(l.params[k])))
    && new Set(layouts.LAYOUTS.map(l => JSON.stringify(l.params))).size === 5;
})());
check('per-SET slider state round-trips, junk keys drop', (() => {
  const p = proj.parseProject(JSON.stringify({ setPresets: {
    'classic-symmetry': { gap: 4.5, pan: 12, declineIn: 40, junk: 99 },
    nope: { gap: 1 },
    'grand-entrance': 'wide'
  }}));
  return p.setPresets['classic-symmetry'].gap === 4.5
    && p.setPresets['classic-symmetry'].pan === 12
    && p.setPresets['classic-symmetry'].declineIn === 40
    && p.setPresets['classic-symmetry'].junk === undefined
    && !p.setPresets.nope && !p.setPresets['grand-entrance'];
})());
check('a SET switch converts the sliders before the row is spaced', (() => {
  const doc = proj.parseProject(JSON.stringify({
    layout: 'grand-entrance',
    setPresets: { 'grand-entrance': { gap: 5, pan: 33, pitch: 4, decline: 7 } }
  }));
  return doc.layout === 'grand-entrance'
    && doc.setPresets['grand-entrance'].pan === 33
    && /function applySetParams\(/.test(app)
    && /const shaped = applySetParams\(layoutId\);/.test(app)
    && /panel\.applyLive\(\{\s*set: layoutId/.test(app)
    // the conversion rebuilds the geometry in the same sync, and a partly
    // tweaked SET still converts every slider
    && /if \(m\.dirty && m\.build\) m\.build\(\);/.test(app)
    && /Object\.assign\(\{\}, \(lay && lay\.params\) \|\| \{\},/.test(app)
    && /setPresets\[layoutId\] = Object\.assign/.test(app)
    && /setPresets: setPresetsPlain\(\)/.test(app);
})());
check('old Classic and Slope documents remap onto S Curve',
  /'o2tilt-classic': 'o2tilt'/.test(app) && /'o2tilt-slope': 'o2tilt'/.test(app)
  && /const remapId = id =>/.test(app));
check('every Look is complete and lands on real ids', (() => {
  const sceneIds = [...scenesSrc.matchAll(/id: '([a-z-]+)'/g)].map(m => m[1]);
  return recipes.RECIPES.length === 5
    && new Set(recipes.RECIPES.map(r => r.id)).size === 5
    && recipes.RECIPES.every(r => sceneIds.includes(r.scene)
      && colorways.COLORWAY_IDS.includes(r.colorway)
      && layouts.LAYOUT_IDS.includes(r.set))
    && recipes.recipeFor('ballroom', 'ivory', 'classic-symmetry').id === 'ivory-ballroom'
    && recipes.recipeFor('ballroom', 'blush', 'classic-symmetry') === null;
})());
check('the Looks reach the panel and one tap writes all three fields',
  /'js\/recipes\.js'/.test(build) && /function setRecipe\(/.test(app)
  && /onRecipeChange: guard\(/.test(app) && /recipes: RECIPES/.test(app)
  && /lookBlock\(\)/.test(panel) && /onRecipeChange/.test(panel)
  && /recipe: recipeState\(\)/.test(app));
check('the build carries one version, in the header and the log',
  /'js\/version\.js'/.test(build) && /export const VERSION = '[^']+'/.test(
    fs.readFileSync(path.join(DECOR, 'js/version.js'), 'utf8'))
  && /app-version/.test(editor) && /TILT v\$\{VERSION\} serving/.test(
    fs.readFileSync(path.join(DECOR, 'tools/serve.mjs'), 'utf8')));
check('a saved RGB colour survives, junk drops to the palette', (() => {
  const p = proj.parseProject(JSON.stringify({ colorway: 'sage', fabricColor: 0x123456 }));
  const q = proj.parseProject(JSON.stringify({ fabricColor: 'red' }));
  const r = proj.parseProject(JSON.stringify({ fabricColor: 9e99 }));
  return p.fabricColor === 0x123456 && q.fabricColor === null && r.fabricColor === null;
})());
check('saved swatches survive, junk and overflow drop', (() => {
  const p = proj.parseProject(JSON.stringify({ extraColors: [
    { id: 'custom-c8e8d5', name: '#c8e8d5', fabric: 0xc8e8d5 },
    { id: 'BAD ID', name: 'x', fabric: 1 },
    { id: 'custom-empty', name: '   ', fabric: 2 },
    { id: 'custom-oob', name: 'far', fabric: 9e99 },
    { id: 'custom-c8e8d5', name: 'dupe', fabric: 3 }
  ].concat(Array.from({ length: 20 }, (_, i) => (
    { id: 'custom-' + i, name: 'n' + i, fabric: i }))) }));
  return p.extraColors.length === 12
    && p.extraColors[0].id === 'custom-c8e8d5' && p.extraColors[0].fabric === 0xc8e8d5
    && p.extraColors[1].id === 'custom-0'
    && p.extraColors.every(c => /^[a-z0-9-]+$/.test(c.id) && c.name);
})());
check('Add colour appends a swatch and never edits the boards', (() => {
  const a = fs.readFileSync(path.join(DECOR, 'js/app.js'), 'utf8');
  const p = fs.readFileSync(path.join(DECOR, 'js/panel.js'), 'utf8');
  return /function addFabricColor\(/.test(a) && /extraColors = extraColors\.concat/.test(a)
    && /extraColors: extraColors\.slice\(\)/.test(a)
    && /onAddColor: guard\(/.test(a)
    && /Add colour/.test(p) && /onAddColor && onAddColor\(\)/.test(p)
    && !/COLORWAYS\s*=/.test(a);
})());
check('the curtain colour lives under Curtains, on the shared square', (() => {
  const p = fs.readFileSync(path.join(DECOR, 'js/panel.js'), 'utf8');
  return /schema\.params\.fabric/.test(p) && /function fabricBlock\(/.test(p)
    && /onRgbChange/.test(p) && /id: 'param-fabricpalette'/.test(p)
    && !/host\.appendChild\(colorwayBlock\(\)\)/.test(p);
})());
check('a custom colour reaches the stage, and a Look or chip clears it',
  /function setFabricColor\(/.test(app) && /fabricHex\(\)/.test(app)
  && /fabricColor: fabricColor/.test(app)
  && /fabricColor = nextFabric;/.test(app)
  && /colorwayId = r\.colorway;\n    fabricColor = null;/.test(app)
  && /fabricColor = null;\n    extraColors = \[\];/.test(app));
check('a SET tap moves values in place - no panel rebuild under the finger', (() => {
  const p = fs.readFileSync(path.join(DECOR, 'js/panel.js'), 'utf8');
  return /applyLive\(next = \{\}\)/.test(p)
    && /setSelectRef\.value/.test(p) && /rgbDialRef\.set/.test(p)
    && /placeRows\.get/.test(p)
    // the signature no longer carries value-level fields
    && !/currentSet \|\|''/.test(p.replace(/\s+/g, ''))
    && !/JSON\.stringify\(currentPlaces\)/.test(p)
    && /panel\.applyLive\(\{ places: placesFor\(\) \}\)/.test(app)
    && /panel\.applyLive\(\{ scene: sceneId/.test(app);
})());
check('the SET write-through never reaches outside the instance loop', (() => {
  const handler = app.slice(app.indexOf('onParamsChange:'), app.indexOf('onThemeChange:'));
  const after = handler.slice(handler.indexOf('if (layoutId && Object.keys(shaped)'));
  return /const shaped = \{\};/.test(handler)
    && /if \(layoutId && Object\.keys\(shaped\)\.length\)/.test(handler)
    && !/\bknown\b/.test(after);
})());
check('the fabric palette reaches the panel and the stage',
  /'js\/colorways\.js'/.test(build) && /colorway: colorwayId/.test(app)
  && /function applyColorway\(/.test(app) && /function setColorway\(/.test(app)
  && /onColorwayChange: guard\(/.test(app)
  && /onColorwayChange/.test(panel));
check('the built-in fallback is S Curve too',
  /id: 'o2tilt'/.test(fs.readFileSync(path.join(DECOR, 'js/registry.js'), 'utf8'))
  && /MODEL_NAME = 'S Curve'/.test(fs.readFileSync(
    path.join(DECOR, 'js/objects/o2tilt.js'), 'utf8')));
check('layouts.js and pillar.js are in the build order',
  /'js\/layouts\.js'/.test(build) && /'js\/objects\/pillar\.js'/.test(build));
check('app carries the set into the document', /layout: layoutId/.test(app));
check('app registers the pillar as a type', /registry\.register\(PILLAR_ID/.test(app));
check('a set proposes slots while the stage mounts by selection',
  /const slots = slotPick\(/.test(app)
  && /const failures = await syncPresets\(\);/.test(app));
check('one preset can fill several slots with separate instances',
  /function repeatDef\(/.test(app) && /registry\.instantiate\(repeatDef\(base, count\)\)/.test(app));
check('a set that stands empty fills nothing',
  /if \(count <= 0\) return \[\]/.test(app));
check('pillars mount beside their frame, count per instance',
  /async function syncPillarsFor\(/.test(app) && /function pillarKey\(/.test(app)
  && /frames\.length \* per/.test(app) && /'Pillars'/.test(panel));
check('one pillar stands at the centre, two at its ends',
  /function frameAnchorOf\(/.test(app) && /'stand-base'/.test(app)
  && /function derivePillarPlace\(/.test(app));
check('two pillars can also stand at the opposite ends beside the gap',
  /place === 'inner'/.test(app) && /innerLeft/.test(app) && /innerRight/.test(app)
  && /i === 0 \? ends\.innerLeft : ends\.innerRight/.test(app)
  && /param-pillars-place/.test(panel) && /onFramePillarsChange: guard\(/.test(app));
check("the pillar options live inside the frame's own Pillars group",
  /function pillarsBlock\(/.test(panel) && /function setFramePillars\(/.test(app)
  && /framePillars: framePillarsPlain\(\)/.test(app)
  && /check\.checked = cfg\.count > 0/.test(panel)
  && /param-pillars-on/.test(panel));
check('pillars take free placement on top of their anchor', (() => {
  return /spot\.x \+ sx \+ \(off\.x \|\| 0\)|offset\.x \+ \(off\.x \|\| 0\)/.test(app)
    && /placeRangeBlock\(`pillar-pos-\$\{prop\}`/.test(panel)
    && /offset: Object\.assign\(\{\}, off, \{ \[prop\]: v \}\)/.test(panel)
    && /patch\.offset && typeof patch\.offset === 'object'/.test(app)
    && /offset: \{/.test(read('js/project.js'));
})());
check('pillars get a Centre Gap slider when there are two', (() => {
  return /Centre Gap/.test(panel)
    && /\{ gap: v \}/.test(panel)
    && /spot\.x \+ sx/.test(app)
    && /gap: clampN/.test(read('js/project.js'));
})());
check('both placement blocks offer a reset', (() => {
  return (panel.match(/Reset placement/g) || []).length >= 2
    && /onPlaceChange && onPlaceChange\(key, idx, \{ x: 0, z: 0, ry: 0 \}\)/.test(panel)
    && /offset: \{ x: 0, z: 0, ry: 0 \} \}\);/.test(panel);
})());
check("a pillar's look hides behind one gear inside Pillars",
  /function gearIcon\(/.test(panel) && /'Look'/.test(panel)
  && /emit\(\{ \[k\]: v \}, pg\.models\)/.test(panel));
check('pillars have no accordion section of their own',
  /g\.id !== PILLAR_ID/.test(panel));
check('pillars travel with their frame through the All-at-once row',
  /applyPlaces\(\);\s*\n\s*refreshPillarPlaces\(\);(?:\s*\n\s*refreshElementPlaces\(\);)?\s*\n\s*applyPlaces\(\);/.test(app)
  && /for \(const k of presets\)/.test(app)
  && /frames\[Math\.floor\(i \/ per\)\]/.test(app));
check('your numbers reach the document and come back',
  /places: Object\.fromEntries/.test(app) && /onPlaceChange: guard\(/.test(app)
  && /next\.places !== undefined/.test(panel));
check('the lighting rig travels through the document',
  /elements: frameElementsPlain\(\)/.test(app)
  && /savedDoc\.elements/.test(app)
  && /defElementsOf\(def\)/.test(app));
check('the floor-PAR spacing travels through the document',
  (() => {
    const proj = read('js/project.js');
    return /spacing: frameSpacingPlain\(\)/.test(app)
      && /savedDoc\.spacing/.test(app)
      && /function cleanFrameSpacing\(/.test(proj)
      && /spacing: cleanFrameSpacing\(data\.spacing\)/.test(proj)
      && /onFrameSpacing: guard\(/.test(app)
      && /onFrameSpacing && onFrameSpacing\(/.test(panel)
      && /label: 'Spacing'/.test(panel)
      && /lightspacing/.test(panel);
  })());
check('spacing re-seats the floor lights on the frame\'s own hooks',
  /function reseatSpacedFrames\(/.test(app)
  && /function uplightHooks\(/.test(app)
  && /function wallSeatKs\(/.test(app)
  && /function setFrameSpacing\(/.test(app)
  && /reseatSpacedFrames\(\);/.test(app)
  && /uplight-\$\{side\}-/.test(app));
check('All is the default; the right wall mirrors the left',
  /let lightsMode = 'all'/.test(panel)
  && /emit\(\{ \[k\]: v \}, lt\)/.test(panel)
  && /emit\(\{ \[k\]: -v \}, rt\)/.test(panel)
  && /the right wall mirrors the left/.test(panel));
check('every light in a group answers one shared slider',
  /currentGroups\.find\(x => x\.owner === id/.test(panel)
  && !/byInst/.test(panel)
  && /sideOf\(\(entries\[i\] \|\| \{\}\)\.anchor\)/.test(panel));
check('a count bump plants the fresh seats already wearing the wall\'s numbers',
  /const donor = kept\[0\] \|\| null/.test(app)
  && /Object\.assign\(\{\}, donor\.params\)/.test(app)
  && /type: donor \? donor\.type : 'light-par'/.test(app));
check('a hand-added fixture joins the rig wearing its numbers too',
  /const donor = pool\.find\(e => e\.type === type\)/.test(app)
  && /const params = donor \? Object\.assign\(\{\}, donor\.params\) : \{\};/.test(app)
  && /!\('tilt' in params\)/.test(app));
check('a floor mount starts aimed at the fabric, not across the floor',
  /anchor\.split\('-'\)\[0\] === 'base'/.test(app) && /params\.tilt = -86/.test(app));
check('a beam\'s swing is written in degrees, the way places are stored', (() => {
  // applyPlaces converts every savedPlaces.ry with * PI / 180; elementSpot
  // used to hand it radians, squashing each beam's yaw ~57x - the curtain
  // swung away while the light kept pointing at where it used to be.
  return /ry: ry \* 180 \/ Math\.PI/.test(app)
    && /Places are degrees end to end/.test(app);
})());
check('the swung curtain carries its uplights on the wall\'s own facing', (() => {
  // Hooks sample the rail by curve parameter (even x piles them up when the
  // wall turns edge-on), stand off along the wall's chord-facing guest
  // normal - never pure -Z, which slips behind the cloth past 67 degrees or
  // parks the hook in minus pan - then step out until they clear the stand
  // plates at any swing.
  const obj = read('js/objects/o2tilt.js');
  return /const atT = u =>/.test(obj)
    && /const chord = pts\[pts\.length - 1\]\.clone\(\)\.sub\(pts\[0\]\)\.setY\(0\)/.test(obj)
    && /const front = back\.clone\(\)\.negate\(\)/.test(obj)
    && /p\.x \+ front\.x \* UPLIGHT_STANDOFF/.test(obj)
    && /for \(let step = 0; step < 6; step\+\+\)/.test(obj)
    && /UPLIGHT_MIN_Z \* UPLIGHT_MIN_Z/.test(obj)
    && !/Math\.min\(p\.z - UPLIGHT_STANDOFF/.test(obj)
    && !/front\.add\(new THREE\.Vector3\(0, 0, -1\)\)/.test(obj);
})());
check('each light type keeps its own group of settings', (() => {
  // PAR keeps the rig knobs and the mirrored All row; LED gets a mode row
  // of its own; Strip is its own group - side filter, a live hue/sat
  // palette, power - and its tubes ride the frame's strip lines (top
  // rail, hem), redrawn from the rail polyline on every re-place.
  const obj = read('js/objects/o2tilt.js');
  const light = read('js/elements/light.js');
  return /const parSec = sectionOf\('PAR'\)/.test(panel)
    && /const ledSec = sectionOf\('LED'\)/.test(panel)
    && /const stripSec = sectionOf\('Strip'\)/.test(panel)
    && /let ledMode = 'separate'/.test(panel)
    && /let stripSide = 'both'/.test(panel)
    && /id: 'param-strippalette'/.test(panel)
    && /rangeBlock\('strippower'/.test(panel)
    && /rangeBlock\('striplength'/.test(panel)
    && /shownBox\(\[lm\]/.test(panel)
    && /shownBox\(idxs\.map\(lmOf\)/.test(panel)
    && /stripline-\$\{side\}-\$\{suffix\}/.test(panel)
    && /emit\(\{ hue: h, sat: s \}, targets\)/.test(panel)
    && /id: `stripline-\$\{tag\}-T`/.test(obj)
    && /id: `stripline-\$\{tag\}-B`/.test(obj)
    && /setPath\(pts\) \{/.test(light)
    && /CatmullRomCurve3/.test(light)
    && /function stripPathFor\(/.test(app)
    && /m\.setPath\(/.test(app)
    && /\['stripline', 'rail', 'pole'\]/.test(app)
    && /\(a\.kind === 'uplight' \|\| a\.kind === 'stripline'\) && a\.normal/
      .test(app);
})());
check('one colour square rules every hue, and the rig folds away', (() => {
  // PAR, LED, Strip and the curtain all wear the same live hue-by-sat
  // square; the old hue sliders and the native colour input are gone.
  // Sections and per-fixture cards are collapsible details. A strip Add
  // on a curtained frame plants the pair - both walls at once, tops
  // before hems - and its tube rides in front of the rail, never inside
  // it.
  return /function paletteBlock\(/.test(panel)
    && /const hexToHsv = /.test(panel)
    && /const hsvToHex = /.test(panel)
    && /id: 'param-fabricpalette'/.test(panel)
    && (panel.match(/k === 'hue' \|\| k === 'sat'/g) || []).length >= 2
    && /const sec = document\.createElement\('details'\)/.test(panel)
    && /sec\.open = open/.test(panel)
    && /const card = document\.createElement\('details'\)/.test(panel)
    && !/type = 'color'/.test(panel)
    && !/colorInput/.test(panel)
    && /const strips = ofType\('light-strip'\);\n        if \(strips\.length\) \{/
      .test(panel)
    && /const STRIP_OUT = 0\.18/.test(app)
    && /p\.x \+ a\.normal\.x \* STRIP_OUT - ap\.x/.test(app)
    && /const tops = \['L', 'R'\]\.map\(s => seat\(s, 'T'\)\)/.test(app)
    && /list\.length \+ pair\.length <= 20/.test(app);
})());
check('folds remember, and strips share one block', (() => {
  // A collapsed section or card stays collapsed through the re-render an
  // Add triggers. On a curtained frame the strip group is ONE settings
  // block per side filter - mount chips and a small remove, never a card
  // per tube; straight strips keep their cards for their mounts.
  return /const folded = new Set\(folds\)/.test(panel)
    && /sec\.addEventListener\('toggle'/.test(panel)
    && /card\.addEventListener\('toggle'/.test(panel)
    && /const foldKey = `\$\{typeFilter\}:\$\{i\}`/.test(panel)
    && /const stripLower = document\.createElement\('div'\)/.test(panel)
    && /const railLines = anchors\.some\(o => o\.kind === 'stripline'\)/
      .test(panel)
    && /btn\.title = `Remove the \$\{where\} strip`/.test(panel)
    && /shownBox\(\[lmOf\(x\.i\)\]/.test(panel);
})());
check('the strip is one neon-flex assembly, not a black tube', (() => {
  // The rail strip is a designed mounting profile: ONE resampled route,
  // explicit upright frames (world-up, never Frenet - no twist), a
  // low-profile aluminium U-channel swept from an 8-corner outline, the
  // rounded emissive flex seated inside and rising clear of the rim, and
  // a separate faint additive halo - all three from the same frames so
  // the route can never drift, gap or bury itself. The old TubeGeometry
  // shell is gone; the channel replaces the floor flange on the rail.
  const light = read('js/elements/light.js');
  return /export const STRIP_PROFILE = \{/.test(light)
    && /export function channelOutline\(\)/.test(light)
    && /export function neonOutline\(\)/.test(light)
    && /export function stripFrames\(/.test(light)
    && /export function sweepOutline\(/.test(light)
    && /export function stripAssembly\(/.test(light)
    && /addScaledVector\(T, -T\.y\)/.test(light)
    && /Math\.min\(360, Math\.max\(144, pts\.length \* 16\)\)/.test(light)
    && /new THREE\.Mesh\(asm\.channel, matHousing\)/.test(light)
    && /new THREE\.Mesh\(asm\.neon, matLens\)/.test(light)
    && /new THREE\.Mesh\(asm\.glow, matGlow\)/.test(light)
    && /glow\.renderOrder = 1/.test(light)
    && /MeshBasicMaterial/.test(light)
    && /AdditiveBlending/.test(light)
    && /const onRail = kind === 'strip'/.test(light)
    && /matHousing, matYoke, matLens, matBeam, matGlow/.test(light)
    && /THREE\.ShapeUtils\.triangulateShape/.test(light)
    && /function buildWash\(points\)/.test(light)
    && /new THREE\.PointLight\(0xffffff, 0, WASH_DIST, 2\)/.test(light)
    && /buildWash\(\[0\.18, 0\.5, 0\.82\]/.test(light)
    && /for \(const l of wash\)/.test(light)
    && !/TubeGeometry\(curve, 48, 0\.07/.test(light)
    && !/TubeGeometry\(lensCurve, 48, 0\.045/.test(light);
})());
check('the stage grows with its contents', (() => {
  // A fixed 60x16 stage let rotated or widened frames hang off the edge
  // or hover past it. The room is now derived: the viewer unions the
  // models' world box, computeStageSize adds aisles and clamps, and the
  // indoor scenes rebuild from that - only when the quantized size
  // changes. Studio keeps its bare floor; garden and terrace have no
  // raised stage to fit.
  const scenes = read('js/scenes.js');
  const viewer = read('js/viewer.js');
  const app = read('js/app.js');
  return /export const DEFAULT_STAGE_SIZE = \{/.test(scenes)
    && /export function computeStageSize\(fp\)/.test(scenes)
    && /SIZE_MARGIN_X = 3\.5/.test(scenes)
    && /SIZE_W_MAX = 140/.test(scenes)
    && /function sceneRoom\(group, size,/.test(scenes)
    && /build\(id, size\)/.test(scenes)
    && /computeStageSize, DEFAULT_STAGE_SIZE/.test(viewer)
    && /stageFootprint\(\)/.test(viewer)
    && /updateWorldMatrix\(true, true\)/.test(viewer)
    && /refreshStageSize\(\)/.test(viewer)
    && /_stageKey/.test(viewer)
    && /next === 'studio' \? null/.test(viewer)
    && /function fitStageSoon\(\)/.test(app)
    && /viewer\.refreshStageSize\(\)/.test(app)
    && /fitStageSoon\(\);/.test(app);
})());
check('the ballroom is dressed like the real thing', (() => {
  // Grand-ballroom vocabulary, all procedural: coffered ceiling with
  // gold-trimmed beams and cove light, three crystal chandeliers
  // (instanced strands, one lamp), pilasters with capitals, chair-rail
  // molding panels along the walls, and a Versailles parquet dance floor
  // in front of the stage. Everything scales off the derived room size.
  const scenes = read('js/scenes.js');
  return /function sceneCofferedCeiling\(group, size\)/.test(scenes)
    && /function sceneChandelier\(group, size, x, z, s, withLamp\)/.test(scenes)
    && /function scenePilaster\(group, size, x, z, h\)/.test(scenes)
    && /function sceneMoldingPanel\(/.test(scenes)
    && /function sceneParquetTexture\(\)/.test(scenes)
    && /function sceneDanceFloor\(group, size\)/.test(scenes)
    && /new THREE\.InstancedMesh\(strandGeo/.test(scenes)
    && /sceneCofferedCeiling\(group, size\)/.test(scenes)
    && /sceneDanceFloor\(group, size\)/.test(scenes)
    && /sceneChandelier\(group, size, 0, 4, s, true\)/.test(scenes)
    && /function sceneDiningTables\(group, size, aisle\)/.test(scenes)
    && (scenes.match(/sceneDiningTables\(group, size/g) || []).length >= 3
    && /function sceneChairArmy\(group, size, sites\)/.test(scenes)
    && /typeof document === 'undefined'/.test(scenes);
})());
check('the white room is a modern banquet hall', (() => {
  // Same white-and-red identity, richer shell: recessed downlight grid
  // and cool cove in a flat ceiling, painted panel trim on the side
  // walls, ivory drapery folds flanking the stage, centre steps up.
  const scenes = read('js/scenes.js');
  return /function sceneModernCeiling\(group, size\)/.test(scenes)
    && /function sceneDrapery\(group, size\)/.test(scenes)
    && /function sceneStageSteps\(group, size\)/.test(scenes)
    && /new THREE\.InstancedMesh\(canGeo/.test(scenes)
    && /sceneModernCeiling\(group, size\)/.test(scenes)
    && /sceneDrapery\(group, size\)/.test(scenes)
    && /sceneStageSteps\(group, size\)/.test(scenes)
    && /function sceneDiningTables\(group, size, aisle\)/.test(scenes)
    && /sceneDiningTables\(group, size, true\)/.test(scenes)
    // every table takes its own instance slot - the ci++ guard against
    // all tables collapsing onto the stage centre
    && /blooms, 3\.55\);\s*\n\s*ci\+\+/.test(scenes)
    && /ambient: \{ color: 0xf2ede2, intensity: 0\.42 \}/.test(scenes)
    && /ACESFilmicToneMapping/.test(read('js/viewer.js'))
    && /toneMapping = THREE\.NoToneMapping/.test(read('js/viewer.js'));
})());
check('rooms are textured and live in the key light shadow', (() => {
  // Flat-card walls were the tell: now every room shells out of seeded
  // mottle paint, linen weave for cloth, planks under the ballroom, and
  // the rig sweeps cast/receive shadows over everything it builds. The
  // key light's shadow box covers a whole ballroom, with bias so big
  // flat walls don't acne.
  const scenes = read('js/scenes.js');
  const viewer = read('js/viewer.js');
  return /function sceneMottleTexture\(color, amount, seed\)/.test(scenes)
    && /function sceneWeaveTexture\(color, seed\)/.test(scenes)
    && /sceneMap\(wall, sceneMottleTexture/.test(scenes)
    && /floorKind === 'plank'/.test(scenes)
    && /sceneWeaveTexture\(0xf7f3ea, 7\)/.test(scenes)
    && /sceneWeaveTexture\(0xf2ead8, 9\)/.test(scenes)
    && /o\.castShadow = r < 80/.test(scenes)
    && /shadow\.camera\.left = -80/.test(viewer)
    && /shadow\.normalBias = 0\.1\b/.test(viewer);
})());
check('the garden is a real place at night', (() => {
  // Manicured approach: stone slabs between hedge rows with flower beds
  // and lantern posts, a moon-and-stars sky above a distant tree-line
  // silhouette, and a second festoon span.
  const scenes = read('js/scenes.js');
  return /function sceneHedge\(group, x, z0, z1\)/.test(scenes)
    && /function sceneStonePath\(group\)/.test(scenes)
    && /function scenePathLantern\(group, x, z\)/.test(scenes)
    && /function sceneFlowerBeds\(group\)/.test(scenes)
    && /function sceneMoonAndStars\(group\)/.test(scenes)
    && /function sceneTreeLine\(group\)/.test(scenes)
    && /sceneStonePath\(group\)/.test(scenes)
    && /sceneMoonAndStars\(group\)/.test(scenes)
    && /sceneTreeLine\(group\)/.test(scenes)
    && /fog: false/.test(scenes);
})());
check('the terrace is a rooftop above a city', (() => {
  // Glass balustrade along the view edge, pergola with hanging bulbs,
  // planters, lounge silhouettes, and an instanced skyline band beyond
  // the fog line.
  const scenes = read('js/scenes.js');
  return /function sceneBalustrade\(group\)/.test(scenes)
    && /function scenePergola\(group\)/.test(scenes)
    && /function scenePlanter\(group, x, z\)/.test(scenes)
    && /function sceneSkyline\(group\)/.test(scenes)
    && /function sceneLounge\(group\)/.test(scenes)
    && /sceneBalustrade\(group\)/.test(scenes)
    && /sceneSkyline\(group\)/.test(scenes)
    && /transparent: true, opacity: 0\.22/.test(scenes);
})());
check('strips and folds survive the reload', (() => {
  // The parser's anchor pattern once ended in digits only, so every load
  // wiped stripline-L-T back to '' - the strip fell back to a pole and
  // drew its straight branch. Folds are now document state too.
  const project = read('js/project.js');
  const app = read('js/app.js');
  const panel = read('js/panel.js');
  return /\(\?:\\d\+\|T\|B\)/.test(project)
    && /function cleanFolds\(raw\)/.test(project)
    && /folds: cleanFolds\(data\.folds\)/.test(project)
    && /folds: panelFolds\.slice\(\)/.test(app)
    && /Array\.isArray\(savedDoc\.folds\)/.test(app)
    && /onFoldChange: guard\(/.test(app)
    && /new Set\(folds\)/.test(panel)
    && /noteFold\(\)/.test(panel)
    && /Array\.isArray\(next\.folds\)/.test(panel);
})());
check('the panel adds, retargets and removes lights through the rig callbacks',
  /onElementAdd: guard\(/.test(app) && /onElementRemove: guard\(/.test(app)
  && /onElementPatch: guard\(/.test(app)
  && /onElementAdd && onElementAdd\(/.test(panel)
  && /onElementRemove && onElementRemove\(/.test(panel)
  && /onElementPatch && onElementPatch\(/.test(panel)
  && /frameAnchors: frameAnchorsPlain\(\)/.test(app));
check('the panel gets the set list and the callback',
  /sets: LAYOUTS/.test(app) && /onSetChange: guard\(/.test(app));
check('the panel renders the set picker', /param-set/.test(panel) && /onSetChange/.test(panel));
check('Placement holds only position; Pillars is its own group', (() => {
  return /textContent = 'Placement'/.test(panel)
    && /positionBlock\(key, idx, place\)/.test(panel)
    && /inner\.appendChild\(pillarsBlock\(key\)\)/.test(panel)
    && !/framePillarsBlock/.test(panel);
})());
check('Looks and Room are one section, not twin rows', (() => {
  return /host\.appendChild\(lookBlock\(\)\)/.test(panel)
    && !/host\.appendChild\(recipesBlock\(\)\)/.test(panel)
    && !/host\.appendChild\(sceneBlock\(\)\)/.test(panel);
})());
check('frame groups get sections; pillars ride inside their frame',
  /frameGroups\.forEach\(\(g, i\) => host\.appendChild\(/.test(panel)
  && /g\.id !== PILLAR_ID/.test(panel)
  && /total: pillars\.length, owner: id/.test(app));

check('reset lives in the top bar menu, not the panel',
  !/Reset project/.test(panel)
  && /act: 'reset'/.test(editor)
  && /onReset && onReset\(\)/.test(editor));
check('the theme toggle lives in the top bar menu',
  /act: 'theme'/.test(editor) && /onToggleTheme && onToggleTheme\(isDark\)/.test(editor));

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
