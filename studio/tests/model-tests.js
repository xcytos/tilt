const assert = require('assert');
const model = require('../model.js');
for (const flowerSize of [4, 5, 6]) {
  const settings = { width: 8, height: 8, flowerSize, coverage: 100,
    colors: [{ id: 1, name: 'White', hex: '#ffffff' }, { id: 2, name: 'Pink', hex: '#ffc0cb' }] };
  const positions = model.positions(settings);
  const counts = model.counts(settings, positions.length);
  assert(positions.length > 0, `${flowerSize}in: no flower positions`);
  assert.strictEqual(counts.reduce((sum, item) => sum + item.count, 0), positions.length, `${flowerSize}in: color counts do not add up`);
  assert(Math.abs(counts[0].count - counts[1].count) <= 1, `${flowerSize}in: colors are not balanced`);
  const edgeX = settings.width * 0.72 / 2;
  const edgeY = settings.height * 0.72 / 2;
  // Full coverage deliberately overhangs (outer ring hides the foam edge), so centers may
  // sit past the panel — but only by about the overhang, and symmetrically on both sides.
  const diameter = flowerSize / 12 * 0.72;
  const step = diameter * 0.65; // rose pack factor 1.0
  const over = diameter * 0.45;
  const bound = over + step + 1e-6; // overhang + at most one grid step of slack
  const xs = positions.map(([x]) => x), ys = positions.map(([, y]) => y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  assert(minX >= -edgeX - bound && maxX <= edgeX + bound && minY >= -edgeY - bound && maxY <= edgeY + bound,
    `${flowerSize}in: a flower center is far outside the panel`);
  // The bug this guards: the grid must be centred — left/right and top/bottom overhang
  // equally (within a step), instead of one side empty and the other overflowing.
  assert(Math.abs(minX + maxX) <= step + 1e-6, `${flowerSize}in: left/right not symmetric (min ${minX} max ${maxX})`);
  assert(Math.abs(minY + maxY) <= step + 1e-6, `${flowerSize}in: top/bottom not symmetric (min ${minY} max ${maxY})`);
  console.log(`PASS ${flowerSize}in heads: ${positions.length} positions; colour balance ${counts.map(c => c.count).join('/')}`);
}

// Coverage thinning: at sub-100% a normal grid is thinned deterministically; 100% is a denser
// full-coverage grid (more flowers, outer ring overhangs the edges so no foam shows).
{
  const base = { width: 8, height: 8, flowerSize: 5,
    colors: [{ id: 1, name: 'White', hex: '#ffffff' }] };
  const full = model.positions({ ...base, coverage: 100 }); // dense full-coverage grid
  const c85 = model.positions({ ...base, coverage: 85 });
  const thin = model.positions({ ...base, coverage: 70 });
  assert(thin.length > 0 && thin.length < c85.length && c85.length < full.length,
    'coverage should reduce flower count and 100% should be densest');
  // Sub-100% thinning is deterministic and duplicate-free.
  const key = ([x, y]) => `${x.toFixed(6)},${y.toFixed(6)}`;
  assert.strictEqual(new Set(thin.map(key)).size, thin.length, 'thinned positions should not contain duplicates');
  assert.deepStrictEqual(model.positions({ ...base, coverage: 70 }), thin, 'thinning should be deterministic');
  // Sub-100% flowers stay inside the panel (full coverage may overhang the edge).
  const edgeX = base.width * 0.72 / 2, edgeY = base.height * 0.72 / 2;
  assert(thin.every(([x, y]) => Math.abs(x) <= edgeX + 1e-6 && Math.abs(y) <= edgeY + 1e-6),
    'sub-100% flowers should stay within the panel');
  console.log(`PASS coverage thinning: full ${full.length} > 85% ${c85.length} > 70% ${thin.length} (deterministic)`);
}

const normalized = model.normalize({ width: 100, height: -2, flowerSize: 7, coverage: 0, colors: [] });
assert.strictEqual(normalized.width, 30, 'width should be clamped to max');
assert.strictEqual(normalized.height, 1, 'height should be clamped to min');
assert.strictEqual(normalized.flowerSize, 5, 'unsupported flower size should fall back');
assert.strictEqual(normalized.coverage, 70, 'coverage below the slider minimum should clamp to 70');
assert.strictEqual(normalized.colors.length, 1, 'palette should never be empty');
assert.strictEqual(normalized.flowerType, 'rose', 'flowerType should default to rose');

// 0 is a real number and clamps to the minimum; '' / NaN / null fall back to the default.
assert.strictEqual(model.normalize({ width: 0 }).width, 1, 'width 0 should clamp to min');
assert.strictEqual(model.normalize({ width: '' }).width, 8, 'empty width should fall back to default');
assert.strictEqual(model.normalize({ width: 'abc' }).width, 8, 'non-numeric width should fall back to default');
assert.strictEqual(model.normalize({ coverage: '' }).coverage, 100, 'empty coverage should fall back to default');
assert.strictEqual(model.normalize({ coverage: 50 }).coverage, 70, 'coverage 50 should clamp to min');
console.log('PASS normalization edge cases');

// Flower types: every known type is accepted; unknown / empty fall back to rose.
for (const t of model.FLOWER_TYPES) {
  assert.strictEqual(model.normalize({ flowerType: t }).flowerType, t, t + ' should be accepted');
}
assert.strictEqual(model.normalize({ flowerType: 'tulip' }).flowerType, 'rose', 'unknown type should fall back to rose');
assert.strictEqual(model.normalize({ flowerType: '' }).flowerType, 'rose', 'empty type should fall back to rose');
assert.strictEqual(model.normalize({}).flowerType, 'rose', 'missing type should default to rose');

// Species packing: denser species (dahlia) place more flowers than rose than sparse (gerbera).
const packBase = { width: 8, height: 8, flowerSize: 5, coverage: 100, colors: [{ id: 1, name: 'White', hex: '#ffffff' }] };
const cnt = t => model.positions({ ...packBase, flowerType: t }).length;
const cDahlia = cnt('dahlia'), cRose = cnt('rose'), cGerbera = cnt('gerbera');
assert(cDahlia > cRose, 'dahlia should pack denser than rose');
assert(cRose > cGerbera, 'rose should pack denser than gerbera');
// pack factor must change the count vs the default
assert(cnt('marigold') !== cRose, 'marigold packing should differ from rose');
console.log(`PASS flower types + packing (dahlia ${cDahlia} > rose ${cRose} > gerbera ${cGerbera})`);

// ---- Pattern & distribution engine -----------------------------------------
// Pattern settings normalize with sensible defaults.
{
  const p = model.normalize({});
  assert.strictEqual(p.pattern, 'nongrouping', 'pattern should default to non-grouping');
  assert.strictEqual(p.mixIntensity, 'high', 'mixIntensity should default to high');
  assert.strictEqual(p.groupingLimit, 'balanced', 'groupingLimit should default to balanced');
  assert.strictEqual(p.clusterSize, 'small', 'clusterSize should default to small');
  assert.strictEqual(p.patternDirection, 'ltr', 'patternDirection should default to ltr');
  assert.strictEqual(p.seed, 1, 'seed should default to 1');
  assert.strictEqual(model.normalize({ pattern: 'nope' }).pattern, 'nongrouping', 'unknown pattern should fall back');
  console.log('PASS pattern normalize defaults');
}

// Shared setup: a 3-colour panel on an 8x8ft grid.
const patColors = [{ id: 1, name: 'Red', hex: '#ff0000' }, { id: 2, name: 'White', hex: '#ffffff' }, { id: 3, name: 'Green', hex: '#d8efcf' }];
const patBase = { width: 8, height: 8, flowerSize: 5, coverage: 100, colors: patColors };
const patPos = model.positions(patBase);
const quotas = model.counts(patBase, patPos.length).map(c => c.count);

// Same-colour adjacency rate over direct grid neighbours.
function sameAdjacency(colorIndex) {
  let same = 0, tot = 0;
  const cell = 0.3, grid = new Map();
  patPos.forEach((p, i) => { const k = Math.floor(p[0] / cell) + ',' + Math.floor(p[1] / cell); (grid.get(k) || grid.set(k, []).get(k)).push(i); });
  const r2 = (cell * 1.3) ** 2;
  for (let i = 0; i < patPos.length; i++) {
    const gx = Math.floor(patPos[i][0] / cell), gy = Math.floor(patPos[i][1] / cell);
    for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
      const arr = grid.get((gx + ox) + ',' + (gy + oy)); if (!arr) continue;
      for (const j of arr) { if (j <= i) continue; const dx = patPos[i][0] - patPos[j][0], dy = patPos[i][1] - patPos[j][1]; if (dx * dx + dy * dy <= r2) { tot++; if (colorIndex[i] === colorIndex[j]) same++; } }
    }
  }
  return tot ? same / tot : 0;
}

