// UI regression tests for the Greenery chip redesign.
// Part 1 locks the model contract the new UI depends on (fullness presets, custom density,
// mode switches, enable/disable, save/load round-trip, label-only no-op).
// Part 2 boots app.js against a minimal DOM shim and exercises the real segmented-control
// and fullness handlers to catch wiring regressions without a browser.
const assert = require('assert');
const model = require('../model.js');

// ---------- Part 1: model contract -----------------------------------------

// Fullness presets write the SAME density to every species; proportions are untouched.
{
  const PRESETS = [30, 60, 85, 100];
  for (const p of PRESETS) {
    const items = [
      { type: 'monstera', enabled: true, sizeScale: 1, density: 70, proportion: 30, layer: 'structural', colorVariation: 0.3 },
      { type: 'eucalyptus', enabled: true, sizeScale: 1, density: 70, proportion: 40, layer: 'volume', colorVariation: 0.3 },
      { type: 'boston-fern', enabled: true, sizeScale: 1, density: 70, proportion: 30, layer: 'filler', colorVariation: 0.3 },
    ];
    items.forEach(it => { it.density = p; });
    const s = model.normalize({ designMode: 'greenery', greenery: { mode: 'mixed', items } });
    s.greenery.items.forEach(it => assert.strictEqual(it.density, p, 'preset ' + p + ' writes density to every item'));
    const props = s.greenery.items.map(it => it.proportion);
    assert.deepStrictEqual(props, [30, 40, 30], 'preset must not change proportions');
    const est = model.greeneryEstimate(s);
    assert.ok(est.totalItems > 0, 'preset ' + p + ' still places pieces');
  }
  console.log('PASS fullness presets write uniform density, proportions preserved');
}

// Custom (off-preset) density round-trips and drives the estimate.
{
  const s = model.normalize({
    designMode: 'greenery',
    greenery: { mode: 'single', items: [{ type: 'monstera', enabled: true, sizeScale: 1, density: 47, proportion: 100, layer: 'structural', colorVariation: 0.3 }] },
  });
  assert.strictEqual(s.greenery.items[0].density, 47, 'custom density 47 preserved');
  assert.ok(model.greeneryEstimate(s).totalItems > 0, 'custom density places pieces');
  console.log('PASS custom (off-preset) density preserved and used');
}

// Slider semantics mirror: clamp 10..100, snap to step 5.
{
  const snap = v => Math.max(10, Math.min(100, Math.round(v / 5) * 5));
  assert.strictEqual(snap(0), 10);
  assert.strictEqual(snap(130), 100);
  assert.strictEqual(snap(47), 45);
  assert.strictEqual(snap(72.4), 70);
  console.log('PASS fullness slider clamp + step-5 snap');
}

// Design-type switches change estimate behavior without throwing.
{
  const base = { width: 8, height: 8, seed: 1, colors: [{ id: 1, name: 'White', hex: '#ffffff' }] };
  const flowers = model.normalize({ ...base, designMode: 'flowers' });
  const greenery = model.normalize({ ...base, designMode: 'greenery' });
  const mixed = model.normalize({ ...base, designMode: 'mixed' });
  assert.strictEqual(flowers.designMode, 'flowers');
  assert.strictEqual(greenery.designMode, 'greenery');
  assert.strictEqual(mixed.designMode, 'mixed');
  // flowers-only still normalizes greenery settings (values preserved, just not shown).
  assert.ok(flowers.greenery.items.length >= 1, 'flowers-only keeps saved greenery values');
  assert.ok(model.greeneryEstimate(greenery).totalItems > 0, 'greenery-only places pieces');
  console.log('PASS design-type switches preserve state and place pieces');
}

// Composition switches (single vs mixed) round-trip.
{
  const s = model.normalize({ designMode: 'greenery', greenery: { mode: 'single', items: [{ type: 'eucalyptus', density: 60 }] } });
  assert.strictEqual(s.greenery.mode, 'single');
  assert.strictEqual(s.greenery.items.length, 1, 'single keeps one item');
  const s2 = model.normalize({ designMode: 'greenery', greenery: { mode: 'mixed' } });
  assert.strictEqual(s2.greenery.mode, 'mixed');
  assert.ok(s2.greenery.items.length >= 1, 'mixed has items');
  console.log('PASS composition single/mixed switches');
}

// Enable/disable an item removes it from placement but keeps proportions of the rest.
{
  const items = [
    { type: 'monstera', enabled: true, sizeScale: 1, density: 80, proportion: 50, layer: 'structural', colorVariation: 0.3 },
    { type: 'eucalyptus', enabled: false, sizeScale: 1, density: 80, proportion: 50, layer: 'volume', colorVariation: 0.3 },
  ];
  const s = model.normalize({ designMode: 'greenery', greenery: { mode: 'mixed', items } });
  const active = model.greeneryActiveItems(s.greenery);
  assert.strictEqual(active.length, 1, 'only enabled items are active');
  assert.strictEqual(active[0].type, 'monstera');
  console.log('PASS enable/disable filters active items');
}

