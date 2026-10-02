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

const storeSrc = read('tools/store.mjs');

const {
  createStore, openStore, normalizeName, defaultDbPath,
  StoreError, MAX_THUMB, DEFAULT_NAME, SCHEMA_VERSION
} = await import(pathToFileURL(path.join(DECOR, 'tools/store.mjs')).href);
const { memoryDriver, DRIVER_DIALECT } =
  await import(pathToFileURL(path.join(DECOR, 'tools/sqlite-driver.mjs')).href);

const DB = path.join(TMP, 'store-test.db');
const sweep = () => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(DB + suffix); } catch { /* gone */ }
  }
};
sweep();

const expectError = (label, fn, code) => {
  try {
    fn();
    check(label, false, 'no error thrown');
  } catch (err) {
    check(label, err instanceof StoreError && err.code === code,
      `${err.name}: ${err.message} (want ${code})`);
  }
};

const throws = fn => { try { fn(); return false; } catch { return true; } };

// ------------------------------------------------------------- 1. the helpers
console.log('\nstore: names');
check('a name is trimmed and collapsed', normalizeName('  a   b  ') === 'a b');
check('an empty name falls back', normalizeName('   ') === DEFAULT_NAME);
check('a missing name falls back', normalizeName(null) === DEFAULT_NAME);
check('a very long name is capped at 80', normalizeName('x'.repeat(500)).length === 80);

console.log('\nstore: database path');
check('DB_PATH wins when set', (() => {
  process.env.DB_PATH = '/tmp/elsewhere/o2tilt.db';
  const p = defaultDbPath();
  delete process.env.DB_PATH;
  return p === '/tmp/elsewhere/o2tilt.db';
})());
check('otherwise the file lands in data/', defaultDbPath().endsWith(path.join('data', 'o2tilt.db')));

// --------------------------------------------------------------- 2. create
console.log('\nstore: creating projects');
let store = openStore(DB);
check('a database file appears on disk', fs.existsSync(DB));
check('an empty database is empty', store.list().length === 0 && store.count() === 0);

const alpha = store.create({ name: '  Alpha   stage  ' });
check('create returns a summary', typeof alpha.id === 'string' && alpha.id.length > 8);
check('the name is normalised on the way in', alpha.name === 'Alpha stage');
check('a new project has no thumbnail', alpha.hasThumb === false);
check('createdAt and updatedAt are epoch millis', alpha.createdAt > 1e12 && alpha.updatedAt > 1e12);

const opened = store.get(alpha.id);
check('get returns the parsed document', opened.doc && typeof opened.doc === 'object');
check('the document carries the name too', opened.doc.name === 'Alpha stage');
check('a document starts in single mode with no selection',
  opened.doc.mode === 'single' && opened.doc.activeId === null
  && opened.doc.mounted.length === 0 && Object.keys(opened.doc.presets).length === 0);
check('a document is version 2', opened.doc.version === 2);
check('get exposes the raw thumbnail slot', opened.thumb === null);

const defaulted = store.create({});
check('a missing name still creates a project', defaulted.name === DEFAULT_NAME);
check('count follows', store.count() === 2);

expectError('a non-JSON document is refused',
  () => store.create({ name: 'x', doc: 'not json' }), 'invalid');
expectError('an array is not a document',
  () => store.create({ name: 'x', doc: '[]' }), 'invalid');
check('a refused create leaves nothing behind', store.count() === 2);

// ----------------------------------------------------------- 3. list order
console.log('\nstore: list ordering');
const bravo = store.create({ name: 'Bravo' });
await sleep(6);
const lima = store.create({ name: 'Lima' });
await sleep(6);
const charlie = store.create({ name: 'Charlie' });

const ids = (order) => store.list({ order }).map(p => p.id);
check('recent puts the newest first',
  JSON.stringify(ids('recent').slice(0, 3))
    === JSON.stringify([charlie.id, lima.id, bravo.id]),
  ids('recent').slice(0, 3).join(','));
check('oldest puts the oldest first',
  JSON.stringify(ids('oldest').slice(0, 3))
    === JSON.stringify([alpha.id, defaulted.id, bravo.id]),
  ids('oldest').slice(0, 3).join(','));
const byName = store.list({ order: 'name' }).map(p => p.name);
check('name sorts case-insensitively', byName.every((n, i) =>
  i === 0 || byName[i - 1].localeCompare(n, 'en', { sensitivity: 'base' }) <= 0),
  byName.join(','));
check('an unknown order falls back to recent', ids('nonsense').length === 5,
  `${ids('nonsense').length}`);

await sleep(6);
store.update(bravo.id, { doc: {} });
check('editing bumps a project to the top of recents',
  ids('recent')[0] === bravo.id, ids('recent').join(','));