// Every pattern preserves colour proportions and is deterministic.
for (const pattern of model.PATTERNS) {
  const r = model.assignColors({ ...patBase, pattern }, patPos);
  const tally = Array(patColors.length).fill(0);
  r.colorIndex.forEach(c => { assert(c >= 0 && c < patColors.length, pattern + ': colour index out of range'); tally[c]++; });
  assert.deepStrictEqual(tally, quotas, pattern + ': proportions must be preserved');
  const r2 = model.assignColors({ ...patBase, pattern }, patPos);
  assert.deepStrictEqual(r.colorIndex, r2.colorIndex, pattern + ': must be deterministic for a fixed seed');
}
console.log(`PASS all patterns preserve proportions + deterministic (${patPos.length} flowers)`);

// Non-grouping intersperses far more than random; strict reports the impossible cases.
{
  const rnd = model.assignColors({ ...patBase, pattern: 'random' }, patPos).colorIndex;
  const ng = model.assignColors({ ...patBase, pattern: 'nongrouping' }, patPos); // balanced + high default
  const strict = model.assignColors({ ...patBase, pattern: 'nongrouping', groupingLimit: 'strict' }, patPos);
  const aRnd = sameAdjacency(rnd), aNg = sameAdjacency(ng.colorIndex);
  assert(aNg < aRnd, `non-grouping (${aNg.toFixed(3)}) should beat random (${aRnd.toFixed(3)})`);
  // Balanced allows the occasional same-colour neighbour, so it is not perfectly satisfied on a
  // dense thinned lattice — but it must report far fewer misses than strict, never claim success.
  assert(ng.unsatisfied < strict.unsatisfied, 'balanced should report fewer unsatisfied than strict');
  assert(ng.unsatisfied < patPos.length * 0.15, 'balanced should mostly satisfy the rule');
  assert.strictEqual(strict.satisfied, false, 'strict should report unsatisfiable cases');
  assert(strict.unsatisfied > 0, 'strict unsatisfied count should be > 0');
  // A new seed produces a different (but still proportional) layout.
  const other = model.assignColors({ ...patBase, pattern: 'random', seed: 999 }, patPos).colorIndex;
  assert.notDeepStrictEqual(other, rnd, 'a different seed should reshuffle the pattern');
  // Single colour trivially satisfies everything.
  const one = model.assignColors({ ...patBase, colors: [patColors[0]], pattern: 'nongrouping' }, patPos);
  assert(one.colorIndex.every(c => c === 0), 'single colour should assign all index 0');
  console.log(`PASS non-grouping adjacency ${aNg.toFixed(3)} < random ${aRnd.toFixed(3)}; strict unsat ${strict.unsatisfied}`);
}