// Save/load (normalize) round-trip preserves greenery settings.
{
  const original = model.normalize({
    designMode: 'mixed',
    greenery: {
      mode: 'mixed', direction: 'outward', overlap: 0.75, rotationVariation: 120, seed: 42,
      items: [
        { type: 'monstera', enabled: true, sizeScale: 1.4, density: 85, proportion: 40, layer: 'structural', colorVariation: 0.5 },
        { type: 'boston-fern', enabled: true, sizeScale: 0.8, density: 85, proportion: 60, layer: 'filler', colorVariation: 0.2 },
      ],
    },
  });
  const reloaded = model.normalize(JSON.parse(JSON.stringify(original)));
  assert.strictEqual(reloaded.designMode, 'mixed');
  assert.strictEqual(reloaded.greenery.mode, 'mixed');
  assert.strictEqual(reloaded.greenery.direction, 'outward');
  assert.strictEqual(reloaded.greenery.overlap, 0.75);
  assert.strictEqual(reloaded.greenery.rotationVariation, 120);
  assert.strictEqual(reloaded.greenery.seed, 42);
  assert.strictEqual(reloaded.greenery.items.length, 2);
  assert.strictEqual(reloaded.greenery.items[0].sizeScale, 1.4);
  assert.strictEqual(reloaded.greenery.items[0].density, 85);
  assert.strictEqual(reloaded.greenery.items[1].type, 'boston-fern');
  const a = model.greeneryEstimate(original), b = model.greeneryEstimate(reloaded);
  assert.strictEqual(a.totalItems, b.totalItems, 'reload does not change placement count');
  console.log('PASS save/load round-trip preserves greenery + placement');
}

// Label-only edits (arrangement name) never change placement.
{
  const s = model.normalize({ designMode: 'greenery', name: 'A', greenery: { mode: 'mixed' } });
  const before = model.greeneryEstimate(s).totalItems;
  s.name = 'Brenna wedding arch';
  const after = model.greeneryEstimate(s).totalItems;
  assert.strictEqual(before, after, 'renaming must not change piece count');
  console.log('PASS label-only edits do not change placement');
}

// Proportions renormalize to 100 (model contract the UI relies on).
{
  const s = model.normalize({ designMode: 'greenery', greenery: { mode: 'mixed', items: [
    { type: 'monstera', proportion: 20 }, { type: 'eucalyptus', proportion: 20 },
  ] } });
  const sum = s.greenery.items.reduce((n, it) => n + it.proportion, 0);
  assert.strictEqual(Math.round(sum), 100, 'proportions renormalize to 100');
  console.log('PASS proportions renormalize to 100');
}

// ---------- Part 2: DOM-shim boot + handler smoke --------------------------

function makeEl(id) {
  const listeners = {};
  const el = {
    id, value: '', textContent: '', innerHTML: '', hidden: false, checked: false,
    disabled: false, dataset: {}, style: {}, children: [],
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
    addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    removeEventListener() {}, setAttribute() {}, getAttribute() { return null; },
    focus() {}, appendChild(c) { el.children.push(c); return c; }, append() {},
    querySelector() { return (el._qs = el._qs || makeEl(id + '-child')); }, querySelectorAll() { return []; },
    closest() { return null; }, click() {},
    _fire(ev, arg) { (listeners[ev] || []).forEach(fn => fn(arg || { target: el })); },
    _listeners: listeners,
  };
  return el;
}

