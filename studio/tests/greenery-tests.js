const assert = require('assert');
const model = require('../model.js');

// ---- normalize defaults + design mode ---------------------------------------
{
  const d = model.normalize({});
  assert.strictEqual(d.designMode, 'flowers', 'designMode should default to flowers (preserve existing look)');
  assert.strictEqual(d.greenery.mode, 'single', 'greenery mode should default to single');
  assert.strictEqual(d.greenery.items.length, 1, 'single mode keeps exactly one item');
  assert.strictEqual(d.greenery.items[0].type, 'monstera', 'default greenery type is monstera');
  assert.strictEqual(d.greenery.items[0].enabled, true, 'default item enabled');
  assert.strictEqual(d.greenery.direction, 'mixed', 'default direction mixed');
  assert.strictEqual(d.greenery.items[0].layer, 'structural', 'monstera default layer structural');
  // designMode valid values accepted, invalid falls back.
  assert.strictEqual(model.normalize({ designMode: 'greenery' }).designMode, 'greenery');
  assert.strictEqual(model.normalize({ designMode: 'mixed' }).designMode, 'mixed');
  assert.strictEqual(model.normalize({ designMode: 'bogus' }).designMode, 'flowers', 'unknown designMode falls back to flowers');
  // Unknown greenery type falls back to the first known type.
  assert.strictEqual(model.normalize({ greenery: { mode: 'single', items: [{ type: 'tulip' }] } }).greenery.items[0].type, 'monstera');
  console.log('PASS greenery normalize defaults + designMode');
}

// ---- legacy arrangements unchanged ------------------------------------------
// A legacy record (no designMode/greenery) must load as flowers-only so the current
// flower look is untouched.
{
  const legacy = model.normalize({ width: 8, height: 8, flowerSize: 5, coverage: 100,
    colors: [{ id: 1, name: 'White', hex: '#ffffff' }], pattern: 'nongrouping', seed: 1 });
  assert.strictEqual(legacy.designMode, 'flowers', 'legacy designMode is flowers');
  assert.strictEqual(legacy.greenery.mode, 'single', 'legacy greenery mode single');
  assert(legacy.greenery.items.length >= 1, 'legacy still has a default greenery item');
  console.log('PASS legacy arrangement greenery migration');
}

// ---- single-item placement ---------------------------------------------------
{
  const s = model.normalize({ width: 8, height: 8, greenery: { mode: 'single', items: [{ type: 'monstera', density: 70 }], overlap: 0.5 } });
  const inst = model.greeneryPositions(s);
  assert(inst.length > 0, 'single placement produces instances');
  const area = model.innerArea(s);
  const W = area.width * 0.72, H = area.height * 0.72;
  assert(inst.every(p => Math.abs(p.x) <= W / 2 + 1e-6 && Math.abs(p.y) <= H / 2 + 1e-6),
    'every greenery instance stays inside the inner area');
  // Deterministic for a fixed seed.
  assert.deepStrictEqual(model.greeneryPositions(s), inst, 'placement must be deterministic');
  // Density changes the count (higher density -> more pieces).
  const lo = model.greeneryPositions(model.normalize({ greenery: { mode: 'single', items: [{ type: 'monstera', density: 20 }] } })).length;
  const hi = model.greeneryPositions(model.normalize({ greenery: { mode: 'single', items: [{ type: 'monstera', density: 90 }] } })).length;
  assert(hi > lo, `higher density should place more pieces (90%:${hi} > 20%:${lo})`);
  // Instances carry a positive scale from the model's real length.
  assert(inst.every(p => p.scale > 0), 'instance scale must be positive');
  console.log(`PASS single-item placement (${inst.length} monstera, in-bounds, deterministic)`);
}