// -------------------------------------------------------------- 4. update
console.log('\nstore: updating');
const renamed = store.update(alpha.id, { name: 'Renamed' });
check('a name change lands', renamed.name === 'Renamed');
check('the document name follows the column', renamed.doc.name === 'Renamed');

const retitled = store.update(alpha.id, { doc: { mode: 'overlay', overlayIds: ['o2tilt-arc'] } });
check('a document change lands', retitled.doc.mode === 'overlay'
  && retitled.doc.overlayIds.join(',') === 'o2tilt-arc');
check('a document change keeps the name', retitled.name === 'Renamed');

const noChange = store.update(alpha.id, {});
check('an empty patch is a no-op', noChange.name === 'Renamed');
check('...but still reads back the current row', noChange.doc.mode === 'overlay');

expectError('a bad document is refused on update',
  () => store.update(alpha.id, { doc: 'nope' }), 'invalid');
expectError('an unknown id cannot be updated',
  () => store.update('does-not-exist', { name: 'x' }), 'not_found');
expectError('an unknown id cannot be read',
  () => store.get('does-not-exist'), 'not_found');

// ----------------------------------------------------------- 5. duplicate
console.log('\nstore: duplicating');
const copy = store.duplicate(charlie.id);
check('the copy gets its own id', copy.id !== charlie.id);
check('the copy is named after the original', copy.name === 'Copy of Charlie');
check('the copy document agrees with its name', store.get(copy.id).doc.name === 'Copy of Charlie');
check('the original is untouched', store.get(charlie.id).name === 'Charlie');
check('the copy keeps the original document', store.get(copy.id).doc.mode
  === store.get(charlie.id).doc.mode);

const named = store.duplicate(charlie.id, '  Second   copy ');
check('a duplicate can be named directly', named.name === 'Second copy');
expectError('a duplicate needs a real original',
  () => store.duplicate('nope'), 'not_found');

// ------------------------------------------------------------ 6. thumbnail
console.log('\nstore: thumbnails');
const JPEG = 'data:image/jpeg;base64,AAAA';
expectError('a thumbnail must be an image data URL',
  () => store.setThumb(charlie.id, 'hello'), 'invalid');
expectError('an oversized thumbnail is refused',
  () => store.setThumb(charlie.id, JPEG + 'x'.repeat(MAX_THUMB)), 'invalid');
expectError('an unknown project cannot take a thumbnail',
  () => store.setThumb('nope', JPEG), 'not_found');
expectError('a project with no thumbnail returns not_found',
  () => store.getThumb(charlie.id), 'not_found');

store.setThumb(charlie.id, JPEG);
check('a stored thumbnail is readable', store.getThumb(charlie.id) === JPEG);
check('the summary flips hasThumb', store.get(charlie.id).thumb === JPEG
  && store.list().find(p => p.id === charlie.id).hasThumb === true);
store.clearThumb(charlie.id);
check('clearing removes it', throws(() => store.getThumb(charlie.id)));

expectError('clearing an unknown project fails',
  () => store.clearThumb('nope'), 'not_found');

// ------------------------------------------------------------- 7. delete
console.log('\nstore: deleting');
const doomed = store.create({ name: 'Doomed' });
const before = store.count();
check('remove reports success', store.remove(doomed.id) === true);
check('the row is gone', store.count() === before - 1);
expectError('removing twice is a 404, not a crash',
  () => store.remove(doomed.id), 'not_found');

// -------------------------------------------------------- 8. persistence
console.log('\nstore: persistence');
const survivors = store.count();
store.close();
store = openStore(DB);
check('everything is still there after a reopen', store.count() === survivors);
check('the reopened document kept its content',
  store.get(charlie.id).name === 'Charlie' && store.get(alpha.id).name === 'Renamed');

// ------------------------------------------------------------- 9. the seam
console.log('\nstore: the driver seam');
const SQLITE_IMPORT = /from\s+['"]node:sqlite['"]/;
const allSources = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(mjs|js)$/.test(e.name)) allSources.push(path.relative(DECOR, p));
  }
})(DECOR);
const sqliteImporters = allSources.filter(rel => SQLITE_IMPORT.test(read(rel)));

