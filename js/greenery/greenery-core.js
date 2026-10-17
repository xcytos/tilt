import * as THREE from 'three';

/* Flower Panel Studio — greenery geometry core.
   Procedural builders for leaves, tubes and merged multi-part models. Depends on the
   imported THREE (three r160). Exposes: GreeneryCore (ESM).
   Each model compiles to ONE merged BufferGeometry so the factory can draw it with a
   single InstancedMesh (many placed copies, one draw call). */
export const GreeneryCore = (function () {
  'use strict';
  const T = THREE;

  function mulberry32(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // White per-vertex colour so a vertexColors material renders white * instanceColor =
  // instanceColor. MeshStandardMaterial has no defaultAttributeValues, so a missing colour
  // attribute would render black. Required for every geometry used with vertexColors.
  function withWhiteColor(g) {
    const n = g.attributes.position.count;
    g.setAttribute('color', new T.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    return g;
  }

  // ---- leaf blade ------------------------------------------------------------
  // A flat, slightly cupped blade in the XY plane: base at (0,0,0), tip at (0,length,0),
  // width across X, cup/lift in Z. `profile(u)` shapes the half-width along the length.
  // `lobes` cut split-like notches (monstera); `holes` punch elliptical fenestrations.

  // Quality detail factor (1 = full tessellation). buildGeometries sets this around the
  // synchronous model.build() so every species' blades/tubes scale down together without
  // editing each species.
  let _detail = 1;

  function makeBlade(opts) {
    opts = opts || {};
    const L = Math.max(3, Math.round((opts.lengthSegs || 10) * _detail));
    const W = Math.max(3, Math.round((opts.widthSegs  || 10) * _detail));
    const length = opts.length != null ? opts.length : 1;
    const halfW = opts.halfWidth != null ? opts.halfWidth : 0.3;
    const profile = typeof opts.profile === 'function'
      ? opts.profile
      : (u => Math.sin(Math.PI * Math.min(1, 0.10 + 0.85 * u)));
    const lobes = opts.lobes || null;               // { count, depth }
    const holes = opts.holes || [];                 // [{u, v, ru, rv}]
    const cup = opts.cup != null ? opts.cup : 0.05; // edges lift in Z
    const bend = opts.bend != null ? opts.bend : 0.05; // tip lifts in Z
    const pos = [], uv = [], idx = [];
    const gi = (i, j) => i * (W + 1) + j;
    for (let i = 0; i <= L; i++) {
      const u = i / L, y = u * length;
      let w = halfW * profile(u);
      if (lobes) {
        const t = 0.5 - 0.5 * Math.cos(lobes.count * 2 * Math.PI * u);
        w *= (1 - (lobes.depth != null ? lobes.depth : 0.5) * t);
      }
      for (let j = 0; j <= W; j++) {
        const v = -1 + 2 * j / W;
        const x = v * w;
        const z = cup * (v * v) * w + bend * (u * u) * length;
        pos.push(x, y, z); uv.push((v + 1) / 2, u);
      }
    }
    for (let i = 0; i < L; i++) {
      for (let j = 0; j < W; j++) {
        const uc = (i + 0.5) / L, vc = -1 + 2 * (j + 0.5) / W;
        let inHole = false;
        for (let h = 0; h < holes.length; h++) {
          const ho = holes[h];
          const du = (uc - ho.u) / ho.ru, dv = (vc - ho.v) / ho.rv;
          if (du * du + dv * dv <= 1) { inHole = true; break; }
        }
        if (inHole) continue;
        const a = gi(i, j), b = gi(i + 1, j), c = gi(i + 1, j + 1), d = gi(i, j + 1);
        // CCW winding (a→c→b, a→d→c) so computeVertexNormals yields +Z normals; the old
        // a,b,c / a,c,d order was CW, giving every blade a −Z normal (dark under the app's
        // top-left light; only visible because the material is DoubleSide).
        idx.push(a, c, b, a, d, c);
      }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  // ---- tapered tube ----------------------------------------------------------
  // Sweeps a circle of varying radius along a polyline (stems, branches, rachises).
  // pts: [{x,y,z}]; radius: number or fn(t) with t in [0,1].
  function makeTube(pts, radius, radialSegs) {
    const R = Math.max(3, Math.round((radialSegs || 6) * _detail)), n = pts.length;
    if (n < 2) return makeBlade({ length: 0.001 });
    const pos = [], uv = [], idx = [];
    const rad = typeof radius === 'function' ? radius : (t => radius);
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const prev = pts[Math.max(0, i - 1)], next = pts[Math.min(n - 1, i + 1)];
      let tx = next.x - prev.x, ty = next.y - prev.y, tz = next.z - prev.z;
      const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      // frame: n1 = tangent x up, n2 = tangent x n1
      let n1x = ty * 0 - tz * 1, n1y = tz * 0 - tx * 0, n1z = tx * 1 - ty * 0; // tangent x (0,0,1)
      let l1 = Math.hypot(n1x, n1y, n1z);
      if (l1 < 1e-6) { n1x = 1; n1y = 0; n1z = 0; l1 = 1; }         // tangent parallel to Z
      n1x /= l1; n1y /= l1; n1z /= l1;
      let n2x = ty * n1z - tz * n1y, n2y = tz * n1x - tx * n1z, n2z = tx * n1y - ty * n1x;
      const l2 = Math.hypot(n2x, n2y, n2z) || 1; n2x /= l2; n2y /= l2; n2z /= l2;
      const r = rad(i / (n - 1));
      for (let k = 0; k < R; k++) {
        const a = k / R * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        pos.push(p.x + (n1x * ca + n2x * sa) * r, p.y + (n1y * ca + n2y * sa) * r, p.z + (n1z * ca + n2z * sa) * r);
        uv.push(k / R, i / (n - 1));
      }
    }
    for (let i = 0; i < n - 1; i++) {
      for (let k = 0; k < R; k++) {
        const k2 = (k + 1) % R;
        const a = i * R + k, b = i * R + k2, c = (i + 1) * R + k, d = (i + 1) * R + k2;
        idx.push(a, c, d, a, d, b);
      }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  // ---- geometry helpers used by model builders ------------------------------
  function mergeGeometries(list) {
    const parts = (list || []).filter(Boolean);
    if (!parts.length) return makeBlade({ length: 0.001 });
    if (parts.length === 1) return parts[0];
    const pos = [], norm = [], uv = [], idx = [];
    let offset = 0;
    for (const g of parts) {
      const p = g.attributes.position, nn = g.attributes.normal, u = g.attributes.uv;
      for (let i = 0; i < p.count; i++) pos.push(p.getX(i), p.getY(i), p.getZ(i));
      if (nn) for (let i = 0; i < p.count; i++) norm.push(nn.getX(i), nn.getY(i), nn.getZ(i));
      else for (let i = 0; i < p.count; i++) norm.push(0, 0, 1);
      if (u) for (let i = 0; i < p.count; i++) uv.push(u.getX(i), u.getY(i));
      else for (let i = 0; i < p.count; i++) uv.push(0, 0);
      const ix = g.index;
      if (ix) for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + offset);
      else for (let i = 0; i < p.count; i++) idx.push(i + offset);
      offset += p.count;
    }
    const out = new T.BufferGeometry();
    out.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new T.Float32BufferAttribute(norm, 3));
    out.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    out.setIndex(idx);
    return out;
  }
  function applyMatrix(g, m4) {
    const p = g.attributes.position, v = new T.Vector3();
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(m4); p.setXYZ(i, v.x, v.y, v.z); }
    p.needsUpdate = true;
    const nn = g.attributes.normal;
    if (nn) {
      const nm = new T.Matrix3().getNormalMatrix(m4);
      for (let i = 0; i < nn.count; i++) { v.fromBufferAttribute(nn, i).applyMatrix3(nm).normalize(); nn.setXYZ(i, v.x, v.y, v.z); }
      nn.needsUpdate = true;
    }
    return g;
  }
  const cloneGeom = g => g.clone();
  // Convenience transform builders for model code.
  function trs(x, y, z, rz, s) {
    const m = new T.Matrix4();
    const q = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), rz || 0);
    m.compose(new T.Vector3(x, y, z), q, new T.Vector3(s || 1, s || 1, s || 1));
    return m;
  }

  // Helpers passed to each model's build().
  const HELPERS = { makeBlade, makeTube, mergeGeometries, applyMatrix, cloneGeom, trs, mulberry32 };

  // ---- registry --------------------------------------------------------------
  const _registry = [];
  const _byType = Object.create(null);
  function register(model) {
    if (!model || !model.type) throw new Error('Greenery model requires a type');
    if (typeof model.build !== 'function') throw new Error('Greenery model "' + model.type + '" requires build()');
    if (_byType[model.type]) throw new Error('Duplicate greenery type: "' + model.type + '"');
    _registry.push(model); _byType[model.type] = model;
  }
  const get = type => _byType[type] || null;
  const list = () => _registry.map(m => ({ type: m.type, label: m.label || m.type }));

  // Scale the model so its longest in-plane axis (max of bbox width/height) is exactly 1.
  // This keeps meta.lengthIn honest: placement uses scaleW = lengthIn/12*worldScale, so the
  // geometry's long axis must be 1 for lengthIn to equal the real-world long-axis inches.
  // Scaling is about the origin, so the stem-base attachment point stays fixed.
  function normalizeLongAxis(g) {
    g.computeBoundingBox();
    const bb = g.boundingBox;
    const dx = bb.max.x - bb.min.x, dy = bb.max.y - bb.min.y;
    const m = Math.max(dx, dy);
    if (m > 1e-6 && Math.abs(m - 1) > 1e-3) {
      const s = 1 / m, p = g.attributes.position;
      for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * s, p.getY(i) * s, p.getZ(i) * s);
      p.needsUpdate = true;
      g.computeBoundingBox(); g.computeBoundingSphere();
    }
    return g;
  }

  // Build (once) the model's single merged geometry. Cached by the factory.
  function buildGeometries(model, detail) {
    _detail = detail != null ? detail : 1;
    let geometry;
    try { geometry = normalizeLongAxis(model.build(HELPERS)); }
    finally { _detail = 1; }
    withWhiteColor(geometry);
    geometry.userData.triangles = geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3;
    return { geometry };
  }
  function disposeGeometries(built) { if (built && built.geometry) built.geometry.dispose(); }
  function trianglesOf(built) { return built && built.geometry ? (built.geometry.userData.triangles || 0) : 0; }

  return {
    register, get, list, buildGeometries, disposeGeometries, trianglesOf,
    makeBlade, makeTube, mergeGeometries, applyMatrix, cloneGeom, trs, mulberry32, withWhiteColor
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
