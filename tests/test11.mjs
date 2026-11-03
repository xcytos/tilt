import * as THREE from './vendor/three160.js';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

// Runtime contract + build smoke test for the flowerpanel object factory.
// Loads the real flower graph (model -> cores -> species -> engines -> scene ->
// factory) against the vendored three r160, by copying the modules into a temp
// tree and rewriting their bare 'three' import to the vendored file (Node has no
// import maps). Then exercises createFlowerPanelModel end to end.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DECOR = path.resolve(HERE, '..');
const TMP = path.join(HERE, '.tmp', 'fp');
const VENDOR = pathToFileURL(path.join(HERE, 'vendor', 'three160.js')).href;

let fails = 0;
const check = (l, c, x = '') => {
  if (c) console.log('  ok   ' + l);
  else { fails++; console.log('  FAIL ' + l + (x ? '  ' + x : '')); }
};

// 1. Mirror the flower module graph into TMP, rewriting 'three' imports.
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(path.join(TMP, 'js', 'objects'), { recursive: true });
const copy = (rel) => {
  const src = path.join(DECOR, rel);
  const dst = path.join(TMP, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  return dst;
};
copy('js/flowermodel.js');
for (const d of ['flowers', 'greenery']) {
  for (const f of fs.readdirSync(path.join(DECOR, 'js', d))) {
    if (f.endsWith('.js')) copy(`js/${d}/${f}`);
  }
}
copy('js/objects/flowerpanel.js');

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
for (const file of walk(path.join(TMP, 'js'))) {
  if (!file.endsWith('.js')) continue;
  const src = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, src.replaceAll("from 'three'", `from '${VENDOR}'`));
}

const mod = await import(pathToFileURL(path.join(TMP, 'js', 'objects', 'flowerpanel.js')).href);
const { createFlowerPanelModel, FLOWERPANEL_ID, FLOWERPANEL_PARAMS } = mod;

console.log('\nFlower Panel factory — contract');
check('exports createFlowerPanelModel', typeof createFlowerPanelModel === 'function');
check('stable id', FLOWERPANEL_ID === 'flowerpanel');
check('params schema carries the Enabled toggle', FLOWERPANEL_PARAMS
  && FLOWERPANEL_PARAMS.enabled
  && FLOWERPANEL_PARAMS.enabled.type === 'toggle'
  && FLOWERPANEL_PARAMS.enabled.label === 'Enabled'
  && FLOWERPANEL_PARAMS.enabled.value === true
  && Object.keys(FLOWERPANEL_PARAMS).length === 1);

const model = createFlowerPanelModel();
check('id/name/subtitle present', model.id === 'flowerpanel' && typeof model.name === 'string' && typeof model.subtitle === 'string');
check('object3D is a mountable Object3D', model.object3D && model.object3D.isObject3D);
check('builds real content (backing + flowers)', model.object3D.children.length > 0, `${model.object3D.children.length} children`);
check('exposes params + state', !!model.params && !!model.state);
check('state carries normalized settings', model.state.settings && typeof model.state.settings.width === 'number' && typeof model.state.settings.height === 'number');
check('a fresh panel starts enabled and visible',
  model.state.enabled === true && model.object3D.visible === true);
check('a panel built with enabled:false starts hidden', (() => {
  const m = createFlowerPanelModel({ enabled: false });
  const hid = m.state.enabled === false && m.object3D.visible === false;
  m.dispose();
  return hid;
})());
check('exposes build/setTheme/setParams/getSettings/setSettings/dispose',
  ['build', 'setTheme', 'setParams', 'getSettings', 'setSettings', 'dispose'].every(k => typeof model[k] === 'function'));
check('stands on the floor (lifted by half height)', (() => {
  const panel = model.object3D.children[0];
  return panel && Math.abs(panel.position.y - model.state.settings.height / 2) < 1e-6;
})());
check('faces the camera (rotated 180° about Y)', (() => {
  const panel = model.object3D.children[0];
  return panel && Math.abs(panel.rotation.y - Math.PI) < 1e-6;
})());

console.log('\nFlower Panel factory — build lifecycle');
check('build() clears dirty', (model.build(), model.dirty === false));
check('setParams({settings}) marks dirty and rebuilds', (() => {
  const before = model.object3D.children[0].children[0].children.length;
  model.setParams({ settings: { width: 8, height: 6, designMode: 'greenery' } });
  const dirty = model.dirty === true;
  model.build();
  return dirty && model.state.settings.width === 8 && model.state.settings.designMode === 'greenery';
})());
check('greenery-only design still builds content', model.object3D.children[0].children[0].children.length > 0);
check('setSettings() replaces + marks dirty', (() => {
  model.setSettings({ width: 4, height: 4, designMode: 'flowers' });
  const ok = model.dirty === true && model.state.settings.width === 4;
  model.build();
  return ok && model.dirty === false;
})());

console.log('\nFlower Panel factory — the Enabled toggle');
check('setParams({enabled:false}) hides immediately, with no rebuild', (() => {
  const kids = model.object3D.children[0].children[0].children.length;
  model.setParams({ enabled: false });
  const hid = model.object3D.visible === false
    && model.state.enabled === false
    && model.dirty === false
    && model.object3D.children[0].children[0].children.length === kids;
  model.setParams({ enabled: true });
  return hid && model.object3D.visible === true && model.state.enabled === true;
})());
check('build() re-applies the toggle', (() => {
  model.setParams({ enabled: false });
  model.build();
  const hidden = model.object3D.visible === false && model.dirty === false;
  model.setParams({ enabled: true });
  model.build();
  return hidden && model.object3D.visible === true;
})());
check('a settings rebuild keeps the panel hidden while disabled', (() => {
  model.setParams({ enabled: false });
  model.setParams({ settings: { width: 5, height: 5, designMode: 'flowers' } });
  const dirty = model.dirty === true;
  model.build();
  return dirty && model.object3D.visible === false;
})());
model.setParams({ enabled: true });

console.log('\nFlower Panel factory — dispose');
model.dispose();
check('dispose() clears the object', model.object3D.children.length === 0);

console.log(fails ? `\n${fails} FAILING` : '\nALL CHECKS PASSED');
process.exit(fails ? 1 : 0);