// ---- optional border -------------------------------------------------------
// Border defaults: disabled, 6 in, gold. Old arrangements without border fields load safely.
{
  const d = model.normalize({});
  assert.strictEqual(d.borderEnabled, false, 'border should default to disabled');
  assert.strictEqual(d.borderWidth, 6, 'border width should default to 6 in');
  assert.strictEqual(d.borderColor, '#D4AF37', 'border colour should default to gold');
  console.log('PASS border normalize defaults');
}

// Border width clamped to panel size: for an 8 ft panel max is 8*6-0.5 = 47.5 in, slider caps at 24.
{
  const s = model.normalize({ width: 8, height: 8, borderWidth: 100 });
  assert.strictEqual(s.borderWidth, 24, 'border width should clamp to slider max of 24 in');
  // A tiny 1 ft panel: max = 1*6-0.5 = 5.5 in.
  const tiny = model.normalize({ width: 1, height: 1, borderWidth: 20 });
  assert(tiny.borderWidth <= 5.5, `tiny-panel border width should clamp to <=5.5 in, got ${tiny.borderWidth}`);
  console.log(`PASS border width clamping (8ft:${s.borderWidth}in, 1ft:${tiny.borderWidth}in)`);
}

// innerArea: disabled returns full panel; enabled subtracts 2×borderWidth.
{
  const off = model.innerArea({ width: 8, height: 8, borderEnabled: false });
  assert.strictEqual(off.width, 8, 'inner width should equal panel width when border disabled');
  assert.strictEqual(off.height, 8, 'inner height should equal panel height when border disabled');
  const on = model.innerArea({ width: 8, height: 8, borderEnabled: true, borderWidth: 6 });
  assert(Math.abs(on.width - 7) < 1e-9, `inner width should be 7 ft (8 - 2×0.5), got ${on.width}`);
  assert(Math.abs(on.height - 7) < 1e-9, `inner height should be 7 ft, got ${on.height}`);
  console.log('PASS innerArea calculation');
}

// Flower placement: no flower centres inside the border area when enabled.
{
  const base = { width: 8, height: 8, flowerSize: 5, coverage: 100,
    colors: [{ id: 1, name: 'White', hex: '#ffffff' }] };
  const offPos = model.positions({ ...base, borderEnabled: false });
  const onPos = model.positions({ ...base, borderEnabled: true, borderWidth: 6 });
  const scale = 0.72, bwFt = 6 / 12;
  const halfW = (8 / 2 - bwFt) * scale, halfH = (8 / 2 - bwFt) * scale; // inner half-dims in world units
  assert(onPos.every(([x, y]) => Math.abs(x) <= halfW + 1e-6 && Math.abs(y) <= halfH + 1e-6),
    'no flower centre should be placed inside the border area');
  assert(onPos.length < offPos.length, 'border should reduce the flower count');
  console.log(`PASS border placement: ${offPos.length} (no border) > ${onPos.length} (6 in border), all centres inside inner area`);
}

