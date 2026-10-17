/* Headless flower-engine tests.
   Loads real three.js r128 (no WebGL needed — geometry + instancing math only),
   builds every species, and asserts sane mesh/instance/triangle output.
   three.js is resolved from $THREE_BUILD, else a cached copy in os.tmpdir(), else require('three').
   Skips cleanly if three.js cannot be found. */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

function loadThree() {
  const candidates = [
    process.env.THREE_BUILD,
    path.join(os.tmpdir(), 'flower-three128.js')
  ].filter(Boolean);
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return require(p); } catch (_) {}
  }
  try { return require('three'); } catch (_) {}
  return null;
}

const THREE = loadThree();
if (!THREE) {
  console.log('SKIP flower-engine tests: three.js not found (set THREE_BUILD or cache it in os.tmpdir()/flower-three128.js)');
  process.exit(0);
}
global.THREE = THREE;

const ROOT = path.join(__dirname, '..');
// Load engine modules (they attach to globalThis and need global.THREE set first).
require(path.join(ROOT, 'js/flowers/core.js'));
['rose', 'marigold', 'chrysanthemum', 'dahlia', 'gerbera'].forEach(s =>
  require(path.join(ROOT, 'js/flowers', s + '.js')));
require(path.join(ROOT, 'js/flowers/flower-factory.js'));

const engine = global.FlowerEngine;
const core = global.FlowerCore;
assert(engine, 'FlowerEngine should be defined');
assert(core, 'FlowerCore should be defined');

// --- registry ---
const types = engine.list().map(t => t.type);
for (const t of ['rose', 'marigold', 'chrysanthemum', 'dahlia', 'gerbera']) {
  assert(types.includes(t), 'species missing from registry: ' + t);
}
console.log('PASS registry: ' + types.join(', '));

// --- unknown species must throw (never silently fall back) ---
assert.throws(() => engine.build({ type: 'nope', flowers: [], colors: [], S: 1 }), /Unknown flower type/);
console.log('PASS unknown species throws');

// --- build every species and validate instancing output ---
const colors = [new THREE.Color('#ffffff'), new THREE.Color('#ffc0cb'), new THREE.Color('#ffd166')];
const flowers = [];
for (let i = 0; i < 60; i++) flowers.push({ x: (i % 10) * 0.3 - 1.4, y: Math.floor(i / 10) * 0.3 - 0.9, seed: i, colorIndex: i % 3 });

const perSpecies = {};
for (const t of types) {
  const def = engine.get(t);
  const hasCenter = !!def.center;
  const res = engine.build({ type: t, flowers, colors, S: 0.3 });
  assert(Array.isArray(res.meshes) && res.meshes.length > 0, t + ': no meshes');
  let instances = 0, colored = 0, bad = 0, rings = 0, uncoloredRings = 0;
  res.meshes.forEach((m, mi) => {
    assert(m.isInstancedMesh, t + ': mesh is not InstancedMesh');
    assert(m.count >= 0, t + ': negative instance count');
    instances += m.count;
    if (m.instanceColor) colored += m.count;
    // BUG-01 guard: with vertexColors:true, MeshStandardMaterial has no defaultAttributeValues,
    // so a missing geometry colour attribute renders BLACK on the GPU. Every geometry must
    // carry a white colour attribute, and the material must set vertexColors for instanceColor
    // to tint the diffuse at all.
    assert(m.material && m.material.vertexColors === true, t + ': material must set vertexColors so instanceColor tints');
    const geoColor = m.geometry && m.geometry.attributes && m.geometry.attributes.color;
    assert(geoColor, t + ': geometry needs a white colour attribute (else it renders black)');
    if (geoColor) {
      const carr = geoColor.array;
      for (let k = 0; k < carr.length; k++) {
        if (Math.abs(carr[k] - 1) > 1e-6) assert.fail(t + ': colour attribute must be white (1,1,1)');
      }
    }
    // Every petal ring (all meshes except a possible trailing centre) must be coloured.
    const isCenter = hasCenter && mi === res.meshes.length - 1;
    if (!isCenter) { rings++; if (!m.instanceColor) uncoloredRings++; }
    const ma = m.instanceMatrix.array;
    for (let k = 0; k < ma.length; k++) if (!Number.isFinite(ma[k])) { bad++; break; }
    if (m.instanceColor) {
      const ca = m.instanceColor.array;
      for (let k = 0; k < ca.length; k++) if (!Number.isFinite(ca[k])) { bad++; break; }
    }
  });
  assert.strictEqual(bad, 0, t + ': non-finite matrix/color values');
  assert(instances > 0, t + ': zero instances');
  assert.strictEqual(uncoloredRings, 0, t + ': every petal ring should carry instance colours');
  assert(colored >= res.petalsPerFlower * flowers.length, t + ': petals should be coloured');
  const expected = res.petalsPerFlower * flowers.length + (hasCenter ? flowers.length : 0);
  assert.strictEqual(instances, expected, t + ': instance count should be petals + centre');
  assert(res.triangles > 0 && Number.isFinite(res.triangles), t + ': bad triangle count');
  assert(res.perFlowerTriangles > 0, t + ': bad per-flower triangle count');
  perSpecies[t] = { instances, ppf: res.petalsPerFlower, rings, triangles: res.triangles };
  // release must not throw and should clear meshes
  engine.release(res.meshes);
  assert(res.meshes.every(m => !m.parent), t + ': release should detach meshes');
  console.log(`PASS build ${t}: rings=${rings} instances=${instances} petals/flower=${res.petalsPerFlower} triangles=${res.triangles}`);
}

// --- petalsPerFlower API consistency + density ordering ---
for (const t of types) {
  assert.strictEqual(engine.petalsPerFlower(t), perSpecies[t].ppf,
    t + ': petalsPerFlower API should match built petals');
  assert(perSpecies[t].ppf > 0, t + ': should have petals');
}
// marigold (dense) should have more petals than rose; gerbera (flat) fewer than marigold
assert(perSpecies.marigold.ppf > perSpecies.rose.ppf, 'marigold should be denser than rose');
assert(perSpecies.gerbera.ppf < perSpecies.marigold.ppf, 'gerbera should be less dense than marigold');
console.log('PASS per-species petal density ordering');

// --- geometry cache: rebuilding same species must reuse the same geometries ---
const a = engine.ensureGeometry('rose');
const b = engine.ensureGeometry('rose');
assert.strictEqual(a.layers[0]._geometry, b.layers[0]._geometry, 'same-species rebuild should reuse cached geometry');
const c = engine.ensureGeometry('dahlia');
assert.notStrictEqual(a.layers[0]._geometry, c.layers[0]._geometry, 'different species should use different geometry');
console.log('PASS geometry cache reuse');

console.log('ALL flower-engine tests passed');
