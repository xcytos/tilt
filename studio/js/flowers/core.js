/* Flower Panel Studio — shared flower geometry core.
   Pure helpers for building procedural petals, domes and instanced rings.
   Depends on the global THREE (r128) loaded before this file.
   Exposes: window.FlowerCore */
(function (root) {
  'use strict';
  const T = root.THREE;
  if (!T) { throw new Error('FlowerCore requires THREE (r128) to be loaded first'); }

  // ---- deterministic RNG (mulberry32) -------------------------------------
  function mulberry32(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Width profiles: u in [0,1] base->tip, returns 0..1 width multiplier.
  const PROFILE = {
    round:   u => 0.5 + 0.5 * Math.sin(Math.PI * Math.min(1, 0.12 + 0.86 * u)),
    cupped:  u => 0.42 + 0.58 * Math.sin(Math.PI * Math.min(1, 0.10 + 0.80 * u)),
    narrow:  u => 0.60 + 0.40 * Math.sin(Math.PI * Math.min(1, 0.16 + 0.70 * u)),
    taper:   u => Math.pow(1 - u, 0.7) * Math.min(1, u * 6),
    ray:     u => Math.min(1, u * 5) * (0.72 + 0.28 * Math.sin(Math.PI * Math.min(1, 0.18 + 0.66 * u))),
    // Rounded spoon: narrow base, broad soft body, gently rounded tip (rose petal).
    spoon:   u => { const t = Math.min(1, Math.max(0, u));
                    const rise = Math.sin(Math.PI * Math.pow(t, 0.72));
                    const tip  = 1 - 0.4 * Math.pow(t, 5);
                    return Math.min(1, (0.42 + 0.58 * rise) * tip); }
  };
  const profileFn = name => (typeof name === 'function' ? name : (PROFILE[name] || PROFILE.round));

  // Per-vertex white colour so `vertexColors:true` materials multiply by white (not the
  // WebGL generic default of black). With instanceColor present the shader computes
  // vColor = white * instanceColor = instanceColor, so petals take their palette colour.
  // MeshStandardMaterial has no defaultAttributeValues, so a missing colour attribute
  // would otherwise render black. Required for every geometry used with vertexColors.
  function withWhiteColor(g) {
    const n = g.attributes.position.count;
    g.setAttribute('color', new T.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    return g;
  }

  // ---- parametric petal ---------------------------------------------------
  // Length grows along +X (0..base -> length..tip), width across +Y, cup/curl along +Z.
  // Petals are thin curved double-sided shells (surface curvature instead of thick volume).
  function makePetalGeometry(opts) {
    opts = opts || {};
    const length = opts.length != null ? opts.length : 0.3;
    const width  = opts.width  != null ? opts.width  : 0.12;   // max half-width
    const ls     = opts.lengthSegs || 6;
    const ws     = opts.widthSegs  || 4;
    const halfW  = profileFn(opts.profile);
    const cup     = opts.cup     != null ? opts.cup     : 0.02;  // centre lift at base
    const cupFade = opts.cupFade != null ? opts.cupFade : 0.65;  // cup loss toward tip
    const curl    = opts.curl    != null ? opts.curl    : 0.04;  // tip folds back (-Z)
    const curlPow = opts.curlPow || 1.7;
    const edgeCurl = opts.edgeCurl || 0;                          // edges lift near mid
    const edgePow = opts.edgePow != null ? opts.edgePow : 1;      // how sharply edge curl concentrates at the rim
    const ridge   = opts.ridge   || 0;                            // raised central spine along length
    const ridgePow = opts.ridgePow != null ? opts.ridgePow : 1;   // <1 = fuller/rounder central ridge
    const ridgeFade = opts.ridgeFade != null ? opts.ridgeFade : 1.4;
    const edgeWave = opts.edgeWave || 0;                          // subtle outline irregularity
    const edgeWaveFreq = opts.edgeWaveFreq || 4;
    const tipRound = opts.tipRound || 0;                          // pull tip corners back -> rounded top edge
    const tipStart = opts.tipStart != null ? opts.tipStart : 0.55;
    const ruffle   = opts.ruffle   || 0;                          // wavy edges (marigold)
    const ruffleFreq = opts.ruffleFreq || 5;
    const tipPinch = opts.tipPinch || 0;                          // pull tip to a point
    // Realism: a progressive twist about the petal's own length axis (radians over the
    // full length), so broad petals turn organically instead of fanning flat. Default 0.
    const twist = opts.twist || 0;

    const pos = new Array((ls + 1) * (ws + 1) * 3);
    let p = 0;
    for (let i = 0; i <= ls; i++) {
      const u = i / ls;
      let hw = halfW(u) * width;
      if (edgeWave) hw *= 1 + edgeWave * Math.sin(u * edgeWaveFreq * Math.PI);
      if (tipPinch) hw *= Math.max(0, 1 - tipPinch * Math.pow(u, 2.2));
      const bendZ = -curl * Math.pow(u, curlPow);
      const cupMid = cup * (1 - cupFade * u);
      const ridgeAmt = ridge * (1 - Math.pow(u, ridgeFade));
      const edgeAmt = edgeCurl * Math.sin(Math.PI * u);
      // Rounded top edge: near the tip, pull the corner vertices back along X so the
      // outline arcs (centre reaches further than the corners) instead of a flat polygonal cut.
      const tipPull = (tipRound && u > tipStart) ? tipRound * Math.pow((u - tipStart) / (1 - tipStart), 1.5) : 0;
      for (let j = 0; j <= ws; j++) {
        const v = (j / ws) * 2 - 1;
        const vv = v * v;
        let z = bendZ + cupMid * (1 - vv);
        if (ridgeAmt) z += ridgeAmt * Math.pow(1 - vv, ridgePow);  // rounded central spine
        if (edgeAmt) z += edgeAmt * Math.pow(vv, edgePow);        // thin rolled rim
        if (ruffle) z += ruffle * Math.sin(u * ruffleFreq * Math.PI) * (1 - Math.abs(v))
                       + ruffle * 0.6 * Math.sin(v * 4 + u * 7) * Math.abs(v);
        let y = v * hw;
        if (twist) {
          const th = twist * u, cs = Math.cos(th), sn = Math.sin(th);
          const y2 = y * cs - z * sn, z2 = y * sn + z * cs;
          y = y2; z = z2;
        }
        const x = u * length - (tipPull ? tipPull * length * vv : 0);
        pos[p++] = x;
        pos[p++] = y;
        pos[p++] = z;
      }
    }
    const idx = [];
    const row = ws + 1;
    for (let i = 0; i < ls; i++) for (let j = 0; j < ws; j++) {
      const a = i * row + j, b = (i + 1) * row + j;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    withWhiteColor(g);
    g.userData.triangles = idx.length / 3;
    return g;
  }

  // Flattened dome (squashed sphere cap) for receptacles / discs / centres.
  // Rotated so the pole faces +Z (toward the viewer), then squashed along Z.
  function makeDomeGeometry(radius, squash, widthSegs, heightSegs, thetaLength) {
    const g = new T.SphereGeometry(radius, widthSegs || 10, heightSegs || 6, 0, Math.PI * 2, 0, thetaLength || Math.PI * 0.62);
    g.rotateX(Math.PI / 2); // +Y pole -> +Z so the dome faces the viewer
    g.scale(1, 1, squash != null ? squash : 0.4);
    g.computeVertexNormals();
    withWhiteColor(g);
    g.userData.triangles = (g.index ? g.index.count : g.attributes.position.count) / 3;
    return g;
  }

  // Reused scratch objects (avoid per-petal allocation in hot loops).
  const _qz = new T.Quaternion(), _qy = new T.Quaternion(), _qr = new T.Quaternion(), _q = new T.Quaternion();
  const _axZ = new T.Vector3(0, 0, 1), _axY = new T.Vector3(0, 1, 0), _axX = new T.Vector3(1, 0, 0);
  const _pos = new T.Vector3(), _scl = new T.Vector3();
  const _WHITE = new T.Color(0xffffff);
  const _scratch = new T.Color();

  // Place one petal: base sits at `radius` along the ring at `angle`, tilted up by `tilt`.
  // quaternion = Rz(angle) * Ry(-tilt) [* Rx(roll)] so the petal points outward, leans toward
  // +Z, and can roll about its own length axis for natural edge orientation variation.
  function petalMatrix(out, cx, cy, cz, angle, tilt, radius, scale, roll) {
    _qz.setFromAxisAngle(_axZ, angle);
    _qy.setFromAxisAngle(_axY, -tilt);
    _q.copy(_qz).multiply(_qy);
    if (roll) { _qr.setFromAxisAngle(_axX, roll); _q.multiply(_qr); }
    _pos.set(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius, cz);
    _scl.set(scale, scale, scale);
    out.compose(_pos, _q, _scl);
  }

  // Shade a palette colour within its own family (darker via multiply, lighter via lerp to white).
  function shadedColor(base, layer) {
    const c = base.clone();
    const lift = layer.lift || 0;
    const shade = layer.shade != null ? layer.shade : 1;
    if (lift > 0) c.lerp(_WHITE, Math.min(0.9, lift));
    else if (shade !== 1) c.multiplyScalar(shade);
    return c;
  }

  // Build the instanced meshes for a species' petal rings across every flower.
  // ctx: { flowers:[{x,y,seed,colorIndex}], colors:[THREE.Color], S, petalMaterial, layers }
  function buildRings(ctx) {
    const { flowers, colors, S, petalMaterial, layers } = ctx;
    const meshes = [];
    let triangles = 0;
    const matrix = new T.Matrix4();
    for (let li = 0; li < layers.length; li++) {
      const layer = layers[li];
      const geo = layer._geometry;
      const per = layer.count;
      const total = flowers.length * per;
      if (total <= 0) continue;
      const im = new T.InstancedMesh(geo, petalMaterial, total);
      im.instanceMatrix.setUsage(T.StaticDrawUsage);
      im.frustumCulled = false;
      // A layer with fixedColor (the optional leaves ring) ignores the flower palette and
      // tints itself green; every other layer shades its colour from the palette.
      const layerColors = layer.fixedColor != null
        ? [new T.Color(layer.fixedColor)]
        : colors.map(c => shadedColor(c, layer));
      const radius = (layer.radius || 0) * S;
      const z = (layer.z || 0) * S;
      const baseTilt = layer.tilt || 0;
      const angleOff = layer.angleOffset || 0;
      const jitter = layer.jitter || 0, tiltJitter = layer.tiltJitter || 0, sizeVar = layer.sizeVar || 0;
      const zJitter = layer.zJitter || 0, rollJitter = layer.rollJitter || 0;
      let n = 0;
      for (let fi = 0; fi < flowers.length; fi++) {
        const f = flowers[fi];
        const col = layerColors[f.colorIndex] || layerColors[0];
        const rnd = mulberry32((f.seed * 2654435761 + li * 40503) >>> 0);
        const spin = f.spin || 0; // whole-flower Z spin (adds to every petal azimuth)
        for (let k = 0; k < per; k++) {
          const jr = jitter ? (rnd() - 0.5) * 2 * jitter : 0;
          const angle = k * Math.PI * 2 / per + angleOff + jr + spin;
          const tilt = baseTilt + (tiltJitter ? (rnd() - 0.5) * 2 * tiltJitter : 0);
          const scale = S * (1 + (sizeVar ? (rnd() - 0.5) * 2 * sizeVar : 0));
          const zp = z + (zJitter ? (rnd() - 0.5) * 2 * zJitter * S : 0);
          const roll = rollJitter ? (rnd() - 0.5) * 2 * rollJitter : 0;
          petalMatrix(matrix, f.x, f.y, zp, angle, tilt, radius, scale, roll);
          im.setMatrixAt(n, matrix);
          // Subtle per-petal lightness variation so each bloom reads as 3D (not flat plastic).
          // Kept small: geometry and lighting should carry most of the depth, not colour patchiness.
          _scratch.copy(col).offsetHSL(0, 0, (rnd() - 0.5) * 0.04);
          im.setColorAt(n, _scratch);
          n++;
        }
      }
      im.count = n;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      meshes.push(im);
      triangles += (geo.userData.triangles || 0) * total;
    }
    return { meshes, triangles };
  }

  // Build the optional centre (receptacle / disc / bud). Uses instanceColor when followPalette.
  function buildCenter(ctx) {
    const { flowers, colors, S, center } = ctx;
    if (!center || !center._geometry) return { meshes: [], triangles: 0 };
    const geo = center._geometry;
    const mat = new T.MeshStandardMaterial({
      color: center.followPalette ? 0xffffff : (center.color != null ? center.color : 0xd8b35d),
      roughness: center.roughness != null ? center.roughness : 0.8,
      metalness: 0,
      side: T.DoubleSide,
      vertexColors: true // instanceColor tints diffuse only under USE_COLOR
    });
    const im = new T.InstancedMesh(geo, mat, flowers.length);
    im.instanceMatrix.setUsage(T.StaticDrawUsage);
    im.frustumCulled = false;
    const matrix = new T.Matrix4();
    const idQ = new T.Quaternion();
    const z = (center.z || 0) * S;
    const scale = S * (center.scale != null ? center.scale : 1);
    let palette = null;
    if (center.followPalette) {
      palette = colors.map(c => shadedColor(c, { shade: center.shade != null ? center.shade : 0.82 }));
    }
    for (let fi = 0; fi < flowers.length; fi++) {
      const f = flowers[fi];
      _pos.set(f.x, f.y, z);
      _scl.set(scale, scale, scale * (center.squash != null ? center.squash : 1));
      matrix.compose(_pos, idQ, _scl);
      im.setMatrixAt(fi, matrix);
      if (palette) im.setColorAt(fi, palette[f.colorIndex] || palette[0]);
    }
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    return { meshes: [im], triangles: (geo.userData.triangles || 0) * flowers.length, material: mat };
  }

  // Optional green ring behind the head (calyx / sepals peeking out) shown when the
  // "Show leaves" checkbox is on. Species may override it with their own `leaves`; the
  // default suits any flower so the toggle works for every type.
  const DEFAULT_LEAVES = {
    count: 5, radius: 0.15, tilt: 0.5, z: -0.01, angleOffset: 0.3,
    jitter: 0.06, tiltJitter: 0.10, sizeVar: 0.12, zJitter: 0.008, rollJitter: 0.15,
    color: 0x4a7c3a,
    petal: {
      length: 0.26, width: 0.10, profile: 'narrow',
      ridge: 0.01, ridgePow: 0.6, edgeCurl: 0.03, curl: 0.05,
      tipRound: 0.30, tipStart: 0.50,
      lengthSegs: 5, widthSegs: 6
    }
  };

  // Pre-build a species' geometries (petal rings + centre) once; reused across rebuilds.
  // `leaves` appends the optional green leaves ring (see DEFAULT_LEAVES).
  function buildGeometries(species, leaves) {
    const layers = (species.layers || []).map(l => {
      const layer = Object.assign({}, l);
      layer._geometry = makePetalGeometry(l.petal || {});
      return layer;
    });
    if (leaves) {
      const L = Object.assign({}, DEFAULT_LEAVES, species.leaves || {});
      const leafLayer = Object.assign({}, L);
      leafLayer._geometry = makePetalGeometry(L.petal || {});
      leafLayer.fixedColor = L.color != null ? L.color : 0x4a7c3a;
      layers.push(leafLayer);
    }
    let center = null;
    if (species.center) {
      center = Object.assign({}, species.center);
      if (species.center.kind === 'dome') {
        center._geometry = makeDomeGeometry(species.center.radius || 0.08, species.center.squashZ || 0.4, 12, 7);
      } else if (species.center.kind === 'cone') {
        center._geometry = new T.ConeGeometry(species.center.radius || 0.04, species.center.height || 0.12, 12, 1);
        center._geometry.rotateX(Math.PI / 2); // point along +Z (toward viewer)
        center._geometry.computeVertexNormals();
        withWhiteColor(center._geometry);
        center._geometry.userData.triangles = (center._geometry.index ? center._geometry.index.count : center._geometry.attributes.position.count) / 3;
      } else {
        center._geometry = makeDomeGeometry(species.center.radius || 0.08, species.center.squashZ || 0.35, 12, 7);
      }
    }
    return { layers, center };
  }

  function disposeGeometries(built) {
    if (!built) return;
    built.layers.forEach(l => l._geometry && l._geometry.dispose());
    if (built.center && built.center._geometry) built.center._geometry.dispose();
  }

  function trianglesOf(built) {
    if (!built) return 0;
    let t = 0;
    built.layers.forEach(l => { t += (l._geometry.userData.triangles || 0) * l.count; });
    if (built.center && built.center._geometry) t += (built.center._geometry.userData.triangles || 0);
    return t;
  }

  function petalsPerFlower(species) {
    let n = 0;
    (species.layers || []).forEach(l => { n += l.count; });
    return n;
  }

  // ---- species registry ---------------------------------------------------
  const _registry = [];
  const _byType = Object.create(null);
  function register(species) {
    if (!species || !species.type) return;
    if (_byType[species.type]) { // replace on re-register (e.g. hot reload)
      const i = _registry.indexOf(_byType[species.type]);
      if (i >= 0) _registry.splice(i, 1);
    }
    _byType[species.type] = species;
    _registry.push(species);
  }
  const get = type => _byType[type] || null;
  const list = () => _registry.map(s => ({ type: s.type, label: s.label }));

  root.FlowerCore = {
    makePetalGeometry, makeDomeGeometry, petalMatrix, shadedColor,
    buildRings, buildCenter, buildGeometries, disposeGeometries,
    trianglesOf, petalsPerFlower, mulberry32, PROFILE,
    register, get, list
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