// ---- mixed placement: proportions + layered order ----------------------------
{
  const s = model.normalize({ greenery: { mode: 'mixed', items: [
    { type: 'monstera', proportion: 25, layer: 'structural' },
    { type: 'boston-fern', proportion: 30, layer: 'volume' },
    { type: 'eucalyptus', proportion: 45, layer: 'filler' }
  ] } });
  // Proportions renormalized to sum 100.
  const propSum = s.greenery.items.reduce((a, b) => a + b.proportion, 0);
  assert.strictEqual(propSum, 100, `mixed proportions should sum to 100, got ${propSum}`);
  const inst = model.greeneryPositions(s);
  assert(inst.length > 0, 'mixed placement produces instances');
  // Every type appears.
  const types = new Set(inst.map(p => p.type));
  assert(types.has('monstera') && types.has('boston-fern') && types.has('eucalyptus'),
    'all three mixed types placed');
  // Layered order: structural instances all precede volume, which precede filler.
  const idxOf = layer => { const i = inst.findIndex(p => p.layer === layer); return i; };
  const sIdx = inst.findIndex(p => p.layer === 'structural');
  const vIdx = inst.findIndex(p => p.layer === 'volume');
  const fIdx = inst.findIndex(p => p.layer === 'filler');
  assert(sIdx >= 0 && vIdx >= 0 && fIdx >= 0 && sIdx < vIdx && vIdx < fIdx,
    `layered placement should order structural(${sIdx}) < volume(${vIdx}) < filler(${fIdx})`);
  // Estimate reports a per-item count and coverage.
  const est = model.greeneryEstimate(s);
  assert.strictEqual(est.items.length, 3, 'estimate reports each mixed item');
  assert.strictEqual(est.totalItems, inst.length, 'estimate total matches placement count');
  const countSum = est.items.reduce((a, b) => a + b.count, 0);
  assert.strictEqual(countSum, est.totalItems, 'per-item counts sum to the total');
  console.log(`PASS mixed placement + layered order (total ${est.totalItems}, coverage ${(est.estimatedCoverage * 100).toFixed(0)}%)`);
}

// ---- honest coverage estimate: saturating + overlap-driven, not a density copy ----
// Density is a placement knob; coverage is a footprint union. They can be numerically
// close at low density (a thin scatter genuinely covers ~that fraction) but MUST diverge
// once pieces start overlapping — that is what makes the number honest.
{
  const covOf = (over) => model.greeneryEstimate(model.normalize(
    { greenery: { mode: 'single', overlap: over, items: [{ type: 'monstera', density: 100 }] } })).estimatedCoverage;
  const c50 = model.greeneryEstimate(model.normalize(
    { greenery: { mode: 'single', items: [{ type: 'monstera', density: 50 }] } })).estimatedCoverage;
  const c100 = covOf(0.5);
  assert(c50 > 0 && c100 <= 1, `coverage in (0,1], got ${c100}`);
  assert(c100 > c50, 'more density covers more');
  // 100% density (a fully packed grid) must NOT claim the whole panel is covered:
  // overlapping leaves leave gaps, so coverage saturates well below 1.
  assert(c100 < 0.93,
    `full density must saturate below full coverage (got ${(c100 * 100).toFixed(0)}%) — density is not surface coverage`);
  assert(1 - c100 > 0.05, 'full density still leaves visible gaps (>5% uncovered)');
  // Overlap is a real input: more overlap packs pieces tighter -> more coverage at the
  // SAME density. This proves coverage is geometry/overlap-driven, not the slider echoed.
  const covLow = model.greeneryEstimate(model.normalize(
    { greenery: { mode: 'single', overlap: 0, items: [{ type: 'monstera', density: 80 }] } })).estimatedCoverage;
  const covHigh = model.greeneryEstimate(model.normalize(
    { greenery: { mode: 'single', overlap: 1, items: [{ type: 'monstera', density: 80 }] } })).estimatedCoverage;
  assert(covHigh > covLow + 0.02,
    `overlap must raise coverage at fixed density (0->${(covLow * 100).toFixed(0)}%, 1->${(covHigh * 100).toFixed(0)}%)`);
  console.log(`PASS honest coverage (d50 ${(c50 * 100).toFixed(0)}% -> d100 ${(c100 * 100).toFixed(0)}% saturates; overlap lifts 80% ${(covLow * 100).toFixed(0)}%->${(covHigh * 100).toFixed(0)}%)`);
}