// Border colour independence: changing border colour does not change flower colours or counts.
{
  const base = { width: 8, height: 8, flowerSize: 5, coverage: 100, borderEnabled: true, borderWidth: 6,
    colors: [{ id: 1, name: 'White', hex: '#ffffff' }, { id: 2, name: 'Pink', hex: '#ffc0cb' }] };
  const a = model.positions({ ...base, borderColor: '#D4AF37' });
  const b = model.positions({ ...base, borderColor: '#ff0000' });
  assert.strictEqual(a.length, b.length, 'border colour must not change flower count');
  assert.deepStrictEqual(model.counts({ ...base, borderColor: '#D4AF37' }, a.length).map(c => c.hex),
    model.counts({ ...base, borderColor: '#ff0000' }, a.length).map(c => c.hex),
    'border colour must not change flower palette');
  console.log('PASS border colour independence');
}

// Old arrangements without border fields load with safe defaults (compatibility).
{
  const legacy = model.normalize({ width: 8, height: 8, flowerSize: 5, coverage: 100,
    colors: [{ id: 1, name: 'White', hex: '#ffffff' }], pattern: 'nongrouping', seed: 1 });
  assert.strictEqual(legacy.borderEnabled, false, 'legacy arrangement should have border disabled');
  assert.strictEqual(legacy.borderWidth, 6, 'legacy arrangement should get default border width');
  assert.strictEqual(legacy.borderColor, '#D4AF37', 'legacy arrangement should get default border colour');
  console.log('PASS legacy arrangement compatibility');
}

// ---- configurable border designer (dynamic layers) -----------------------
// Fresh default: no layers, disabled. Legacy flat fields migrate into a frame layer.
{
  const d = model.normalize({});
  assert.strictEqual(d.borderEnabled, false, 'border should default disabled');
  assert.deepStrictEqual(d.border.layers, [], 'fresh default has no border layers');
  assert.strictEqual(d.borderWidth, 6, 'borderWidth defaults to 6 (no frame)');
  assert.strictEqual(d.borderColor, '#D4AF37', 'borderColor defaults to gold');
  // Legacy flat -> frame layer migration
  const legacy = model.normalize({ borderEnabled: true, borderWidth: 8, borderColor: '#ff0000' });
  assert.strictEqual(legacy.border.layers.length, 1, 'legacy flat fields produce one frame layer');
  const fl = legacy.border.layers[0];
  assert.strictEqual(fl.type, 'frame', 'legacy flat -> frame layer');
  assert.strictEqual(fl.enabled, true, 'legacy borderEnabled -> layer.enabled');
  assert.strictEqual(fl.width, 8, 'legacy borderWidth -> layer.width');
  assert.strictEqual(fl.color, '#ff0000', 'legacy borderColor -> layer.color');
  assert.strictEqual(legacy.borderEnabled, true, 'borderEnabled still derived (any on)');
  assert.strictEqual(legacy.borderWidth, 8, 'borderWidth still mirrors first frame');
  console.log('PASS border designer defaults + legacy flat migration');
}

// Legacy fixed trio {fb1,frame,fb2,order} migrates to ordered layers; order + enabled kept.
{
  const s = model.normalize({ width: 8, height: 8,
    border: { fb1: { enabled: true, width: 6 }, fb2: { enabled: false, width: 4 }, frame: { enabled: true, width: 4 }, order: ['frame', 'fb1', 'fb2'] } });
  assert.strictEqual(s.border.layers.length, 3, 'legacy trio migrates to 3 layers');
  assert.deepStrictEqual(s.border.layers.map(l => l.type), ['frame', 'flower', 'flower'], 'layers follow saved order');
  assert.strictEqual(s.border.layers.filter(l => l.enabled).length, 2, 'disabled fb2 kept but off');
  assert(s.border.layers.every(l => l.id), 'every layer gets an id');
  console.log('PASS legacy trio -> ordered layers migration');
}

// Bands + inner-area math: 8ft panel, frame 4 + flower 6 + flower 4 = 14 in/side -> 68 in.
{
  const s = model.normalize({ width: 8, height: 8,
    border: { layers: [
      { id: 'a', type: 'frame', enabled: true, width: 4 },
      { id: 'b', type: 'flower', enabled: true, width: 6 },
      { id: 'c', type: 'flower', enabled: true, width: 4 } ] } });
  const bands = model.borderBands(s);
  assert.strictEqual(bands.enabled.length, 3, 'three layers enabled');
  assert.strictEqual(Math.round(bands.totalInsetFt * 12), 14, 'combined width 14 in per side');
  assert.deepStrictEqual(bands.bands.map(b => b.id), ['a', 'b', 'c'], 'bands follow array order');
  assert.strictEqual(bands.bands[0].outerInsetFt, 0, 'outermost band starts at panel edge');
  assert.strictEqual(bands.bands[2].innerInsetFt, bands.totalInsetFt, 'innermost band ends at inner area');
  const area = model.innerArea(s);
  assert.strictEqual(Math.round(area.width * 12), 68, 'inner width 68 in');
  assert.strictEqual(Math.round(area.height * 12), 68, 'inner height 68 in');
  console.log('PASS border bands + inner-area math (14 in/side -> 68 in)');
}