check('store.mjs never imports the database directly', !SQLITE_IMPORT.test(storeSrc));
check('store.mjs never knows about HTTP', !/node:http|fetch\(/.test(storeSrc));
check('store.mjs only talks through a driver', /driver\.(all|get|run|exec)\(/.test(storeSrc));
check('the dialect is declared', Array.isArray(DRIVER_DIALECT)
  && DRIVER_DIALECT.join(',') === 'all,get,run,exec,close');
check('exactly one file imports node:sqlite',
  sqliteImporters.length === 1 && sqliteImporters[0] === 'tools/sqlite-driver.mjs',
  sqliteImporters.join(', ') || 'none');

const fake = createStore(memoryDriver());
check('createStore works against a driver that touches no disk',
  fake.create({ name: 'In memory' }).name === 'In memory');
check('...and can still list', Array.isArray(fake.list()));
fake.close();

check('the schema version is declared', SCHEMA_VERSION >= 1);

// A store handed a corrupt row must degrade, not throw at boot.
const corrupt = createStore(memoryDriver());
corrupt.driver.get = () => ({ id: 'z', name: 'z', created_at: 1, updated_at: 1, thumb: null, doc: '{bad' });
check('a corrupt stored document reads back as a fresh one',
  (() => { const p = corrupt.get('z'); return p.doc && p.doc.mode === 'single'; })());
corrupt.close();

// -------------------------------------------------------------- 10. the API
console.log('\napi: HTTP surface');
const API_DB = path.join(TMP, 'api-test.db');
const sweepApi = () => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(API_DB + suffix); } catch { /* gone */ }
  }
};
sweepApi();

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.on('error', reject);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

const apiPort = await freePort();
const child = spawn(process.execPath, [path.join(DECOR, 'tools', 'serve.mjs')], {
  env: { ...process.env, HOST: '127.0.0.1', PORT: String(apiPort), DB_PATH: API_DB },
  stdio: ['ignore', 'pipe', 'pipe']
});
let apiLog = '';
child.stdout.on('data', d => { apiLog += d; });
child.stderr.on('data', d => { apiLog += d; });