// ---- greenery metadata for every type ---------------------------------------
{
  for (const t of model.GREENERY_TYPES) {
    const meta = model.GREENERY_META[t];
    assert(meta, `${t} metadata present`);
    assert(meta.label, `${t} has a label`);
    assert(meta.lengthIn > 0 && meta.widthIn > 0, `${t} has real dimensions`);
    assert(meta.footprintSqIn > 0, `${t} has a coverage footprint`);
    assert(/^#[0-9a-f]{6}$/i.test(meta.color), `${t} has a base colour`);
    assert(model.GREENERY_CATEGORIES.includes(meta.category), `${t} category is known`);
    assert(model.GREENERY_LAYERS.includes(meta.defaultLayer), `${t} default layer is known`);
    assert.strictEqual(meta.coverageMethod, 'projected-footprint', `${t} uses projected footprint`);
  }
  assert.strictEqual(model.GREENERY_TYPES.length, 3, 'Stage-1 trio present');
  console.log(`PASS greenery metadata (${model.GREENERY_TYPES.join(', ')})`);
}

// ---- physical dimensions + placement bounds ---------------------------------
{
  // geometry long axis is normalised to 1, so instance.scale == lengthIn/12*worldScale.
  // A piece must land at its stated real long-axis size (within the ±10% size variation).
  const s = model.normalize({ width: 6, height: 8, greenery: { mode: 'single', sizeScale: 1, items: [{ type: 'monstera' }] } });
  const inst = model.greeneryPositions(s);
  const meta = model.GREENERY_META.monstera;
  const expect = meta.lengthIn / 12 * 0.72;
  assert(inst.every(p => p.scale >= expect * 0.89 && p.scale <= expect * 1.11),
    `monstera instance scale should map to ${meta.lengthIn}in (got ${inst[0].scale.toFixed(3)}, expect ~${expect.toFixed(3)})`);
  // sizeScale multiplies the real size.
  const big = model.greeneryPositions(model.normalize(
    { greenery: { mode: 'single', items: [{ type: 'monstera', sizeScale: 2 }] } }))[0].scale;
  const small = model.greeneryPositions(model.normalize(
    { greenery: { mode: 'single', items: [{ type: 'monstera', sizeScale: 0.5 }] } }))[0].scale;
  assert(big > small * 3, `sizeScale must scale size (2x=${big.toFixed(2)} vs 0.5x=${small.toFixed(2)})`);
  // Placement stays inside the panel for every model.
  for (const t of model.GREENERY_TYPES) {
    const sp = model.normalize({ width: 5, height: 8, greenery: { mode: 'single', items: [{ type: t, density: 100 }] } });
    const pos = model.greeneryPositions(sp);
    const area = model.innerArea(sp), W = area.width * 0.72, H = area.height * 0.72;
    assert(pos.length > 0 && pos.every(p => Math.abs(p.x) <= W / 2 + 1e-6 && Math.abs(p.y) <= H / 2 + 1e-6),
      `${t} stays inside the panel`);
  }
  console.log('PASS physical dimensions + placement bounds');
}

// ---- every model has a distinct, real footprint ------------------------------
{
  const foots = model.GREENERY_TYPES.map(t => model.GREENERY_META[t].footprintSqIn);
  assert(new Set(foots).size === foots.length, 'footprints must be per-model, not generic: ' + foots.join(','));
  model.GREENERY_TYPES.forEach(t => {
    const m = model.GREENERY_META[t];
    // footprint must be consistent with the stated real size (a leaf can't cover more
    // than its own bounding rectangle).
    const rect = m.lengthIn * m.widthIn;
    assert(m.footprintSqIn > 0 && m.footprintSqIn <= rect,
      `${t} footprint ${m.footprintSqIn}in² should fit inside its ${m.lengthIn}x${m.widthIn}in rectangle`);
  });
  // The fern's wispy bush covers far less than the solid monstera blade (shape matters).
  assert(model.GREENERY_META['boston-fern'].footprintSqIn < model.GREENERY_META.monstera.footprintSqIn,
    'bush footprint should differ from blade footprint');
  console.log(`PASS distinct per-model footprints (${foots.join(', ')} in²)`);
}

// ---- flower/greenery layer positioning (mixed) -------------------------------
{
  const mixed = model.normalize({ designMode: 'mixed', flowerSize: 5, greenery: { mode: 'mixed', items: [
    { type: 'monstera', layer: 'structural' },
    { type: 'eucalyptus', layer: 'volume' },
    { type: 'boston-fern', layer: 'filler' },
    { type: 'monstera', layer: 'trailing' }
  ] } });
  const zOf = layer => model.greeneryPositions(mixed).find(p => p.layer === layer).z;
  const zs = { structural: zOf('structural'), volume: zOf('volume'), filler: zOf('filler'), trailing: zOf('trailing') };
  assert(zs.structural > 0, 'structural sits above the foam front face (not buried in foam)');
  assert(zs.structural < zs.volume && zs.volume < zs.filler && zs.filler < zs.trailing,
    `layer z must progress behind->front (structural ${zs.structural.toFixed(3)} < volume ${zs.volume.toFixed(3)} < filler ${zs.filler.toFixed(3)} < trailing ${zs.trailing.toFixed(3)})`);
  const flowerTop = 0.14 * (5 / 12) * 0.72;
  assert(zs.trailing > flowerTop, `trailing must sit in FRONT of the tallest flower (z ${zs.trailing.toFixed(3)} > ${flowerTop.toFixed(3)})`);
  assert(zs.structural < flowerTop, 'structural sits behind/below the flower heads');
  // greenery-only: no flowers, so just a small positive stagger above the foam.
  const solo = model.greeneryPositions(model.normalize({ designMode: 'greenery', greenery: { mode: 'mixed', items: [
    { type: 'monstera', layer: 'structural' }, { type: 'eucalyptus', layer: 'trailing' }] } }));
  assert(solo.every(p => p.z > 0 && p.z < 0.06), 'greenery-only z stays just above the foam');
  console.log(`PASS flower/greenery layer z (struct ${zs.structural.toFixed(3)} / vol ${zs.volume.toFixed(3)} / fill ${zs.filler.toFixed(3)} / trail ${zs.trailing.toFixed(3)}, flowerTop ${flowerTop.toFixed(3)})`);
}

// ---- save/load preserves the full greenery + design config -------------------
{
  const cfg = { designMode: 'mixed', greenery: { mode: 'mixed', direction: 'outward', overlap: 0.8, rotationVariation: 120, seed: 42, items: [
    { type: 'monstera', enabled: true, sizeScale: 1.4, density: 80, proportion: 40, layer: 'structural', colorVariation: 0.6 },
    { type: 'eucalyptus', enabled: false, sizeScale: 0.7, density: 30, proportion: 60, layer: 'trailing', colorVariation: 0.1 }
  ] } };
  const round = model.normalize(cfg);
  assert.strictEqual(round.designMode, 'mixed', 'designMode round-trips');
  assert.strictEqual(round.greenery.mode, 'mixed');
  assert.strictEqual(round.greenery.direction, 'outward');
  assert.strictEqual(round.greenery.overlap, 0.8);
  assert.strictEqual(round.greenery.rotationVariation, 120);
  assert.strictEqual(round.greenery.seed, 42);
  assert.strictEqual(round.greenery.items.length, 2, 'both items survive normalize (save/load)');
  assert.deepStrictEqual(round.greenery.items.map(i => i.type), ['monstera', 'eucalyptus']);
  assert.deepStrictEqual(round.greenery.items.map(i => i.layer), ['structural', 'trailing']);
  assert.strictEqual(round.greenery.items[1].enabled, false, 'disabled flag survives');
  assert.strictEqual(round.greenery.items[0].sizeScale, 1.4);
  // JSON round-trip (localStorage / export path) is lossless too.
  const json = JSON.parse(JSON.stringify(round));
  assert.deepStrictEqual(model.normalize(json).greenery.items, round.greenery.items, 'JSON round-trip lossless');
  console.log('PASS save/load preserves greenery + design config');
}

// ---- full projected-footprint containment (not just instance origin) ---------
// The original overflow bug: placement clipped only the instance ORIGIN, so a leaf whose
// body extends ~1 unit past its origin overhung the panel edge / border. Now the FULL
// rotated+scaled bounding box (meta.bounds) must stay inside the usable inner area.
{
  const SCALE = 0.72;
  // World-space bbox of a placed footprint (rotated + scaled meta.bounds at (x,y)).
  const corners = (meta, x, y, rot, s) => {
    const b = meta.bounds, cs = Math.cos(rot), sn = Math.sin(rot);
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (const [lx, ly] of [[b[0], b[1]], [b[0], b[3]], [b[2], b[1]], [b[2], b[3]]]) {
      const wx = x + (lx * cs - ly * sn) * s, wy = y + (lx * sn + ly * cs) * s;
      minX = Math.min(minX, wx); maxX = Math.max(maxX, wx);
      minY = Math.min(minY, wy); maxY = Math.max(maxY, wy);
    }
    return { minX, maxX, minY, maxY };
  };
  // (a) footprintFit itself, swept across rotations: a footprint at the centre must fit,
  //     and the inward-shift hint must be enough to make an off-edge one fit.
  for (const t of model.GREENERY_TYPES) {
    const meta = model.GREENERY_META[t];
    const s = model.normalize({ width: 5, height: 8, greenery: { mode: 'single', items: [{ type: t }] } });
    const area = model.innerArea(s), W = area.width * SCALE, H = area.height * SCALE;
    for (let k = 0; k < 12; k++) {
      const rot = k / 12 * Math.PI * 2;
      const fit = model.footprintFit(meta, 0, 0, rot, meta.lengthIn / 12 * SCALE, W / 2, H / 2);
      assert(fit.fits, `${t} centre footprint fits at rot=${(rot * 180 / Math.PI).toFixed(0)}°`);
    }
    // An origin pushed to the edge overflows; the returned shift brings it back inside.
    const sc = meta.lengthIn / 12 * SCALE;
    const edge = model.footprintFit(meta, W / 2, 0, 0, sc, W / 2, H / 2);
    assert(!edge.fits, `${t} origin at edge overflows (footprint extends past it)`);
    assert(edge.dx < 0, `${t} inward x-shift is negative (points inward)`);
    const moved = model.footprintFit(meta, W / 2 + edge.dx, 0, 0, sc, W / 2, H / 2);
    assert(moved.fits, `${t} applying the shift makes the footprint fit`);
  }
  // (b) At HIGH density every placed instance's full footprint must be inside the panel.
  for (const t of model.GREENERY_TYPES) {
    const s = model.normalize({ width: 5, height: 8, greenery: {
      mode: 'single', direction: 'mixed', overlap: 1.0, rotationVariation: 180,
      items: [{ type: t, density: 100, sizeScale: 1 }] } });
    const pos = model.greeneryPositions(s);
    const area = model.innerArea(s), W = area.width * SCALE, H = area.height * SCALE;
    assert(pos.length > 0, `${t} high density still places pieces`);
    for (const p of pos) {
      const meta = model.GREENERY_META[p.type];
      const bb = corners(meta, p.x, p.y, p.rot, p.scale);
      assert(bb.minX >= -W / 2 - 1e-6 && bb.maxX <= W / 2 + 1e-6 &&
             bb.minY >= -H / 2 - 1e-6 && bb.maxY <= H / 2 + 1e-6,
        `${t} footprint in bounds at (${p.x.toFixed(2)},${p.y.toFixed(2)})`);
    }
    console.log(`  ${t}: ${pos.length} placed @d100, all footprints in bounds`);
  }
  console.log('PASS full projected-footprint containment (all rotations + high density)');
}

// ---- border exclusion: greenery stays out of the border band ------------------
{
  const SCALE = 0.72;
  const border = { frame: { enabled: true, width: 2, color: '#d4af37' },
    fb1: { enabled: true, width: 3, color: '#c1121f' }, fb2: { enabled: false },
    order: ['frame', 'fb1'] };
  const s = model.normalize({ width: 5, height: 8, border, greenery: {
    mode: 'single', direction: 'mixed', overlap: 1.0,
    items: [{ type: 'monstera', density: 100 }] } });
  const area = model.innerArea(s), W = area.width * SCALE, H = area.height * SCALE;
  const insetFt = (s.width - area.width) / 2;                    // border band width (ft/side)
  assert(insetFt > 0, 'border shrinks the usable inner area');
  const pos = model.greeneryPositions(s);
  for (const p of pos) {
    const b = model.GREENERY_META[p.type].bounds, cs = Math.cos(p.rot), sn = Math.sin(p.rot);
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (const [lx, ly] of [[b[0], b[1]], [b[0], b[3]], [b[2], b[1]], [b[2], b[3]]]) {
      const wx = p.x + (lx * cs - ly * sn) * p.scale, wy = p.y + (lx * sn + ly * cs) * p.scale;
      minX = Math.min(minX, wx); maxX = Math.max(maxX, wx);
      minY = Math.min(minY, wy); maxY = Math.max(maxY, wy);
    }
    // Inside the inner area == strictly outside the border band (which is outside inner).
    assert(minX >= -W / 2 - 1e-6 && maxX <= W / 2 + 1e-6 &&
           minY >= -H / 2 - 1e-6 && maxY <= H / 2 + 1e-6,
      `monstera clears the ${insetFt.toFixed(2)}ft border band`);
  }
  console.log(`PASS border exclusion (${pos.length} pieces, ${insetFt.toFixed(2)}ft band kept clear)`);
}

// ---- independent knobs: density (count), overlap (spacing/coverage), rotation ---
{
  const count = (o) => model.greeneryPositions(model.normalize(
    { greenery: { mode: 'single', items: [{ type: 'monstera', density: o.density }], overlap: o.overlap || 0.5,
      rotationVariation: o.rotvar != null ? o.rotvar : 60 } })).length;
  // Density is the count knob and it is TRANSPARENT (not a hidden multiplier):
  // count scales monotonically with the density fraction.
  const c25 = count({ density: 25 }), c50 = count({ density: 50 }), c100 = count({ density: 100 });
  assert(c25 < c50 && c50 < c100, `density monotonically raises count (25:${c25} < 50:${c50} < 100:${c100})`);
  assert(c100 >= c50 * 1.7 && c50 >= c25 * 1.7,
    'count tracks the density fraction (~linear), not a silent 2x multiplier');
  // Rotation is an independent knob: changing rotationVariation must not change the count
  // (it only re-orients pieces; omission at edges is negligible here).
  const r0 = count({ density: 80, rotvar: 0 }), r180 = count({ density: 80, rotvar: 180 });
  assert(Math.abs(r0 - r180) <= Math.max(2, 0.15 * r0),
    `rotation variation is independent of count (0°:${r0} vs 180°:${r180})`);
  // Overlap's meaning (documented in greeneryStep): it tightens SPACING. At fixed density
  // a tighter overlap packs the same fraction of a denser lattice, so coverage rises.
  // The count can rise too (more cells fit) — that is spacing, not a hidden multiplier.
  const cov = (o) => model.greeneryEstimate(model.normalize(
    { greenery: { mode: 'single', items: [{ type: 'monstera', density: 60 }], overlap: o } })).estimatedCoverage;
  assert(cov(1.0) > cov(0.0) + 0.02, 'overlap tightens spacing -> higher coverage at fixed density');
  // Omitted pieces are reported honestly, never silently dropped.
  const est = model.greeneryEstimate(model.normalize(
    { width: 5, height: 8, greenery: { mode: 'single', items: [{ type: 'monstera', density: 100 }], overlap: 1.0 } }));
  assert(typeof est.omitted === 'number' && est.omitted >= 0, 'estimate reports omitted count');
  assert(est.totalItems > 0 && est.totalItems + est.omitted >= est.totalItems, 'placed + omitted reported together');
  console.log(`PASS independent knobs (density ${c25}/${c50}/${c100}, rotation r0=${r0}/r180=${r180}, omitted=${est.omitted})`);
}

console.log('ALL greenery model tests passed');