// Per-layer independence: borderPositions by layer id; colours never join the 5-colour limit.
{
  const s = model.normalize({ width: 8, height: 8, flowerSize: 5, coverage: 100,
    colors: [{ id: 1, name: 'A', hex: '#ffffff' }, { id: 2, name: 'B', hex: '#ff0000' }, { id: 3, name: 'C', hex: '#0000ff' }, { id: 4, name: 'D', hex: '#00ff00' }, { id: 5, name: 'E', hex: '#ffff00' }],
    border: { layers: [
      { id: 'outer', type: 'flower', enabled: true, width: 4, flowerSize: 3 },
      { id: 'inner', type: 'flower', enabled: false, width: 4 } ] } });
  const outerPos = model.borderPositions(s, 'outer');
  const mainPos = model.positions(s);
  assert(outerPos.length > 0, 'outer flower layer produces positions');
  assert.strictEqual(model.borderPositions(s, 'inner').length, 0, 'disabled layer produces no positions');
  // Outer flowers stay outside the inner area rect.
  const W = s.width * 0.72, H = s.height * 0.72;
  const insetFt = model.borderBands(s).totalInsetFt;
  const innerHW = W / 2 - insetFt * 0.72, innerHH = H / 2 - insetFt * 0.72;
  assert(outerPos.every(([x, y]) => !(Math.abs(x) <= innerHW && Math.abs(y) <= innerHH)), 'outer flowers stay outside inner area');
  // Main palette stays within 5 colours with borders on.
  assert(model.counts(s, mainPos.length).length <= 5, 'main colours stay <= 5 with borders on');
  console.log(`PASS border per-layer independence (main ${mainPos.length} + outer ${outerPos.length})`);
}

// Save/load round-trip preserves the layers array (order + props).
{
  const original = model.normalize({ width: 8, height: 8,
    border: { layers: [
      { id: 'x', type: 'flower', enabled: true, width: 5, flowerType: 'dahlia', arrangement: 'paired', color: '#ff0000' },
      { id: 'y', type: 'frame', enabled: true, width: 3, color: '#00ff00', depth: 1.5 } ] } });
  const reloaded = model.normalize(JSON.parse(JSON.stringify(original)));
  assert.deepStrictEqual(reloaded.border.layers.map(l => l.id), ['x', 'y'], 'layer order survives reload');
  assert.strictEqual(reloaded.border.layers[0].flowerType, 'dahlia', 'flower props survive reload');
  assert.strictEqual(reloaded.border.layers[1].depth, 1.5, 'frame depth survives reload');
  const a = model.borderBands(original), b = model.borderBands(reloaded);
  assert.strictEqual(Math.round(a.totalInsetFt * 12), Math.round(b.totalInsetFt * 12), 'inset unchanged by reload');
  console.log('PASS border layers save/load round-trip');
}

// Combined-width scaling: many wide layers are clamped so inner area survives.
{
  const s = model.normalize({ width: 8, height: 8,
    border: { layers: [
      { id: '1', type: 'flower', enabled: true, width: 12 },
      { id: '2', type: 'flower', enabled: true, width: 12 },
      { id: '3', type: 'frame', enabled: true, width: 12 } ] } });
  const bands = model.borderBands(s);
  const maxTotalIn = Math.min(s.width, s.height) * 6 - 3;
  assert(bands.totalInsetFt * 12 <= maxTotalIn + 1, `combined width clamped (${(bands.totalInsetFt * 12).toFixed(1)} in <= ${maxTotalIn} in)`);
  const area = model.innerArea(s);
  assert(area.width > 0 && area.height > 0, 'inner area survives over-wide border config');
  console.log('PASS border combined-width scaling');
}

// Layer cap: normalize never keeps more than BORDER_MAX_LAYERS.
{
  const many = [];
  for (let i = 0; i < 9; i++) many.push({ id: 'L' + i, type: 'flower', enabled: true, width: 1 });
  const s = model.normalize({ width: 8, height: 8, border: { layers: many } });
  assert.strictEqual(s.border.layers.length, model.BORDER_MAX_LAYERS, 'layers capped at BORDER_MAX_LAYERS');
  assert.strictEqual(model.BORDER_MAX_LAYERS, 6, 'cap is 6');
  console.log('PASS border layer cap enforced');
}

