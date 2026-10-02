import fs from 'node:fs';
import path from 'node:path';
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

console.log(fails === 0 ? '\nALL CHECKS PASSED' : `\n${fails} CHECK(S) FAILED`);
process.exit(fails ? 1 : 0);
