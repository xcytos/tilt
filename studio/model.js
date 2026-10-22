/* Pure arrangement calculations. Browser + Node compatible.
 * GENERATED from js/flowermodel.js by tools/build-flowermodel.mjs - do not edit this copy.
 * Edit js/flowermodel.js and re-run: node tools/build-flowermodel.mjs */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof window !== 'undefined') window.FlowerModel = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  // '' / null / undefined / non-numeric -> default; a real number (including 0) is kept and clamped.
  const num = (value, fallback) => (value === '' || value == null || Number.isNaN(Number(value)) ? fallback : Number(value));
  const cleanHex = value => /^#[0-9a-f]{6}$/i.test(value || '') ? value : '#ffffff';
  // Known species + their packing factor (multiplies the grid step; <1 packs tighter).
  // Kept here (pure, no THREE) so positions and the estimated count always agree.
  const FLOWER_TYPES = ['rose', 'marigold', 'chrysanthemum', 'dahlia', 'gerbera'];
  const SPECIES_PACK = { rose: 1.0, marigold: 0.9, chrysanthemum: 0.94, dahlia: 0.88, gerbera: 1.04 };
  const cleanType = value => (typeof value === 'string' && FLOWER_TYPES.indexOf(value) >= 0 ? value : 'rose');
  // Pattern system -----------------------------------------------------------
  const PATTERNS = ['random', 'nongrouping', 'clustered', 'gradient', 'stripes'];
  const MIX_INTENSITIES = ['low', 'medium', 'high'];
  const GROUPING_LIMITS = ['strict', 'balanced', 'loose'];
  const CLUSTER_SIZES = ['small', 'medium', 'large'];
  const PATTERN_DIRS = ['ltr', 'rtl', 'ttb', 'btt', 'diag'];
  // Border designer -----------------------------------------------------------
  // Border is a dynamic, ordered list of layers (outside -> inside). Each layer is a
  // 'frame' (solid ring) or 'flower' (band of blossoms). Any count up to BORDER_MAX_LAYERS.
  const BORDER_LAYER_TYPES = ['frame', 'flower', 'greenery'];
  const BORDER_MAX_LAYERS = 6;
  const LEGACY_BORDER_COMPONENTS = ['fb1', 'frame', 'fb2']; // old fixed trio, migration only
  const BORDER_ARRANGEMENTS = ['continuous', 'spaced', 'alternating', 'paired', 'mixed'];
  const BORDER_COLOR_MODES = ['independent', 'palette'];
  // Greenery designer ---------------------------------------------------------
  // Greenery is a separate category of 3D element (not a flower species). These lists
  // are pure data so the placement engine stays node-testable without THREE.
  const DESIGN_MODES = ['flowers', 'greenery', 'mixed']; // what composites in the scene
  const COMPOSITIONS = ['greenery-base', 'foliage-clusters', 'flower-dominant']; // mixed-mode flower/greenery balance
  // Projection band: how far the design stands off the foam face, matching the
  // reference sheet's Minimal 5-10 / Medium 10-20 / Full 20-30 cm bands.
  const PROJECTIONS = ['minimal', 'medium', 'full'];
  const PROJECTION_LIFT_IN = { minimal: 0, medium: 2.4, full: 7.5 }; // head lift off the face, inches
  const GREENERY_MODES = ['single', 'mixed'];            // one greenery item vs several
  const GREENERY_CATEGORIES = ['individual-leaf', 'spray', 'bush', 'garland', 'filler', 'branch'];
  const GREENERY_LAYERS = ['structural', 'volume', 'filler', 'trailing'];
  const GREENERY_DIRECTIONS = ['upright', 'diag', 'outward', 'mixed'];
  // Per-type inventory metadata. lengthIn/widthIn are the real long-axis inches at
  // sizeScale=1 (geometry is normalised so its long axis = 1, see greenery-core).
  // footprintSqIn is the MEASURED projected (XY) area of the geometry at sizeScale=1 —
  // calibrated from the actual model, not a generic circle. coverageMethod
  // 'projected-footprint' means estimated coverage is derived from this footprint, never
  // from density alone.
  // `bounds` = the model's projected bounding box in long-axis units, relative to the
  // attachment origin (stem base at 0,0). Measured from the actual geometry. Placement
  // uses it to keep the FULL rotated+scaled footprint inside the usable panel (not just
  // the instance origin), so leaves cannot overhang the border/frame.
  const GREENERY_META = {
    monstera:    { id: 'monstera',    category: 'individual-leaf', label: 'Monstera leaf',    lengthIn: 18, widthIn: 10, footprintSqIn: 101, bounds: [-0.269, 0, 0.269, 1], color: '#2f6b28', defaultLayer: 'structural', attachmentPoint: 'stem-base', placementMode: 'surface', allowScale: true, allowRotation: true, coverageMethod: 'projected-footprint' },
    eucalyptus:  { id: 'eucalyptus',  category: 'spray',           label: 'Eucalyptus spray', lengthIn: 16, widthIn: 10, footprintSqIn: 50,  bounds: [-0.268, -0.003, 0.336, 0.997], color: '#5e8c54', defaultLayer: 'volume',     attachmentPoint: 'stem-base', placementMode: 'surface', allowScale: true, allowRotation: true, coverageMethod: 'projected-footprint' },
    'boston-fern': { id: 'boston-fern', category: 'bush', label: 'Boston fern bush', lengthIn: 14, widthIn: 10, footprintSqIn: 67,  bounds: [-0.504, -0.176, 0.496, 0.52], color: '#357a2e', defaultLayer: 'volume',   attachmentPoint: 'stem-base', placementMode: 'surface', allowScale: true, allowRotation: true, coverageMethod: 'projected-footprint' },
    grass:       { id: 'grass',       category: 'filler',         label: 'Grass tuft',       lengthIn: 12, widthIn: 6,  footprintSqIn: 42,  bounds: [-0.221, -0.001, 0.245, 0.999], color: '#6a9a4f', defaultLayer: 'filler',     attachmentPoint: 'stem-base', placementMode: 'surface', allowScale: true, allowRotation: true, coverageMethod: 'projected-footprint' },
    'ivy-vine':  { id: 'ivy-vine',    category: 'garland',        label: 'Ivy / wisteria vine', lengthIn: 24, widthIn: 6, footprintSqIn: 53, bounds: [-0.089, -0.978, 0.167, 0.022],     color: '#ee9ec4', defaultLayer: 'trailing',   attachmentPoint: 'stem-base', placementMode: 'surface', allowScale: true, allowRotation: true, coverageMethod: 'projected-footprint' },
    'leaf-vine': { id: 'leaf-vine',   category: 'garland',        label: 'Leaf vine',        lengthIn: 20, widthIn: 6,  footprintSqIn: 46,  bounds: [-0.128, -0.002, 0.152, 0.998], color: '#4a8a42', defaultLayer: 'trailing',   attachmentPoint: 'stem-base', placementMode: 'surface', allowScale: true, allowRotation: true, coverageMethod: 'projected-footprint' }
  };
  const GREENERY_TYPES = Object.keys(GREENERY_META);
  const cleanGreeneryType = value => (typeof value === 'string' && GREENERY_META[value] ? value : GREENERY_TYPES[0]);
  const GREENERY_MAX_ITEMS = 6;
  // Deterministic lightness shift (per-channel) so independent multi-colour borders can
  // alternate between a colour and its shades without touching the main palette.
  function shadeHex(hex, dl) {
    const h = String(hex || '').replace('#', '');
    if (!/^[0-9a-f]{6}$/i.test(h)) return '#ffffff';
    const ch = i => Math.max(0, Math.min(255, parseInt(h.slice(i, i + 2), 16) + dl));
    return '#' + [ch(0), ch(2), ch(4)].map(v => v.toString(16).padStart(2, '0')).join('');
  }
  const cleanEnum = (value, list, def) => (list.indexOf(value) >= 0 ? value : def);
  // Deterministic PRNG (mulberry32) + string/point hashes. Same seed -> same arrangement,
  // so a saved design can be recreated exactly.
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function hashStr(str) { let h = 2166136261 >>> 0; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
  function hash2(a, b) { let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263)) >>> 0; h = (h ^ (h >>> 13)) >>> 0; h = Math.imul(h, 1274126177) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
  function shuffle(arr, rand) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; } return arr; }
  function bboxOf(positions) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < positions.length; i++) { const p = positions[i]; if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
    return { x0, y0, x1, y1, w: Math.max(1e-6, x1 - x0), h: Math.max(1e-6, y1 - y0) };
  }
  // Maps a position to t in [0,1] along the chosen pattern direction.
  function axisFn(dir) {
    switch (dir) {
      case 'rtl': return (x, y, bb) => 1 - (x - bb.x0) / bb.w;
      case 'ttb': return (x, y, bb) => (y - bb.y0) / bb.h;
      case 'btt': return (x, y, bb) => 1 - (y - bb.y0) / bb.h;
      case 'diag': return (x, y, bb) => (((x - bb.x0) / bb.w) + ((y - bb.y0) / bb.h)) / 2;
      default: return (x, y, bb) => (x - bb.x0) / bb.w; // ltr
    }
  }
  // Spatial hash -> list of nearby flower indices (direct adjacency on the hex grid).
  function buildNeighbors(positions, bb) {
    const n = positions.length;
    const spacing = Math.sqrt((bb.w * bb.h) / Math.max(1, n)); // ~one grid step
    const radius = spacing * 1.25, r2 = radius * radius;
    const cell = radius, grid = new Map();
    for (let i = 0; i < n; i++) {
      const gx = Math.floor(positions[i][0] / cell), gy = Math.floor(positions[i][1] / cell);
      const k = gx + ',' + gy; let arr = grid.get(k); if (!arr) { arr = []; grid.set(k, arr); } arr.push(i);
    }
    const neighbors = new Array(n);
    for (let i = 0; i < n; i++) {
      const x = positions[i][0], y = positions[i][1], gx = Math.floor(x / cell), gy = Math.floor(y / cell), list = [];
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
        const arr = grid.get((gx + ox) + ',' + (gy + oy)); if (!arr) continue;
        for (let a = 0; a < arr.length; a++) { const j = arr[a]; if (j === i) continue; const dx = positions[j][0] - x, dy = positions[j][1] - y; if (dx * dx + dy * dy <= r2) list.push(j); }
      }
      neighbors[i] = list;
    }
    return neighbors;
  }
  function normalizeFlowerBorder(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    return {
      id: String(r.id || ''),
      type: 'flower',
      enabled: !!r.enabled,
      flowerType: cleanType(r.flowerType),
      flowerSize: [2, 3, 4, 5, 6].includes(Number(r.flowerSize)) ? Number(r.flowerSize) : 4,
      width: clamp(num(r.width, 4), 1, 12),
      density: clamp(num(r.density, 70), 10, 100),
      colorMode: cleanEnum(r.colorMode, BORDER_COLOR_MODES, 'independent'),
      color: /^#[0-9a-f]{6}$/i.test(r.color || '') ? r.color : '#ffc0cb',
      arrangement: cleanEnum(r.arrangement, BORDER_ARRANGEMENTS, 'continuous'),
      rotation: clamp(num(r.rotation, 30), 0, 180)
    };
  }
  function normalizeFrameBorder(raw, width, height) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const maxFrameIn = Math.min(24, Math.min(width, height) * 6 - 0.5);
    return {
      id: String(r.id || ''),
      type: 'frame',
      enabled: !!r.enabled,
      width: clamp(num(r.width, 6), 1, Math.max(1, maxFrameIn)),
      color: /^#[0-9a-f]{6}$/i.test(r.color || '') ? r.color : '#D4AF37',
      depth: clamp(num(r.depth, 2), 0.5, 4)
    };
  }
  // A greenery border layer: one species placed as a clipped band of leaves.
  function normalizeGreeneryBorderLayer(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    return {
      id: String(r.id || ''),
      type: 'greenery',
      enabled: !!r.enabled,
      species: cleanGreeneryType(r.species),
      width: clamp(num(r.width, 4), 1, 12),
      sizeScale: clamp(num(r.sizeScale, 1), 0.4, 2.5),
      density: clamp(num(r.density, 70), 10, 100),
      overlap: clamp(num(r.overlap, 0.5), 0, 1),
      rotationVariation: clamp(num(r.rotationVariation, 60), 0, 180),
      colorVariation: clamp(num(r.colorVariation, 0.3), 0, 1)
    };
  }
  // Border is now an ordered `layers` array (outside -> inside). Accepts the new array
  // form, or migrates the legacy fixed trio { fb1, frame, fb2, order } / flat fields.
  function normalizeBorder(settings, width, height) {
    const rawBorder = settings.border && typeof settings.border === 'object' ? settings.border : null;
    let layers = [];
    if (rawBorder && Array.isArray(rawBorder.layers)) {
      layers = rawBorder.layers.slice(0, BORDER_MAX_LAYERS).map(l => {
        if (l && l.type === 'frame') return normalizeFrameBorder(l, width, height);
        if (l && l.type === 'greenery') return normalizeGreeneryBorderLayer(l);
        return normalizeFlowerBorder(l);
      });
    } else if (rawBorder) {
      // Legacy fixed trio: keep every configured component (enabled or not) so re-enabling
      // later preserves its settings. Enabled ones follow the saved outside->inside order.
      const order = Array.isArray(rawBorder.order) ? rawBorder.order.filter(id => LEGACY_BORDER_COMPONENTS.includes(id)) : [];
      const seq = order.concat(LEGACY_BORDER_COMPONENTS.filter(id => !order.includes(id)));
      for (const id of seq) {
        if (id === 'frame') layers.push(normalizeFrameBorder(rawBorder.frame, width, height));
        else layers.push(normalizeFlowerBorder(rawBorder[id]));
      }
    } else if (settings.borderEnabled || settings.borderWidth != null || settings.borderColor != null) {
      // Very old flat fields: a single frame (enabled only when borderEnabled is set).
      layers.push(normalizeFrameBorder({ enabled: !!settings.borderEnabled, width: settings.borderWidth, color: settings.borderColor }, width, height));
    }
    // Unique ids for the layer list + order/reorder UI.
    const seen = new Set();
    layers.forEach((l, i) => {
      let id = l.id || ('bd' + (i + 1));
      let n = 1;
      while (seen.has(id)) { id = ('bd' + (i + 1)) + '-' + (++n); }
      l.id = id; seen.add(id);
    });
    // Combined widths of ENABLED layers are clamped so borders can never consume the panel.
    const enabled = layers.filter(l => l.enabled);
    const maxTotalIn = Math.max(2, Math.min(width, height) * 6 - 3); // leave >=0.5 ft inner area
    let total = enabled.reduce((sum, l) => sum + l.width, 0);
    if (total > maxTotalIn && total > 0) {
      const k = maxTotalIn / total;
      enabled.forEach(l => { l.width = Math.max(1, Math.round(l.width * k * 2) / 2); });
    }
    return { layers };
  }
  function normalizeGreeneryItem(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const meta = GREENERY_META[cleanGreeneryType(r.type)];
    return {
      type: meta.id,
      enabled: r.enabled === undefined ? true : !!r.enabled,
      sizeScale: clamp(num(r.sizeScale, 1), 0.4, 2.5),
      density: clamp(num(r.density, 70), 10, 100),
      proportion: clamp(num(r.proportion, 100), 1, 100),
      layer: cleanEnum(r.layer, GREENERY_LAYERS, meta.defaultLayer),
      colorVariation: clamp(num(r.colorVariation, 0.3), 0, 1),
      // Optional per-item colour override (e.g. wisteria racemes); null = species default.
      color: /^#[0-9a-f]{6}$/i.test(r.color || '') ? r.color : null,
      // Vines (species with supportsLeaves) can drop their foliage for a bare stem.
      showLeaves: r.showLeaves === undefined ? true : !!r.showLeaves
    };
  }
  function normalizeGreenery(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    let items = Array.isArray(r.items) ? r.items.slice(0, GREENERY_MAX_ITEMS).map(normalizeGreeneryItem) : [];
    if (!items.length) items = [normalizeGreeneryItem({ type: GREENERY_TYPES[0] })];
    // Mixed proportions are renormalized to a usable spread (they don't have to sum to 100
    // on input). Single mode keeps exactly one active item.
    const mode = cleanEnum(r.mode, GREENERY_MODES, 'single');
    if (mode === 'single') items = [items[0]];
    else {
      const total = items.reduce((sum, it) => sum + it.proportion, 0) || 1;
      items = items.map(it => ({ ...it, proportion: Math.round(it.proportion / total * 100) }));
      const drift = 100 - items.reduce((sum, it) => sum + it.proportion, 0);
      if (items.length) items[0].proportion = clamp(items[0].proportion + drift, 1, 100);
    }
    return {
      mode,
      direction: cleanEnum(r.direction, GREENERY_DIRECTIONS, 'mixed'),
      overlap: clamp(num(r.overlap, 0.5), 0, 1),
      rotationVariation: clamp(num(r.rotationVariation, 60), 0, 180),
      seed: Number.isFinite(Number(r.seed)) ? (Math.abs(Math.floor(Number(r.seed))) >>> 0) : 1,
      items
    };
  }
  function normalize(settings = {}) {
    const width = clamp(num(settings.width, 8), 1, 30);
    const height = clamp(num(settings.height, 8), 1, 30);
    const flowerSize = [4, 5, 6].includes(Number(settings.flowerSize)) ? Number(settings.flowerSize) : 5;
    const coverage = clamp(num(settings.coverage, 100), 70, 100);
    const flowerType = cleanType(settings.flowerType);
    let colors = Array.isArray(settings.colors) ? settings.colors.slice(0, 5) : [];
    if (!colors.length) colors = [{ id: 1, name: 'White', hex: '#ffffff' }];
    colors = colors.map((c, i) => ({ id: Number(c.id) || i + 1, name: String(c.name || 'Color'), hex: cleanHex(c.hex) }));
    const pattern = cleanEnum(settings.pattern, PATTERNS, 'nongrouping');
    const mixIntensity = cleanEnum(settings.mixIntensity, MIX_INTENSITIES, 'high');
    const groupingLimit = cleanEnum(settings.groupingLimit, GROUPING_LIMITS, 'balanced');
    const clusterSize = cleanEnum(settings.clusterSize, CLUSTER_SIZES, 'small');
    const patternDirection = cleanEnum(settings.patternDirection, PATTERN_DIRS, 'ltr');
    const seed = Number.isFinite(Number(settings.seed)) ? (Math.abs(Math.floor(Number(settings.seed))) >>> 0) : 1;
    // Border designer: `border.layers` is canonical (ordered outside->inside); legacy
    // {fb1,frame,fb2,order} / flat fields migrate via normalizeBorder.
    const border = normalizeBorder(settings, width, height);
    const borderActive = border.layers.some(l => l.enabled);
    const firstFrame = border.layers.find(l => l.type === 'frame');
    // Design mode: what composites in the scene. Legacy arrangements default to 'flowers'
    // so the existing flower-only look is preserved on load. The UI exposes this as two
    // independent checkboxes (Flowers on + Greenery on); when either flag is present it
    // wins so a saved pair of booleans round-trips exactly. Both-off falls back to flowers.
    let designMode = cleanEnum(settings.designMode, DESIGN_MODES, 'flowers');
    if (settings.flowersOn !== undefined || settings.greeneryOn !== undefined) {
      const f = settings.flowersOn === undefined ? designMode !== 'greenery' : !!settings.flowersOn;
      const g = settings.greeneryOn === undefined ? designMode !== 'flowers' : !!settings.greeneryOn;
      designMode = f && g ? 'mixed' : f ? 'flowers' : g ? 'greenery' : 'flowers';
    }
    const flowersOn = designMode !== 'greenery';
    const greeneryOn = designMode !== 'flowers';
    // Composition style only matters in mixed mode (flowers + greenery together).
    const composition = designMode === 'mixed' ? cleanEnum(settings.composition, COMPOSITIONS, 'greenery-base') : null;
    const projection = cleanEnum(settings.projection, PROJECTIONS, 'medium');
    const greenery = normalizeGreenery(settings.greenery);
    // Optional greenery ring behind each flower head (calyx/sepals peeking out). Off by
    // default so the existing flower-only look is preserved; the Studio exposes it as a
    // "Show leaves" checkbox.
    const flowerLeaves = settings.flowerLeaves === undefined ? false : !!settings.flowerLeaves;
    return { name: String(settings.name || 'Untitled arrangement'), width, height, flowerSize, coverage, flowerType, colors, pattern, mixIntensity, groupingLimit, clusterSize, patternDirection, seed, border, borderEnabled: borderActive, borderWidth: firstFrame ? firstFrame.width : 6, borderColor: firstFrame ? firstFrame.color : '#D4AF37', designMode, flowersOn, greeneryOn, composition, projection, greenery, flowerLeaves };
  }
  // Head lift off the foam face for the projection band, in world units. The
  // reference sheet's bands are measured from the wall face to the front of the
  // design; heads add their own depth (~25% of head size) on top of this lift.
  function flowerProjection(settings, scale = 0.72) {
    const s = normalize(settings);
    const liftIn = PROJECTION_LIFT_IN[s.projection] != null ? PROJECTION_LIFT_IN[s.projection] : PROJECTION_LIFT_IN.medium;
    return liftIn * (scale / 12);
  }
  // Deterministic per-flower lift jitter (78%-122% of the band lift) so the bloom
  // surface reads as a soft 3D field instead of a flat plane at one z.
  function projectionJitter(seed) {
    const v = Math.sin((seed >>> 0) * 127.1 + 311.7) * 43758.5453;
    return 0.78 + 0.44 * (v - Math.floor(v));
  }
  // Look up a border layer by id (or accept the layer object itself).
  function findBorderLayer(s, which) {
    if (!which) return null;
    if (typeof which === 'object') return which;
    return (s.border && s.border.layers ? s.border.layers : []).find(l => l.id === which) || null;
  }
  // Concentric bands for the enabled layers (outside -> inside) + total inset.
  function borderBands(settings) {
    const s = normalize(settings), b = s.border;
    const enabled = b.layers.filter(l => l.enabled);
    let inset = 0;
    const bands = [];
    for (const l of enabled) {
      const widthFt = l.width / 12;
      bands.push({ id: l.id, type: l.type, widthFt, outerInsetFt: inset, innerInsetFt: inset + widthFt, layer: l });
      inset += widthFt;
    }
    return { bands, totalInsetFt: inset, enabled };
  }
  // Inner floral area (feet) — panel minus the combined width of every enabled border.
  function innerArea(settings) {
    const s = normalize(settings);
    if (!s.borderEnabled) return { width: s.width, height: s.height };
    const { totalInsetFt } = borderBands(s);
    return { width: Math.max(0.1, s.width - 2 * totalInsetFt), height: Math.max(0.1, s.height - 2 * totalInsetFt) };
  }
  function positions(settings, scale = 0.72) {
    const s = normalize(settings);
    // Flowers fill the inner floral area (panel minus border), not the full panel.
    const area = innerArea(s);
    const W = area.width * scale, H = area.height * scale;
    const pack = SPECIES_PACK[s.flowerType] || 1;
    const diameter = s.flowerSize / 12 * scale;
    // Coverage 100% is "full coverage": a solid wall of flowers with no foam showing through.
    // Pack denser and let the outer ring overhang the panel edge so borders and corners are
    // covered. Below 100%, thin a normal (sparser) grid down to the requested proportion so
    // partial coverage stays cheap on mobile.
    const full = s.coverage >= 100;
    const step = diameter * (full ? 0.65 : 0.76) * pack;
    const rowStep = step * 0.866;
    // Overhang hides the panel edge when there is no border. With a border the frame
    // covers the edge, so flowers must stay strictly inside the inner area.
    const over = (full && !s.borderEnabled) ? diameter * 0.45 : 0;
    const out = [];
    if (full) {
      // Full coverage: a hex grid centred on the panel so every edge overhangs by the
      // same amount (right/top no longer left short). Integer stepping from the lower
      // left left one side sparse and the other overflowing; centring fixes that.
      // Candidate points are filtered by a symmetric bound instead of an integer column
      // count, so small packing-factor differences still change the flower count.
      const extentX = W / 2 + over - diameter * 0.5;
      const extentY = H / 2 + over - diameter * 0.5;
      const boundX = extentX + step * 0.5;
      const boundY = extentY + rowStep * 0.5;
      const rMax = Math.ceil(boundY / rowStep) + 1;
      const cMax = Math.ceil(boundX / step) + 1;
      for (let r = -rMax; r <= rMax; r++) {
        const y = r * rowStep;
        if (Math.abs(y) > boundY) continue;
        const odd = (((r % 2) + 2) % 2) === 1;
        const offset = odd ? step / 2 : 0;
        for (let c = -cMax; c <= cMax; c++) {
          const x = c * step + offset;
          if (Math.abs(x) <= boundX) out.push([x, y]);
        }
      }
    } else {
      // Partial coverage: normal (sparse) grid; thinned below.
      let row = 0;
      for (let y = -H / 2 + diameter * 0.5; y <= H / 2 - diameter * 0.5 + 1e-9; y += rowStep, row++) {
        const offset = (row % 2) * step / 2;
        for (let x = -W / 2 + diameter * 0.5 + offset; x <= W / 2 - diameter * 0.5 + 1e-9; x += step) out.push([x, y]);
      }
    }
    // Foliage-clusters composition (mixed mode): relocate the flower lattice into the
    // shared cluster field so flowers nest within/around foliage instead of forming a flat
    // wall. COUNT still tracks coverage (× a composition thin factor); only WHICH cells are
    // filled changes. Every region keeps a base weight so no corner goes conspicuously empty.
    if (s.designMode === 'mixed' && s.composition === 'foliage-clusters') {
      const tune = compositionParams(s.composition);
      const target = Math.max(1, Math.round(out.length * s.coverage / 100 * tune.flowerThin));
      const clusters = foliageClusters(s, W, H, (s.seed ^ 0x1f2e3d4c) >>> 0);
      return pickWeightedSubset(out, target,
        (x, y) => clusterWeightAt(clusters, x, y, tune.flowerBase, tune.flowerCluster),
        (s.seed ^ hashStr('flowers')) >>> 0);
    }
    const target = Math.max(1, Math.ceil(out.length * s.coverage / 100));
    if (target >= out.length) return out;
    // Deterministic seeded shuffle, then keep the first N. A plain every-kth filter
    // banded by row order and left visible striping; shuffling scatters the gaps evenly.
    const order = out.map((_, i) => i);
    let seed = (0x9e3779b9 ^ out.length ^ (s.coverage * 2654435761)) >>> 0;
    const rand = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = order[i]; order[i] = order[j]; order[j] = t; }
    return order.slice(0, target).sort((a, b) => a - b).map(i => out[i]);
  }
  function counts(settings, count) {
    const s = normalize(settings), n = Math.max(0, Number.isFinite(count) ? count : positions(s).length);
    const base = Math.floor(n / s.colors.length), extra = n % s.colors.length;
    return s.colors.map((c, i) => ({ ...c, count: base + (i < extra ? 1 : 0) }));
  }

  // ---- flower border placement ---------------------------------------------
  // Grid step factor for a flower border from its arrangement style + density.
  function borderSpacingFactor(comp) {
    const base = { continuous: 0.65, spaced: 1.15, alternating: 0.8, paired: 0.9, mixed: 0.8 }[comp.arrangement] || 0.8;
    const dens = 1.3 - (comp.density / 100) * 0.6; // density 0 -> looser, 100 -> tighter
    return clamp(base * dens, 0.5, 1.6);
  }
  // Flower centres for one flower border: a hex grid clipped to its rectangular band
  // (between outerInset and innerInset), ordered around the perimeter for colour patterns.
  function borderPositions(settings, which, scale = 0.72) {
    const s = normalize(settings);
    const comp = findBorderLayer(s, which);
    if (!comp || !comp.enabled || comp.type !== 'flower') return [];
    const band = borderBands(s).bands.find(bd => bd.id === comp.id);
    if (!band) return [];
    const W = s.width * scale, H = s.height * scale;
    const outerHW = W / 2 - band.outerInsetFt * scale;
    const outerHH = H / 2 - band.outerInsetFt * scale;
    const innerHW = W / 2 - band.innerInsetFt * scale;
    const innerHH = H / 2 - band.innerInsetFt * scale;
    if (innerHW <= 0.01 || innerHH <= 0.01) return [];
    const pack = SPECIES_PACK[comp.flowerType] || 1;
    const diameter = comp.flowerSize / 12 * scale;
    const step = diameter * borderSpacingFactor(comp) * pack;
    const rowStep = step * 0.866;
    const m = diameter / 2 * 0.35; // keep flowers inside their band
    const out = [];
    const rMax = Math.ceil(outerHH / rowStep) + 1, cMax = Math.ceil(outerHW / step) + 1;
    for (let rw = -rMax; rw <= rMax; rw++) {
      const y = rw * rowStep;
      if (Math.abs(y) > outerHH) continue;
      const odd = (((rw % 2) + 2) % 2) === 1, offset = odd ? step / 2 : 0;
      for (let c = -cMax; c <= cMax; c++) {
        const x = c * step + offset;
        if (Math.abs(x) > outerHW) continue;
        if (Math.abs(x) > outerHW - m || Math.abs(y) > outerHH - m) continue; // inside outer band
        if (Math.abs(x) <= innerHW + m && Math.abs(y) <= innerHH + m) continue; // outside inner hole
        out.push([x, y]);
      }
    }
    // Angular (perimeter) order so alternating/paired/mixed read correctly around the frame.
    out.sort((a, b) => Math.atan2(a[1], a[0]) - Math.atan2(b[1], b[0]));
    return out;
  }
  // Greenery border: one species placed as a leaf band clipped to the ring between the
  // layer's outerInset and innerInset. A perimeter walk (not a lattice clip) is used because
  // a band can be much thinner than one leaf step, which would leave a lattice clip empty.
  // Walks 1..N concentric rings around the band, spacing leaves by the species' natural
  // step, so all four sides get an even hedge. Leaf bodies may overhang slightly inward
  // but origins never leave the band.
  function greeneryBorderPositions(settings, which, scale = 0.72) {
    const s = normalize(settings);
    const layer = findBorderLayer(s, which);
    if (!layer || !layer.enabled || layer.type !== 'greenery') return [];
    const band = borderBands(s).bands.find(bd => bd.id === layer.id);
    if (!band) return [];
    const meta = GREENERY_META[layer.species] || GREENERY_META[GREENERY_TYPES[0]];
    const W = s.width * scale, H = s.height * scale;
    const outerHW = W / 2 - band.outerInsetFt * scale, outerHH = H / 2 - band.outerInsetFt * scale;
    const innerHW = W / 2 - band.innerInsetFt * scale, innerHH = H / 2 - band.innerInsetFt * scale;
    if (outerHW <= 0.01 || outerHH <= 0.01) return [];
    const t = Math.max(0.01, (band.innerInsetFt - band.outerInsetFt) * scale); // band thickness (scene ft)
    const step = greeneryStep(meta.footprintSqIn * layer.sizeScale * layer.sizeScale, layer.overlap, scale);
    const rowStep = step * 0.866;
    const gSeed = ((s.greenery.seed >>> 0) ^ hashStr(layer.id)) >>> 0;
    const rand = mulberry32((gSeed ^ hashStr(meta.id)) >>> 0);
    const mOut = t * 0.2, mIn = t * 0.2; // keep origins off the band's outer and inner edges
    // One ring = the perimeter of a rectangle inset from the band's outer edge.
    // Returns evenly spaced points (corners included once each).
    const walkRing = (hw, hh, spacing) => {
      if (hw <= 0.01 || hh <= 0.01) return [];
      const per = 4 * hw + 4 * hh;
      const n = Math.max(8, Math.round(per / spacing));
      const segs = [2 * hw, 2 * hh, 2 * hw, 2 * hh];
      const pts = [];
      for (let i = 0; i < n; i++) {
        let d = (i + 0.5) * per / n, e = 0;
        while (e < 3 && d > segs[e]) { d -= segs[e]; e++; }
        if (e === 0) pts.push([-hw + d, -hh]);
        else if (e === 1) pts.push([hw, -hh + d]);
        else if (e === 2) pts.push([hw - d, hh]);
        else pts.push([-hw, hh - d]);
      }
      return pts;
    };
    // Concentric rings from the outer band edge inward, while they still clear the hole.
    const sites = [];
    for (let r = 0; r < 4; r++) {
      const hw = outerHW - mOut - r * rowStep, hh = outerHH - mOut - r * rowStep;
      if (hw <= innerHW + mIn || hh <= innerHH + mIn) break;
      sites.push(...walkRing(hw, hh, step));
    }
    if (!sites.length) sites.push(...walkRing(Math.max(0.02, outerHW - mOut), Math.max(0.02, outerHH - mOut), step));
    const target = Math.max(1, Math.round(sites.length * layer.density / 100));
    const kept = pickSubset(sites, target, gSeed);
    const scaleW = meta.lengthIn / 12 * scale * layer.sizeScale;
    const rotMax = (layer.rotationVariation || 0) * Math.PI / 180;
    const jit = step * 0.24;
    const out = [];
    for (let i = 0; i < kept.length; i++) {
      let [x, y] = kept[i];
      const jx = (rand() * 2 - 1) * jit, jy = (rand() * 2 - 1) * jit;
      x = clamp(x + jx, -(outerHW - mOut), outerHW - mOut);
      y = clamp(y + jy, -(outerHH - mOut), outerHH - mOut);
      // If jitter pushed the origin into the inner hole, shove it back out to the ring edge.
      if (innerHW > 0.01 && innerHH > 0.01 && Math.abs(x) <= innerHW + mIn && Math.abs(y) <= innerHH + mIn) {
        const dxOut = (innerHW + mIn) - Math.abs(x), dyOut = (innerHH + mIn) - Math.abs(y);
        if (dxOut < dyOut) x = Math.sign(x || 1) * (innerHW + mIn);
        else y = Math.sign(y || 1) * (innerHH + mIn);
      }
      const sc = scaleW * (0.9 + rand() * 0.2);
      // Fan leaves outward from the panel centre, with rotation-variation jitter.
      const base = Math.atan2(y, x) - Math.PI / 2;
      const rot = base + (rand() * 2 - 1) * rotMax;
      out.push({ key: 0, type: meta.id, layer: meta.defaultLayer, x, y, z: 0.009, rot, variant: rand(), seed: (gSeed + i * 2654435761) >>> 0, scale: sc });
    }
    return out;
  }
  // Effective colour list for a flower border. Independent mode uses the picked colour
  // (plus deterministic shades for multi-colour styles); palette mode reuses the main palette.
  function borderEffectivePalette(settings, which, mainHexes) {
    const s = normalize(settings);
    const comp = findBorderLayer(s, which);
    if (!comp) return [];
    if (comp.colorMode === 'palette' && Array.isArray(mainHexes) && mainHexes.length) return mainHexes.slice(0, 5);
    const multi = ['alternating', 'paired', 'mixed'].includes(comp.arrangement);
    if (!multi) return [comp.color];
    return [comp.color, shadeHex(comp.color, 50), shadeHex(comp.color, -50)];
  }
  // Deterministic colour indices along a border for its arrangement style.
  function borderColorIndices(n, paletteLen, arrangement, seed) {
    if (n <= 0) return [];
    if (paletteLen <= 1) return new Array(n).fill(0);
    const out = new Array(n);
    const rand = mulberry32(((seed >>> 0) ^ hashStr(arrangement)) >>> 0);
    for (let i = 0; i < n; i++) {
      switch (arrangement) {
        case 'alternating': out[i] = i % paletteLen; break;
        case 'paired': out[i] = Math.floor(i / 2) % paletteLen; break;
        case 'mixed': out[i] = Math.floor(rand() * paletteLen) % paletteLen; break;
        default: out[i] = 0; // continuous / spaced use a single colour
      }
    }
    return out;
  }
  // All orderings of the enabled components, for the border-order selector.
  function orderOptions(enabledIds) {
    const perms = [];
    const permute = (arr, cur) => {
      if (!arr.length) { perms.push(cur.slice()); return; }
      for (let i = 0; i < arr.length; i++) permute(arr.slice(0, i).concat(arr.slice(i + 1)), cur.concat([arr[i]]));
    };
    permute((enabledIds || []).slice(), []);
    return perms;
  }

  // ---- greenery placement engine -------------------------------------------
  const greeneryLayerIndex = name => { const i = GREENERY_LAYERS.indexOf(name); return i >= 0 ? i : 1; };
  // Items actually placed: single -> exactly one; mixed -> every enabled item.
  function greeneryActiveItems(g) {
    if (!g) return [];
    if (g.mode === 'single') return g.items.slice(0, 1);
    return g.items.filter(it => it.enabled);
  }
  // Deterministic subset (seeded shuffle, keep first N) so density thins a fixed grid
  // evenly instead of leaving row striping — same technique as flower coverage.
  function pickSubset(arr, target, seed) {
    const order = arr.map((_, i) => i);
    const rand = mulberry32((seed >>> 0) || 1);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = order[i]; order[i] = order[j]; order[j] = t; }
    const keep = Math.min(Math.max(1, target), arr.length);
    return order.slice(0, keep).sort((a, b) => a - b).map(i => arr[i]);
  }
  // Grid step (world units) for an item from its footprint + the overlap setting.
  //
  // OVERLAP (0.0–1.0) = how tightly pieces are packed. It sets the lattice step relative
  // to the piece's equivalent footprint diameter D:
  //     step = D * (0.95 − 0.35 * overlap),  clamped to [0.60·D, 0.95·D]
  //   overlap 0.0 → 0.95·D  (loose; neighbours just touch)
  //   overlap 1.0 → 0.60·D  (tight; ~40% overlap) — the 0.60 floor stops pieces from
  //                         collapsing into an uncontrolled pile no matter the setting.
  // Overlap only controls SPACING. Piece COUNT comes from density (fraction of this
  // lattice filled) and Size/Rotation stay independent of it.
  function greeneryStep(footprintSqIn, overlap, scale) {
    const dIn = 2 * Math.sqrt(footprintSqIn / Math.PI);   // equivalent-circle diameter (in)
    const dW = dIn / 12 * scale;                          // -> world units
    return dW * clamp(0.95 - clamp(overlap, 0, 1) * 0.35, 0.60, 0.95);
  }
  // ---- foliage-cluster composition (mixed mode only) -------------------------
  // Composition styles tune how flowers and greenery share the panel in 'mixed' mode.
  // 'greenery-base' keeps the historic behaviour (uniform greenery lattice + uniform
  // flower wall). 'foliage-clusters' is the foliage-led target: greenery forms organic
  // clusters and flowers nest within/around them. 'flower-dominant' keeps a dense flower
  // wall and thins greenery to a supporting background.
  const COMPOSITION_TUNE = {
    'greenery-base':    { flowerThin: 1.00, flowerBase: 1.00, flowerCluster: 0.0, greeneryThin: 1.00, greeneryBase: 1.00, greeneryCluster: 0.0 },
    'foliage-clusters': { flowerThin: 0.82, flowerBase: 0.38, flowerCluster: 0.75, greeneryThin: 1.00, greeneryBase: 0.12, greeneryCluster: 1.00 },
    'flower-dominant':  { flowerThin: 1.00, flowerBase: 1.00, flowerCluster: 0.0, greeneryThin: 0.55, greeneryBase: 0.55, greeneryCluster: 0.30 }
  };
  function compositionParams(composition) {
    return COMPOSITION_TUNE[composition] || COMPOSITION_TUNE['greenery-base'];
  }
  // Deterministic cluster field: a jittered grid of blobs whose radii overlap so
  // neighbouring clusters merge into organic masses instead of isolated piles.
  function foliageClusters(s, W, H, seed) {
    const rand = mulberry32((seed >>> 0) || 1);
    const area = Math.max(0.01, W * H);
    // ~1 blob per 3 world-units² (≈6 real sq ft), clamped to a sane count.
    const targetCount = clamp(Math.round(area / 3.0), 3, 40);
    const cols = Math.max(2, Math.round(Math.sqrt(Math.max(1, targetCount * (W / H)))));
    const rows = Math.max(2, Math.round(targetCount / cols));
    const cellW = W / cols, cellH = H / rows;
    const clusters = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cx = ((c + 0.5) / cols - 0.5) * W + (rand() * 2 - 1) * cellW * 0.4;
        const cy = ((r + 0.5) / rows - 0.5) * H + (rand() * 2 - 1) * cellH * 0.4;
        // Radius spans ~0.5–0.9× the cell so adjacent blobs touch/overlap (organic merges).
        const rr = Math.max(cellW, cellH) * (0.5 + rand() * 0.4);
        clusters.push({ x: cx, y: cy, r: Math.max(0.2, rr), strength: 0.7 + rand() * 0.6 });
      }
    }
    return clusters;
  }
  // Spatial weight at a point: a smooth radial falloff per cluster plus a constant base
  // so no region is ever fully empty (avoids conspicuous holes).
  function clusterWeightAt(clusters, x, y, base, boost) {
    let w = base;
    for (let i = 0; i < clusters.length; i++) {
      const cl = clusters[i];
      const dx = x - cl.x, dy = y - cl.y;
      const d = Math.sqrt(dx * dx + dy * dy) / cl.r;
      if (d < 1) { const f = (1 - d * d); w += boost * cl.strength * f * f; }
    }
    return w;
  }
  // Weighted subset (Efraimidis-Spirakis reservoir): deterministic given `seed`, biases
  // selection toward high-weight cells while still sampling low-weight ones (base > 0).
  function pickWeightedSubset(cands, target, weightFn, seed) {
    if (!cands.length) return [];
    const rand = mulberry32((seed >>> 0) || 1);
    const scored = new Array(cands.length);
    for (let i = 0; i < cands.length; i++) {
      const w = Math.max(1e-6, weightFn(cands[i][0], cands[i][1]));
      scored[i] = { c: cands[i], k: Math.pow(rand(), 1 / w) };
    }
    scored.sort((a, b) => b.k - a.k);
    const keep = Math.min(Math.max(1, target), cands.length);
    const out = new Array(keep);
    for (let i = 0; i < keep; i++) out[i] = scored[i].c;
    return out;
  }
  // No species is a true 360° radial rosette today — the fern is a wall-anchored upward
  // fountain (base at the crown, fronds opening up), so every category is authored in
  // its usable pose and gets the gentle scatter. Re-add here if a genuine
  // orientation-free rosette returns.
  const RADIAL_CATEGORIES = new Set([]);
  function greeneryRotation(g, direction, x, y, rand, category) {
    const radial = category ? RADIAL_CATEGORIES.has(category) : false;
    let base;
    switch (direction) {
      case 'upright': base = 0; break;                                  // tip toward +y
      case 'diag':    base = Math.PI / 4; break;
      case 'outward': base = Math.atan2(y, x) - Math.PI / 2; break;      // tip radially out
      default:        // 'mixed': radial bushes scatter freely; directional pieces stay
        // near their authored pose (±15°) so garlands read horizontal, tufts vertical.
        base = radial ? rand() * Math.PI * 2 : (rand() * 2 - 1) * 0.26;
    }
    // Directional pieces get a gentle half-variation jitter: a piece must never land
    // upside-down or near-vertical when 'Upright'/'Mixed' was asked for. Radial bushes
    // keep the full variation (rotationally symmetric, so nothing can look wrong).
    const jitter = (rand() * 2 - 1) * g.rotationVariation * (radial ? 1 : 0.35) * Math.PI / 180;
    return base + jitter;
  }
  // Layered placement: structural -> volume -> filler -> trailing, large pieces first so
  // smaller fillers are not hidden behind them. Returns a flat instance list stamped with
  // the owning item's key + type so the scene can group by type and the estimate by item.
  // Depth (z) is chosen so greenery interleaves with the flowers in a mixed panel:
  //   behind flowers   = just above the foam front face (z=0), below the flower heads
  //   between flowers  = within the flower-head height band
  //   in front         = above the tallest flower petal
  // In greenery-only mode (no flowers) we only need a small stagger above the foam.
  function greeneryZ(item, layerIdx, flowerTopZ) {
    if (flowerTopZ > 0) {
      switch (item.layer) {
        // Frame plane is z=0.006; structural greenery sits just above it so the order is
        // frame < greenery base < flower heads (verified against app.js scene structure).
        case 'structural': return 0.010;                    // behind the flower heads
        case 'volume':     return flowerTopZ * 0.45;        // among the petals (between)
        case 'filler':     return flowerTopZ * 0.85;        // near the top (between/front)
        default:           return flowerTopZ + 0.02;        // trailing -> clearly in front
      }
    }
    return 0.005 + layerIdx * 0.010;                        // greenery-only stagger above foam
  }
  // Does a placed footprint stay inside the usable half-bounds? Uses the model's projected
  // bounding box (meta.bounds) rotated by `rot`, scaled by `s`, translated to (x,y).
  // Returns { fits, dx, dy } where dx/dy is the minimal inward shift (world) to bring the
  // footprint inside (0 when already inside). Orientation- and scale-aware, so the FULL
  // leaf body is contained — not just the instance origin.
  function footprintFit(meta, x, y, rot, s, halfW, halfH) {
    const b = meta.bounds;
    const cs = Math.cos(rot), sn = Math.sin(rot);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const corners = [[b[0], b[1]], [b[0], b[3]], [b[2], b[1]], [b[2], b[3]]];
    for (let i = 0; i < 4; i++) {
      const lx = corners[i][0], ly = corners[i][1];
      const wx = x + (lx * cs - ly * sn) * s, wy = y + (lx * sn + ly * cs) * s;
      if (wx < minX) minX = wx; if (wx > maxX) maxX = wx;
      if (wy < minY) minY = wy; if (wy > maxY) maxY = wy;
    }
    const tol = 1e-6;
    let dx = 0, dy = 0;
    if (minX < -halfW - tol) dx = -halfW - minX;
    else if (maxX > halfW + tol) dx = halfW - maxX;
    if (minY < -halfH - tol) dy = -halfH - minY;
    else if (maxY > halfH + tol) dy = halfH - maxY;
    const fits = minX >= -halfW - tol && maxX <= halfW + tol && minY >= -halfH - tol && maxY <= halfH + tol;
    return { fits, dx, dy };
  }
  let _lastOmitted = 0;                 // pieces dropped by containment on the last call
  function greeneryPositions(settings, scale = 0.72) {
    const s = normalize(settings), g = s.greenery;
    const area = innerArea(s);
    const W = area.width * scale, H = area.height * scale;
    const gSeed = (g.seed >>> 0);
    // Head top = petal lift (~0.14*S) plus the projection band's stem lift; greenery
    // layers spread through the full head height so they interleave with lifted blooms.
    const flowerTopZ = s.designMode === 'mixed'
      ? 0.14 * (s.flowerSize / 12) * scale + flowerProjection(s, scale)
      : 0;
    const out = [];
    _lastOmitted = 0;
    // Composition tuning (mixed mode only). The cluster field is computed ONCE so every
    // species lands in the same organic masses (they co-locate rather than scattering
    // independently). It uses the SAME seed and inner-area extents as the flower layer,
    // so flowers and foliage coordinate.
    const mixed = s.designMode === 'mixed';
    const tune = mixed ? compositionParams(s.composition) : compositionParams('greenery-base');
    const useClusters = mixed && (s.composition === 'foliage-clusters' || s.composition === 'flower-dominant');
    const clusters = useClusters ? foliageClusters(s, W, H, (s.seed ^ 0x1f2e3d4c) >>> 0) : null;
    const ordered = g.items.map((item, key) => ({ item, key }))
      .filter(({ item, key }) => (g.mode === 'single' ? key === 0 : item.enabled))
      .sort((a, b) => greeneryLayerIndex(a.item.layer) - greeneryLayerIndex(b.item.layer));
    for (const { item, key } of ordered) {
      const meta = GREENERY_META[item.type];
      if (!meta) continue;
      // Lattice spacing must track the ACTUAL placed size (sizeScale), not the size-1
      // footprint: a 2.1x leaf is 2.1x wider, so its grid cell must be 2.1x too. Otherwise
      // big leaves crammed onto a size-1 lattice overlap so hard that the containment
      // filter omits nearly every piece (the "only 1 leaf placed" bug).
      const step = greeneryStep(meta.footprintSqIn * item.sizeScale * item.sizeScale, g.overlap, scale);
      const rowStep = step * 0.866;
      // Centred hex lattice of candidate ORIGINS across the usable (inner) area.
      const cands = [];
      const cMax = Math.ceil((W / 2) / step) + 1, rMax = Math.ceil((H / 2) / rowStep) + 1;
      for (let r = -rMax; r <= rMax; r++) {
        const y = r * rowStep;
        if (Math.abs(y) > H / 2) continue;
        const odd = (((r % 2) + 2) % 2) === 1, offset = odd ? step / 2 : 0;
        for (let c = -cMax; c <= cMax; c++) {
          const x = c * step + offset;
          if (Math.abs(x) <= W / 2) cands.push([x, y]);
        }
      }
      // Density selects the FRACTION of lattice cells to fill (fullness), not a hidden
      // piece-count multiplier. In mixed mode `proportion` is each item's SHARE of the
      // panel: it scales that item's lattice fill, so a low-proportion species can never
      // dominate the composition. Single mode uses the full density (proportion = 100).
      const share = g.mode === 'mixed' ? (item.proportion || 100) / 100 : 1;
      const target = Math.round(cands.length * item.density / 100 * share * tune.greeneryThin);
      // Foliage-clusters: bias lattice fill toward the cluster field (dense organic masses
      // + a low base so gaps between clusters still get sparse connecting leaves). Flower-
      // dominant: milder clustering over a thinned lattice. Greenery-base: uniform (historic).
      const kept = clusters
        ? pickWeightedSubset(cands, target,
            (x, y) => clusterWeightAt(clusters, x, y, tune.greeneryBase, tune.greeneryCluster),
            gSeed ^ hashStr(item.type) ^ (key * 0x9e3779b9))
        : pickSubset(cands, target, gSeed ^ hashStr(item.type) ^ (key * 0x9e3779b9));
      const layerIdx = greeneryLayerIndex(item.layer);
      const z = greeneryZ(item, layerIdx, flowerTopZ);
      const scaleW = meta.lengthIn / 12 * scale * item.sizeScale;    // geometry long axis = 1
      const rand = mulberry32((gSeed ^ hashStr(item.type) ^ (key * 2654435761)) >>> 0);
      const jit = step * 0.24;
      for (let i = 0; i < kept.length; i++) {
        let [x, y] = kept[i];
        const jx = (rand() * 2 - 1) * jit, jy = (rand() * 2 - 1) * jit;
        x = clamp(x + jx, -W / 2, W / 2);
        y = clamp(y + jy, -H / 2, H / 2);
        const sc = scaleW * (0.9 + rand() * 0.2);                     // subtle size variation
        let rot = greeneryRotation(g, g.direction, x, y, rand, meta.category);
        // HARD CONTAINMENT: keep the full rotated+scaled footprint inside the usable panel
        // (which already excludes the border bands via innerArea). If a leaf would overhang
        // an edge, nudge the origin inward once; if it still cannot fit, omit the piece.
        let fit = footprintFit(meta, x, y, rot, sc, W / 2, H / 2);
        if (!fit.fits) {
          x = clamp(x + fit.dx, -W / 2, W / 2);
          y = clamp(y + fit.dy, -H / 2, H / 2);
          rot = greeneryRotation(g, g.direction, x, y, rand, meta.category);
          fit = footprintFit(meta, x, y, rot, sc, W / 2, H / 2);
          if (!fit.fits) { _lastOmitted++; continue; }
        }
        out.push({
          key, type: item.type, layer: item.layer, x, y, z,
          rot, scale: sc,
          color: item.color || null,
          variant: rand(),
          seed: (gSeed + i * 2654435761 + key * 40503) >>> 0
        });
      }
    }
    return out;
  }
  // Quantity per item + honest estimated panel coverage. Coverage uses a saturating
  // union model from projected footprint (covered = 1 - e^-load), so it is NEVER the
  // density setting: overlap makes extra pieces cover progressively less new area.
  // GREENERY_LOAD_K is CALIBRATED (not guessed): rasterizing the real placed geometry on a
  // 5x8ft panel and solving K = -ln(1-measured)/load gives ~0.97 (monstera), ~0.97
  // (eucalyptus) and ~1.28 (boston-fern). 1.05 balances them and stops the old K=1.5 from
  // over-stating coverage by ~15 points. See tests/greenery-engine-tests.js.
  const GREENERY_LOAD_K = 1.05;
  function greeneryEstimate(settings, scale = 0.72) {
    const s = normalize(settings), g = s.greenery;
    const area = innerArea(s);
    // area.width (ft) * 12 = in; panel area in in² = (w*12)*(h*12) = w*h*144.
    const panelIn2 = area.width * area.height * 144;
    const inst = greeneryPositions(s, scale);
    const active = greeneryActiveItems(g);
    const byKey = new Map();
    for (const it of inst) { const arr = byKey.get(it.key) || []; arr.push(it); byKey.set(it.key, arr); }
    const items = [];
    let loadSum = 0;
    active.forEach(item => {
      const key = g.mode === 'single' ? 0 : g.items.indexOf(item);
      const arr = byKey.get(key) || [];
      const meta = GREENERY_META[item.type];
      // Coverage load uses the ACTUAL placed size: a leaf at sizeScale s covers s²x the
      // size-1 footprint, so counting the size-1 area would understate coverage.
      loadSum += arr.length * (meta ? meta.footprintSqIn * item.sizeScale * item.sizeScale : 0);
      items.push({ type: item.type, label: meta ? meta.label : item.type, count: arr.length, proportion: item.proportion });
    });
    const coveredLoad = panelIn2 > 0 ? loadSum / panelIn2 : 0;
    const estimatedCoverage = 1 - Math.exp(-coveredLoad * GREENERY_LOAD_K);
    // totalItems is the pieces actually placed; omitted counts those dropped because their
    // footprint could not fit inside the usable panel (reported honestly, never hidden).
    return { items, totalItems: inst.length, estimatedCoverage, omitted: _lastOmitted };
  }
  function greeneryOmitted() { return _lastOmitted; }

  // ---- colour distribution (patterns) --------------------------------------
  // Assign a colour index to every position. Returns { colorIndex, satisfied, unsatisfied }.
  // Colour proportions always come from counts() so switching patterns rearranges but
  // never changes how much of each colour is used.

  function assignRandom(quotas, rand) {
    const list = [];
    for (let ci = 0; ci < quotas.length; ci++) for (let k = 0; k < quotas[ci]; k++) list.push(ci);
    shuffle(list, rand);
    return { colorIndex: list, satisfied: true, unsatisfied: 0 };
  }

  function assignNonGrouping(positions, quotas, s, rand) {
    const n = positions.length, m = quotas.length;
    const neighbors = buildNeighbors(positions, bboxOf(positions));
    // groupingLimit sets the same-colour-neighbour cap: strict = never, balanced = allow
    // the occasional one, loose = permit small clusters. mixIntensity decides whether we
    // rank candidates by "fewest same-colour neighbours" (high/medium) or by "keep colour
    // proportions" (low). Cap 0 on a thinned hex lattice can be impossible to fully meet,
    // so we count and report those cases rather than claim success.
    const cap = { strict: 0, balanced: 1, loose: 2 }[s.groupingLimit] != null ? { strict: 0, balanced: 1, loose: 2 }[s.groupingLimit] : 1;
    const prefer = s.mixIntensity === 'low' ? 'remaining' : 'same';
    const remaining = quotas.slice(), result = new Array(n).fill(-1), assigned = new Array(n).fill(-1);
    const order = shuffle([...Array(n).keys()], rand); // random sweep spreads colours evenly
    let unsatisfied = 0;
    for (let oi = 0; oi < n; oi++) {
      const i = order[oi];
      const same = new Array(m).fill(0);
      const nbrs = neighbors[i];
      for (let a = 0; a < nbrs.length; a++) { const cj = assigned[nbrs[a]]; if (cj >= 0) same[cj]++; }
      let best = -1, bestSame = Infinity, bestRem = -1, relaxBest = -1, relaxSame = Infinity;
      for (let c = 0; c < m; c++) {
        if (remaining[c] <= 0) continue;
        const sn = same[c];
        if (sn < relaxSame) { relaxSame = sn; relaxBest = c; }
        if (sn <= cap) {
          const better = prefer === 'same'
            ? (sn < bestSame || (sn === bestSame && remaining[c] > bestRem))
            : (remaining[c] > bestRem || (remaining[c] === bestRem && sn < bestSame));
          if (better) { bestSame = sn; bestRem = remaining[c]; best = c; }
        }
      }
      let pick = best;
      if (pick < 0) { pick = relaxBest; if (pick >= 0) unsatisfied++; } // rule could not be met here
      if (pick < 0) { for (let c = 0; c < m; c++) if (remaining[c] > 0) { pick = c; break; } }
      result[i] = pick; assigned[i] = pick; remaining[pick]--;
    }
    return { colorIndex: result, satisfied: unsatisfied === 0, unsatisfied };
  }

  function pickSeeds(positions, K, rand) {
    const n = positions.length, seeds = [positions[Math.floor(rand() * n)]];
    const d2 = new Array(n).fill(Infinity);
    while (seeds.length < K) {
      const last = seeds[seeds.length - 1];
      let farIdx = 0, farD = -1;
      for (let i = 0; i < n; i++) {
        const dx = positions[i][0] - last[0], dy = positions[i][1] - last[1], d = dx * dx + dy * dy;
        if (d < d2[i]) d2[i] = d;
        if (d2[i] > farD) { farD = d2[i]; farIdx = i; }
      }
      seeds.push(positions[farIdx]);
    }
    return seeds;
  }

  function assignClustered(positions, quotas, s, rand) {
    const n = positions.length, m = quotas.length, bb = bboxOf(positions);
    const perColor = { small: 4, medium: 2, large: 1 }[s.clusterSize] != null ? { small: 4, medium: 2, large: 1 }[s.clusterSize] : 2;
    const K = Math.max(m, m * perColor);
    const seeds = pickSeeds(positions, K, rand);
    const total = quotas.reduce((a, b) => a + b, 0) || 1;
    const seedColor = [];
    for (let c = 0; c < m; c++) { const cnt = Math.max(1, Math.round(quotas[c] / total * K)); for (let k = 0; k < cnt; k++) seedColor.push(c); }
    while (seedColor.length < K) seedColor.push(0);
    seedColor.length = K;
    const noise = Math.hypot(bb.w, bb.h) * 0.05; // irregular (non-striped) cluster borders
    const result = new Array(n).fill(-1), remaining = quotas.slice();
    for (let i = 0; i < n; i++) {
      const x = positions[i][0], y = positions[i][1];
      let best = -1, bestD = Infinity;
      for (let k = 0; k < K; k++) {
        const ci = seedColor[k]; if (remaining[ci] <= 0) continue;
        const dx = x - seeds[k][0], dy = y - seeds[k][1];
        const d = dx * dx + dy * dy + (hash2(i, k) - 0.5) * noise;
        if (d < bestD) { bestD = d; best = ci; }
      }
      if (best < 0) { for (let c = 0; c < m; c++) if (remaining[c] > 0) { best = c; break; } }
      result[i] = best; remaining[best]--;
    }
    return { colorIndex: result, satisfied: true, unsatisfied: 0 };
  }

  function axisSorted(positions, s) {
    const bb = bboxOf(positions), axis = axisFn(s.patternDirection), n = positions.length;
    const t = new Array(n), idx = [...Array(n).keys()];
    for (let i = 0; i < n; i++) t[i] = axis(positions[i][0], positions[i][1], bb);
    idx.sort((a, b) => t[a] - t[b]);
    return { idx, t };
  }

  function assignGradient(positions, quotas, s, rand) {
    const n = positions.length, m = quotas.length, { idx, t } = axisSorted(positions, s);
    const result = new Array(n).fill(0), remaining = quotas.slice();
    for (let oi = 0; oi < n; oi++) {
      const i = idx[oi], ideal = t[i] * (m - 1);
      let best = -1, bestScore = Infinity;
      for (let c = 0; c < m; c++) { if (remaining[c] <= 0) continue; const sc = Math.abs(c - ideal) + rand() * 0.7; if (sc < bestScore) { bestScore = sc; best = c; } }
      if (best < 0) { for (let c = 0; c < m; c++) if (remaining[c] > 0) { best = c; break; } }
      result[i] = best; remaining[best]--;
    }
    return { colorIndex: result, satisfied: true, unsatisfied: 0 };
  }

  function assignStripes(positions, quotas, s, rand) {
    const n = positions.length, m = quotas.length, { idx } = axisSorted(positions, s);
    const result = new Array(n).fill(0), remaining = quotas.slice();
    const numBands = Math.max(m, Math.round(Math.sqrt(n) / 5)), bandLen = Math.max(1, Math.round(n / numBands));
    let band = 0, count = 0;
    for (let oi = 0; oi < n; oi++) {
      const i = idx[oi];
      let ci = band % m;
      if (remaining[ci] <= 0) { for (let k = 0; k < m; k++) { const c = (band + k) % m; if (remaining[c] > 0) { ci = c; break; } } }
      result[i] = ci; remaining[ci]--;
      if (++count >= bandLen) { count = 0; band++; }
    }
    return { colorIndex: result, satisfied: true, unsatisfied: 0 };
  }

  function assignColors(settings, positions) {
    const s = normalize(settings), n = positions.length, m = s.colors.length;
    if (n === 0 || m === 0) return { colorIndex: [], satisfied: true, unsatisfied: 0 };
    if (m === 1) return { colorIndex: new Array(n).fill(0), satisfied: true, unsatisfied: 0 };
    const quotas = counts(s, n).map(c => c.count); // exact proportions
    const rand = mulberry32(((s.seed >>> 0) ^ hashStr(s.pattern)) >>> 0);
    switch (s.pattern) {
      case 'nongrouping': return assignNonGrouping(positions, quotas, s, rand);
      case 'clustered': return assignClustered(positions, quotas, s, rand);
      case 'gradient': return assignGradient(positions, quotas, s, rand);
      case 'stripes': return assignStripes(positions, quotas, s, rand);
      default: return assignRandom(quotas, rand); // 'random'
    }
  }

  return { normalize, flowerProjection, projectionJitter, positions, counts, assignColors, innerArea, borderBands, borderPositions, greeneryBorderPositions, borderEffectivePalette, borderColorIndices, borderSpacingFactor, findBorderLayer, orderOptions, greeneryPositions, greeneryEstimate, greeneryActiveItems, greeneryOmitted, footprintFit, shadeHex, cleanHex, clamp, FLOWER_TYPES, SPECIES_PACK, PATTERNS, MIX_INTENSITIES, GROUPING_LIMITS, CLUSTER_SIZES, PATTERN_DIRS, PROJECTIONS, BORDER_COMPONENTS: LEGACY_BORDER_COMPONENTS, BORDER_LAYER_TYPES, BORDER_MAX_LAYERS, BORDER_ARRANGEMENTS, BORDER_COLOR_MODES, DESIGN_MODES, COMPOSITIONS, GREENERY_MODES, GREENERY_TYPES, GREENERY_CATEGORIES, GREENERY_LAYERS, GREENERY_DIRECTIONS, GREENERY_META, GREENERY_MAX_ITEMS, GREENERY_LOAD_K };
});