// Greenery border layer: normalizes with clamped fields; type is registered.
{
  assert(model.BORDER_LAYER_TYPES.includes('greenery'), 'BORDER_LAYER_TYPES includes greenery');
  const s = model.normalize({ width: 8, height: 6, border: { layers: [
    { id: 'g', type: 'greenery', enabled: true, species: 'eucalyptus', width: 5, sizeScale: 1.2, density: 60, overlap: 0.7, rotationVariation: 30, colorVariation: 0.4 } ] } });
  const g = s.border.layers[0];
  assert.strictEqual(g.type, 'greenery', 'greenery type kept');
  assert.strictEqual(g.species, 'eucalyptus', 'species kept');
  assert.strictEqual(g.width, 5, 'band width kept');
  assert.strictEqual(g.sizeScale, 1.2, 'sizeScale kept');
  assert.strictEqual(g.density, 60, 'density kept');
  assert.strictEqual(g.overlap, 0.7, 'overlap kept');
  const clamped = model.normalize({ width: 8, height: 6, border: { layers: [
    { type: 'greenery', species: 'bogus', width: 99, density: 500, overlap: 9, sizeScale: 9, rotationVariation: 999, colorVariation: 999 } ] } }).border.layers[0];
  assert.strictEqual(clamped.species, model.GREENERY_TYPES[0], 'invalid species falls back to first type');
  assert.strictEqual(clamped.width, 12, 'width clamps to 12');
  assert.strictEqual(clamped.sizeScale, 2.5, 'sizeScale clamps to 2.5');
  assert.strictEqual(clamped.density, 100, 'density clamps to 100');
  assert.strictEqual(clamped.overlap, 1, 'overlap clamps to 1');
  assert.strictEqual(clamped.rotationVariation, 180, 'rotationVariation clamps to 180');
  assert.strictEqual(clamped.colorVariation, 1, 'colorVariation clamps to 1');
  console.log('PASS greenery border layer normalize + clamping');
}

// Greenery border placement: origins clip to the ring, all sides get leaves, deterministic.
{
  const s = model.normalize({ width: 8, height: 6, border: { layers: [
    { id: 'g', type: 'greenery', enabled: true, species: 'monstera', width: 4, density: 100 } ] } });
  const pos = model.greeneryBorderPositions(s, 'g');
  assert(pos.length > 0, 'greenery band produces instances');
  const band = model.borderBands(s).bands.find(b => b.id === 'g');
  const W = s.width * 0.72, H = s.height * 0.72;
  const oHW = W / 2 - band.outerInsetFt * 0.72, oHH = H / 2 - band.outerInsetFt * 0.72;
  const iHW = W / 2 - band.innerInsetFt * 0.72, iHH = H / 2 - band.innerInsetFt * 0.72;
  const t = (band.innerInsetFt - band.outerInsetFt) * 0.72;
  assert(pos.every(p => Math.abs(p.x) <= oHW + 1e-6 && Math.abs(p.y) <= oHH + 1e-6), 'origins stay inside outer band');
  assert(pos.every(p => !(Math.abs(p.x) <= iHW + 1e-6 && Math.abs(p.y) <= iHH + 1e-6)), 'origins stay outside inner hole');
  const near = (v, e) => Math.abs(v - e) < t;
  const left = pos.filter(p => near(p.x, -oHW)).length, right = pos.filter(p => near(p.x, oHW)).length;
  const top = pos.filter(p => near(p.y, oHH)).length, bottom = pos.filter(p => near(p.y, -oHH)).length;
  assert(left && right && top && bottom, `every side gets leaves (L${left}/R${right}/T${top}/B${bottom})`);
  assert(pos.every(p => p.type === 'monstera' && p.layer === 'structural' && p.scale > 0 && p.z === 0.009), 'instance fields match greeneryEngine.build shape');
  assert.deepStrictEqual(model.greeneryBorderPositions(s, 'g'), pos, 'placement is deterministic');
  assert.strictEqual(model.greeneryBorderPositions(model.normalize({ width: 8, height: 6, border: { layers: [{ ...s.border.layers[0], enabled: false }] } }), 'g').length, 0, 'disabled greenery layer produces no instances');
  // Density scales the number of leaves.
  const sparse = model.greeneryBorderPositions(model.normalize({ width: 8, height: 6, border: { layers: [{ ...s.border.layers[0], density: 30 }] } }), 'g').length;
  const dense = model.greeneryBorderPositions(model.normalize({ width: 8, height: 6, border: { layers: [{ ...s.border.layers[0], density: 90 }] } }), 'g').length;
  assert(sparse < dense, `density scales count (${sparse} < ${dense})`);
  console.log(`PASS greenery border placement (ring-clipped, ${pos.length} instances)`);
}