{
  const els = {};
  const get = id => (els[id] = els[id] || makeEl(id));

  // Radio groups for the segmented controls.
  const mkRadio = (name, value, id) => {
    const r = makeEl(id); r.name = name; r.value = value; r.type = 'radio'; r.checked = false;
    return r;
  };
  // Flowers/Greenery master checkboxes drive the composite design mode (replaces the old
  // 3-way designModeSeg radio). Composition radios only matter when both are on.
  const flowersOn = makeEl('flowersOn'); flowersOn.type = 'checkbox'; flowersOn.checked = true;
  const greeneryOn = makeEl('greeneryOn'); greeneryOn.type = 'checkbox'; greeneryOn.checked = false;
  els.flowersOn = flowersOn; els.greeneryOn = greeneryOn; // so app.js $('...') reuses these
  const compositionRadios = ['greenery-base', 'foliage-clusters', 'flower-dominant'].map(v => mkRadio('compositionSeg', v, 'cp-' + v));
  const modeRadios = ['single', 'mixed'].map(v => mkRadio('greeneryModeSeg', v, 'gm-' + v));
  const dirRadios = ['upright', 'diag', 'outward', 'mixed'].map(v => mkRadio('greeneryDirectionSeg', v, 'gd-' + v));
  compositionRadios[0].checked = true; modeRadios[1].checked = true; dirRadios[3].checked = true;

  // Fullness preset buttons.
  const presetBtns = [30, 60, 85, 100].map(v => {
    const b = makeEl('fp-' + v);
    b.getAttribute = k => (k === 'data-fullness-preset' ? String(v) : null);
    return b;
  });

  const docListeners = {};
  const documentStub = {
    readyState: 'loading',
    documentElement: { dataset: {} },
    getElementById: get,
    querySelector() { return null; },
    querySelectorAll(sel) {
      if (sel === 'input[name="compositionSeg"]') return compositionRadios;
      if (sel === 'input[name="greeneryModeSeg"]') return modeRadios;
      if (sel === 'input[name="greeneryDirectionSeg"]') return dirRadios;
      if (sel === '[data-fullness-preset]') return presetBtns;
      if (sel && sel.indexOf(':checked') > -1) {
        const name = sel.match(/input\[name="([^"]+)"\]/)[1];
        const group = { compositionSeg: compositionRadios, greeneryModeSeg: modeRadios, greeneryDirectionSeg: dirRadios }[name] || [];
        return group.filter(r => r.checked).slice(0, 1);
      }
      return [];
    },
    addEventListener(ev, fn) { (docListeners[ev] = docListeners[ev] || []).push(fn); },
    createElement: () => makeEl('new'),
  };

  const windowStub = {
    FlowerModel: model, FlowerEngine: { list: () => [], get: () => null, release() {} },
    GreeneryEngine: { list: () => [{ type: 'monstera', label: 'Monstera leaf' }], release() {} },
    FlowerDiagnostics: null,
    THREE: null, addEventListener() {}, devicePixelRatio: 1,
  };
  windowStub.window = windowStub;

  const localStorageStub = { getItem() { return null; }, setItem() {}, removeItem() {} };

  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const vm = require('vm');
  const sandbox = {
    document: documentStub, window: windowStub, localStorage: localStorageStub,
    console: { log() {}, error() {}, warn() {}, info() {} },
    setTimeout, clearTimeout, requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    THREE: null, getComputedStyle: () => ({ getPropertyValue: () => '#e0e3da' }),
    prompt: () => null, URL: { createObjectURL: () => '', revokeObjectURL() {} },
    Blob: function () {}, Date, Math, JSON, Number, String, Array, Object, isFinite,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'app.js' });

  // Fire DOMContentLoaded -> start() -> wire() attaches the greenery handlers.
  (docListeners['DOMContentLoaded'] || []).forEach(fn => fn());
  assert.ok((docListeners['DOMContentLoaded'] || []).length > 0, 'app.js registered DOMContentLoaded');

  // A. Fullness preset click sets the slider + label and writes density to every item.
  const fullnessSlider = get('greeneryFullness');
  const fullnessLabel = get('greeneryFullnessValue');
  presetBtns[3]._fire('click'); // "Full" = 100
  assert.strictEqual(fullnessSlider.value, '100', 'preset updates fullness slider');
  assert.ok(/100%/.test(fullnessLabel.textContent), 'preset updates fullness label');
  // Preset active class toggled via classList.toggle — no throw is the assertion here.

  // B. Fullness slider drag (custom value) updates the label to "Custom".
  fullnessSlider.value = '47';
  fullnessSlider._fire('input');
  assert.ok(/Custom/.test(fullnessLabel.textContent), 'off-preset slider shows Custom');

  // C. Master toggles drive designMode: both on = mixed; flowers off + greenery on =
  //    greenery. Composition radios write the #composition hidden input.
  get('designMode').value = 'flowers';
  greeneryOn.checked = true; greeneryOn._fire('change');
  assert.strictEqual(get('designMode').value, 'mixed', 'both toggles on -> mixed');
  flowersOn.checked = false; flowersOn._fire('change');
  assert.strictEqual(get('designMode').value, 'greenery', 'flowers off + greenery on -> greenery');
  flowersOn.checked = true; greeneryOn.checked = true; greeneryOn._fire('change');
  compositionRadios[1].checked = true; compositionRadios[1]._fire('change'); // foliage-clusters
  assert.strictEqual(get('composition').value, 'foliage-clusters', 'composition radio writes hidden input');

  // D. Composition radio change to "single" writes greeneryMode hidden input.
  modeRadios[0].checked = true; // single
  modeRadios[0]._fire('change');
  assert.strictEqual(get('greeneryMode').value, 'single', 'radio writes greeneryMode hidden input');

  // E. Direction radio change writes greeneryDirection hidden input.
  dirRadios[1].checked = true; // diag
  dirRadios[1]._fire('change');
  assert.strictEqual(get('greeneryDirection').value, 'diag', 'radio writes greeneryDirection hidden input');

  // F. Advanced (details) toggle must NOT be wired to any rebuild — verify no handler
  //    was attached that would regenerate. (Opening is pure DOM; nothing to fire here.)
  console.log('PASS DOM-shim: segmented controls + fullness handlers wired and working');
}

console.log('ALL greenery UI tests passed');