const API = `http://127.0.0.1:${apiPort}`;
const call = (method, route, body) => fetch(API + route, body === undefined
  ? { method }
  : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

let apiUp = false;
try {
  const deadline = Date.now() + 8000;
  while (!apiUp && Date.now() < deadline) {
    try { apiUp = (await fetch(API + '/TILT.html')).ok; } catch { /* not yet */ }
    if (!apiUp) await sleep(100);
  }
  check('the server boots with a private database path', apiUp,
    apiLog.trim().split('\n').pop());

  if (apiUp) {
    let list = await (await call('GET', '/api/projects')).json();
    check('an untouched database lists nothing',
      Array.isArray(list.projects) && list.projects.length === 0, JSON.stringify(list));

    const created = await call('POST', '/api/projects', { name: '  My   Project  ' });
    check('POST creates with 201', created.status === 201, `${created.status}`);
    const made = await created.json();
    check('the name is normalised', made.name === 'My Project', made.name);
    check('an id comes back', typeof made.id === 'string' && made.id.length > 8);
    check('a new project reports no thumbnail', made.hasThumb === false);

    list = await (await call('GET', '/api/projects')).json();
    check('it now shows up in the list', list.projects.length === 1);
    check('the list is summary only, no document', list.projects[0].doc === undefined);

    let got = await call('GET', `/api/projects/${made.id}`);
    check('GET returns 200', got.status === 200, `${got.status}`);
    let full = await got.json();
    check('the document rides along', full.doc && typeof full.doc === 'object');
    check('the raw thumbnail does not ride along', full.thumb === undefined);
    check('the document name matches the row', full.doc.name === 'My Project');

    const renamed = await (await call('PATCH', `/api/projects/${made.id}`,
      { name: 'Renamed over HTTP' })).json();
    check('PATCH renames', renamed.name === 'Renamed over HTTP', renamed.name);
    check('the document name follows', renamed.doc.name === 'Renamed over HTTP');

    const documented = await (await call('PATCH', `/api/projects/${made.id}`,
      { doc: { mode: 'overlay', activeId: 'o2tilt-arc', overlayIds: ['o2tilt-arc'] } })).json();
    check('PATCH writes the document', documented.doc.mode === 'overlay'
      && documented.doc.activeId === 'o2tilt-arc');
    check('PATCH keeps the name', documented.name === 'Renamed over HTTP');

    check('an empty PATCH is a 400', (await call('PATCH', `/api/projects/${made.id}`, {})).status === 400);
    check('a bad document is a 400',
      (await call('PATCH', `/api/projects/${made.id}`, { doc: 'nope' })).status === 400);
    check('an unknown project is a 404',
      (await call('GET', '/api/projects/nope')).status === 404);
    check('an unknown project cannot be deleted',
      (await call('DELETE', '/api/projects/nope')).status === 404);

    const dup = await call('POST', `/api/projects/${made.id}/duplicate`);
    check('duplicate answers 201', dup.status === 201, `${dup.status}`);
    const duped = await dup.json();
    check('the copy is named after the original', duped.name === 'Copy of Renamed over HTTP',
      duped.name);

    const exported = await call('GET', `/api/projects/${made.id}/export`);
    check('export answers 200', exported.status === 200, `${exported.status}`);
    check('export is a download',
      String(exported.headers.get('content-disposition')).includes('.tilt.json'),
      String(exported.headers.get('content-disposition')));
    const exportedDoc = JSON.parse(await exported.text());
    check('the exported file is a project document',
      exportedDoc.mode === 'overlay' && exportedDoc.name === 'Renamed over HTTP');

    const imported = await call('POST', '/api/projects/import', exportedDoc);
    check('import accepts a bare document', imported.status === 201, `${imported.status}`);
    const importedRow = await imported.json();
    check('the import carries the document across',
      (await (await call('GET', `/api/projects/${importedRow.id}`)).json()).doc.mode === 'overlay');

    const wrapped = await call('POST', '/api/projects/import',
      { name: 'From a wrapper', doc: { mode: 'single' } });
    check('import also accepts {name, doc}', wrapped.status === 201, `${wrapped.status}`);
    check('...and prefers the wrapper name', (await wrapped.json()).name === 'From a wrapper');

    const JPEG = 'data:image/jpeg;base64,' + Buffer.from('fake-image-bytes').toString('base64');
    check('a thumbnail can be stored', (await call('PUT', `/api/projects/${made.id}/thumb`,
      { thumb: JPEG })).status === 204);
    const thumbRes = await call('GET', `/api/projects/${made.id}/thumb`);
    check('the thumbnail is served as an image',
      thumbRes.status === 200 && String(thumbRes.headers.get('content-type')) === 'image/jpeg',
      `${thumbRes.status} ${thumbRes.headers.get('content-type')}`);
    check('...with the original bytes',
      Buffer.from(await thumbRes.arrayBuffer()).toString() === 'fake-image-bytes');
    check('the project now reports hasThumb',
      (await (await call('GET', `/api/projects/${made.id}`)).json()).hasThumb === true);
    check('a thumbnail can be cleared', (await call('DELETE',
      `/api/projects/${made.id}/thumb`)).status === 204);
    check('...and is then a 404',
      (await call('GET', `/api/projects/${made.id}/thumb`)).status === 404);
    check('a bad thumbnail is a 400', (await call('PUT', `/api/projects/${made.id}/thumb`,
      { thumb: 'not-an-image' })).status === 400);

    const ordered = await (await call('GET', '/api/projects?order=name')).json();
    check('ordering survives the query string',
      ordered.projects.length === 4
        && ordered.projects[0].name === 'Copy of Renamed over HTTP',
      ordered.projects.map(p => p.name).join(' | '));

    check('OPTIONS is answered', (await call('OPTIONS', '/api/projects')).status === 204);
    const wrong = await call('POST', `/api/projects/${made.id}`);
    check('an unsupported method is a 405 with Allow', wrong.status === 405
      && !!wrong.headers.get('allow'), `${wrong.status} allow=${wrong.headers.get('allow')}`);
    check('an unknown endpoint is a 404', (await call('GET', '/api/projects/x/y/z')).status === 404);
    check('an unknown namespace is a 404', (await call('GET', '/api/nope')).status === 404);
    check('garbage is a 400, not a crash', (await fetch(API + '/api/projects', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{'
    })).status === 400);

    const huge = await call('POST', '/api/projects', { name: 'x', doc: 'y'.repeat(600 * 1024) });
    check('an oversized API body is a 413', huge.status === 413, `${huge.status}`);

    check('the database directory is not downloadable',
      (await call('GET', '/data/o2tilt.db')).status === 403);
    check('a stray .db anywhere is not downloadable',
      (await call('GET', '/tests/.tmp/api-test.db')).status === 403);
    check('the sqlite wal is not downloadable',
      (await call('GET', '/tests/.tmp/api-test.db-wal')).status === 403);

    const deleted = await call('DELETE', `/api/projects/${importedRow.id}`);
    check('DELETE answers 204', deleted.status === 204, `${deleted.status}`);
    check('the project is gone', (await call('GET', `/api/projects/${importedRow.id}`)).status === 404);

    const direct = openStore(API_DB);
    check('the rows are really on disk', direct.count() === 3, `${direct.count()}`);
    check('the surviving document kept its content',
      direct.get(made.id).doc.mode === 'overlay');
    direct.close();
  }
} finally {
  child.kill('SIGTERM');
  await Promise.race([new Promise(r => child.once('exit', r)), sleep(2000)]);
  sweepApi();
}

console.log(fails === 0 ? '\nALL CHECKS PASSED' : `\n${fails} CHECK(S) FAILED`);
process.exit(fails ? 1 : 0);