// Mixed layer types coexist; greenery width joins the band stack; save/load round-trip.
{
  const s = model.normalize({ width: 10, height: 8, border: { layers: [
    { id: 'f', type: 'frame', enabled: true, width: 3 },
    { id: 'g', type: 'greenery', enabled: true, species: 'boston-fern', width: 5, density: 80 },
    { id: 'fl', type: 'flower', enabled: true, width: 4 } ] } });
  assert.deepStrictEqual(s.border.layers.map(l => l.type), ['frame', 'greenery', 'flower'], 'mixed types kept in order');
  assert.strictEqual(model.findBorderLayer(s, 'g').species, 'boston-fern', 'findBorderLayer reaches greenery layer');
  assert.strictEqual(Math.round(model.borderBands(s).totalInsetFt * 12), 12, 'combined width includes greenery (3+5+4=12 in)');
  assert(model.greeneryBorderPositions(s, 'g').length > 0, 'greenery layer placed inside mixed stack');
  const reloaded = model.normalize(JSON.parse(JSON.stringify(s)));
  assert.deepStrictEqual(reloaded.border.layers.map(l => l.type), ['frame', 'greenery', 'flower'], 'mixed types survive reload');
  assert.strictEqual(reloaded.border.layers[1].density, 80, 'greenery density survives reload');
  assert.strictEqual(reloaded.border.layers[1].species, 'boston-fern', 'greenery species survives reload');
  console.log('PASS mixed frame+greenery+flower stack + round-trip');
}

// ---- composition style (flowers + greenery mixed mode) ----------------------
// normalize derives designMode from the two master toggles; composition only exists in mixed.
{
  assert.strictEqual(model.normalize({ width: 8, height: 8, flowersOn: true, greeneryOn: true }).designMode, 'mixed', 'both toggles on -> mixed');
  assert.strictEqual(model.normalize({ width: 8, height: 8, flowersOn: true, greeneryOn: false }).designMode, 'flowers', 'flowers on, greenery off -> flowers');
  assert.strictEqual(model.normalize({ width: 8, height: 8, flowersOn: false, greeneryOn: true }).designMode, 'greenery', 'flowers off, greenery on -> greenery');
  assert.strictEqual(model.normalize({ width: 8, height: 8, flowersOn: false, greeneryOn: false }).designMode, 'flowers', 'both off falls back to flowers');
  assert.strictEqual(model.normalize({ width: 8, height: 8, designMode: 'mixed' }).flowersOn, true, 'mixed -> flowersOn');
  assert.strictEqual(model.normalize({ width: 8, height: 8, designMode: 'mixed' }).greeneryOn, true, 'mixed -> greeneryOn');
  // Legacy arrangement (designMode only, no toggles) still loads.
  assert.strictEqual(model.normalize({ width: 8, height: 8, designMode: 'greenery' }).designMode, 'greenery', 'legacy designMode still honoured');
  // composition null outside mixed; valid enum inside mixed; invalid falls back.
  assert.strictEqual(model.normalize({ width: 8, height: 8, designMode: 'flowers', composition: 'foliage-clusters' }).composition, null, 'composition ignored outside mixed');
  assert.strictEqual(model.normalize({ width: 8, height: 8, designMode: 'mixed', composition: 'foliage-clusters' }).composition, 'foliage-clusters', 'composition kept in mixed');
  assert.strictEqual(model.normalize({ width: 8, height: 8, designMode: 'mixed', composition: 'bogus' }).composition, 'greenery-base', 'invalid composition falls back');
  assert(model.COMPOSITIONS.includes('foliage-clusters') && model.COMPOSITIONS.includes('flower-dominant'), 'COMPOSITIONS exported');
  console.log('PASS design toggles + composition normalize');
}

// Flowers-only and greenery-only are unchanged by composition (no cluster bias applied).
{
  const base = { width: 12, height: 9, coverage: 100 };
  const fo = model.normalize({ ...base, designMode: 'flowers' });
  const go = model.normalize({ ...base, designMode: 'greenery', greenery: { mode: 'single', items: [{ type: 'monstera', density: 70 }] } });
  assert(fo.composition === null, 'flower-only has no composition');
  // Flower-only positions equal the plain lattice (a fresh normalize with same knobs).
  assert.strictEqual(model.positions(fo).length, model.positions(model.normalize({ ...base, flowersOn: true, greeneryOn: false })).length, 'flower-only count stable');
  assert(model.greeneryPositions(go).length > 0, 'greenery-only still places pieces');
  console.log('PASS flowers-only / greenery-only unchanged by composition');
}

// Foliage-clusters: deterministic, in-bounds, coordinated (flowers relocate, greenery clusters).
{
  const mk = composition => model.normalize({ width: 12, height: 9, designMode: 'mixed', composition, coverage: 100,
    greenery: { mode: 'mixed', items: [{ type: 'monstera', density: 70 }, { type: 'eucalyptus', density: 60, proportion: 50 }] } });
  const fc = mk('foliage-clusters');
  const uniform = mk('greenery-base');
  const fl = model.positions(fc), gre = model.greeneryPositions(fc);
  assert(fl.length > 0 && gre.length > 0, 'foliage-clusters places both flowers and greenery');
  // Deterministic.
  assert.deepStrictEqual(model.positions(fc), fl, 'flower placement deterministic');
  assert.deepStrictEqual(model.greeneryPositions(fc), gre, 'greenery placement deterministic');
  // Full-footprint containment: every flower/greenery origin inside the inner area.
  const area = model.innerArea(fc), W = area.width * 0.72, H = area.height * 0.72;
  assert(fl.every(([x, y]) => Math.abs(x) <= W / 2 + 0.5 && Math.abs(y) <= H / 2 + 0.5), 'flowers inside inner area');
  assert(gre.every(p => Math.abs(p.x) <= W / 2 + 0.5 && Math.abs(p.y) <= H / 2 + 0.5), 'greenery inside inner area');
  // Flowers are relocated (not the uniform wall): the sets differ, and count tracks coverage
  // × the composition thin factor (still deterministic + proportional).
  const uniFl = model.positions(uniform);
  assert(fl.length < uniFl.length, `foliage-clusters thins flowers vs uniform (${fl.length} < ${uniFl.length})`);
  assert.notDeepStrictEqual(fl.map(p => p.join(',')), uniFl.map(p => p.join(',')), 'flower positions differ from uniform wall');
  // Greenery concentrates into clusters: more pieces survive than the uniform lattice
  // (large leaves fit better away from edges) — and definitely not fewer.
  assert(gre.length >= model.greeneryPositions(uniform).length, 'clustering keeps >= uniform greenery count');
  // Flower-dominant thins greenery below the uniform base but keeps a full flower wall.
  const fd = mk('flower-dominant');
  const fdGre = model.greeneryPositions(fd), fdFl = model.positions(fd);
  assert.strictEqual(fdFl.length, uniFl.length, 'flower-dominant keeps full flower count');
  assert(fdGre.length < model.greeneryPositions(uniform).length, 'flower-dominant thins greenery');
  console.log(`PASS foliage-clusters composition (flowers ${fl.length}/${uniFl.length}, greenery ${gre.length}, dominant-greenery ${fdGre.length})`);
}

// Composition save/load round-trip + JSON.
{
  const s = model.normalize({ width: 10, height: 8, designMode: 'mixed', composition: 'foliage-clusters', coverage: 90,
    greenery: { mode: 'mixed', items: [{ type: 'boston-fern', density: 65 }, { type: 'monstera', density: 55, proportion: 40 }] } });
  const reloaded = model.normalize(JSON.parse(JSON.stringify(s)));
  assert.strictEqual(reloaded.composition, 'foliage-clusters', 'composition survives JSON round-trip');
  assert.strictEqual(reloaded.designMode, 'mixed', 'designMode survives round-trip');
  assert.strictEqual(reloaded.flowersOn && reloaded.greeneryOn, true, 'toggles survive round-trip');
  assert.deepStrictEqual(model.positions(reloaded), model.positions(s), 'flower placement reproduces after reload');
  assert.deepStrictEqual(model.greeneryPositions(reloaded), model.greeneryPositions(s), 'greenery placement reproduces after reload');
  console.log('PASS composition save/load + deterministic round-trip');
}

// Greenery border is independent of the Flowers/Greenery toggles (renders on layer.enabled).
{
  const s = model.normalize({ width: 8, height: 6, designMode: 'flowers', border: { layers: [{ id: 'gb', type: 'greenery', enabled: true, species: 'monstera', width: 4 }] } });
  assert(model.greeneryBorderPositions(s, 'gb').length > 0, 'greenery border places even in a flowers-only design');
  const off = model.normalize({ width: 8, height: 6, designMode: 'flowers', border: { layers: [{ id: 'gb', type: 'greenery', enabled: false, species: 'monstera', width: 4 }] } });
  assert.strictEqual(model.greeneryBorderPositions(off, 'gb').length, 0, 'disabled greenery border places nothing');
  console.log('PASS greenery border independent of design toggles');
}

// shadeHex: deterministic +/- lightness, stays in hex range.
{
  const up = model.shadeHex('#ffc0cb', 50);
  const dn = model.shadeHex('#ffc0cb', -50);
  assert(/^#[0-9a-f]{6}$/i.test(up), 'shade + produces hex');
  assert(/^#[0-9a-f]{6}$/i.test(dn), 'shade - produces hex');
  assert(up !== '#ffc0cb' && dn !== '#ffc0cb' && up !== dn, 'shade + and - differ');
  console.log('PASS shadeHex deterministic lightness shifts');
}

console.log('ALL model tests passed');
