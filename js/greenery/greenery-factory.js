import * as THREE from 'three';
import { GreeneryCore } from './greenery-core.js';
// Species self-register into GreeneryCore at module-evaluation time. The bundle
// concatenates them via ORDER (these imports are stripped); the native-ESM dev
// path needs them so `build()` can find a registered species.
import './monstera.js';
import './eucalyptus.js';
import './boston-fern.js';
import './grass.js';
import './ivy-vine.js';
import './ivy.js';
import './leaf-vine.js';

/* Flower Panel Studio — greenery factory (public API).
   Loads after greenery-core + model files. Builds cached, instanced greenery meshes.
   One InstancedMesh per model (single merged geometry) keeps draw calls minimal.
   Exposes: GreeneryEngine (ESM) */
export const GreeneryEngine = (function () {
  'use strict';
  const G = GreeneryCore;
  const T = THREE;

  let material = null;    // one shared material for all greenery (colour via instanceColor)
  let geoCache = new Map(); // "type@detail" -> built geometry (several types + quality levels)

  function getMaterial() {
    if (!material) {
      // Lambert, not Standard: leaves are matte, and the PBR per-fragment cost is a
      // large share of the multi-million-triangle flower panels on weak mobile GPUs.
      // Lambert keeps vertexColors + instanceColor tinting intact.
      material = new T.MeshLambertMaterial({
        color: 0xffffff, side: T.DoubleSide,
        vertexColors: true // required for InstancedMesh.instanceColor to tint diffuse
      });
    }
    return material;
  }

  function list() { return G.list(); }
  function has(type) { return !!G.get(type); }
  function get(type) { return G.get(type); }

  // Build (or reuse) the species' geometries at a quality detail level. Cached per
  // species+detail so several species and quality levels coexist without thrashing.
  // Vines that support a leaves toggle also key on it, so a bare stem and a leafy
  // stem are both cached and switching back is instant.
  function ensureGeometry(type, detail, leaves) {
    const s = G.get(type);
    if (!s) throw new Error('Unknown greenery type: "' + type + '"');
    const d = detail != null ? detail : 1;
    const keyed = !!s.supportsLeaves;
    const leaf = leaves !== false;
    const key = keyed ? type + '@' + d + '@' + (leaf ? 1 : 0) : type + '@' + d;
    let built = geoCache.get(key);
    if (built) return built;
    built = G.buildGeometries(s, d, keyed ? leaf : true);
    geoCache.set(key, built);
    return built;
  }

  function estimateTriangles(type, count, detail, leaves) {
    return G.trianglesOf(ensureGeometry(type, detail, leaves)) * Math.max(0, count | 0);
  }

  // Build instanced meshes. opts: { type, items:[{x,y,z,rot,scale,variant}], color,
  // colorVariation, detail, showLeaves }.
  // Throws for an unknown type — never silently falls back.
  // Local pre-rotation for sprays (opts.orientOutward + opts.orientAngle 0–90): maps
  // the model's long axis toward +Z (the panel's surface normal) while the stem-base
  // end stays at z~0, so the piece leans out of the wall instead of lying in its plane.
  // angle 0 = identity (flat), 90 = fully perpendicular. The union bbox across layers
  // is used because multi-layer models (wisteria raceme + foliage band) share one
  // placement scale but occupy different regions — the base end must be decided on the
  // whole model, not one layer.
  function orientQuaternion(specs, angleRad) {
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const spec of specs) {
      const g = spec.geo;
      if (!g) continue;
      g.computeBoundingBox();
      const b = g.boundingBox;
      if (!b) continue;
      if (b.min.x < x0) x0 = b.min.x;
      if (b.max.x > x1) x1 = b.max.x;
      if (b.min.y < y0) y0 = b.min.y;
      if (b.max.y > y1) y1 = b.max.y;
    }
    if (x0 > x1 || y0 > y1) return null;
    const a = Math.max(0, Math.min(Math.PI / 2, angleRad));
    const q = new T.Quaternion();
    if (y1 - y0 >= x1 - x0) {
      // Long axis = Y. Base is the end nearer the origin; the tip leans to +Z:
      // Rx(+a) sends +y toward +z, Rx(-a) sends -y toward +z.
      const theta = (Math.abs(y0) < Math.abs(y1) ? 1 : -1) * a;
      q.setFromAxisAngle(new T.Vector3(1, 0, 0), theta);
    } else {
      // Long axis = X. Ry(-a) sends +x toward +z, Ry(+a) sends -x toward +z.
      const theta = (Math.abs(x0) < Math.abs(x1) ? -1 : 1) * a;
      q.setFromAxisAngle(new T.Vector3(0, 1, 0), theta);
    }
    return q;
  }

  function build(opts) {
    const type = opts && opts.type;
    const s = G.get(type);
    if (!s) throw new Error('Unknown greenery type: "' + type + '"');
    const items = (opts && opts.items) || [];
    if (!items.length) return { meshes: [], triangles: 0, instances: 0 };
    const baseHex = (opts && opts.color) || '#4a7c3f';
    const colorVariation = (opts && opts.colorVariation != null) ? opts.colorVariation : 0.3;
    const built = ensureGeometry(type, (opts && opts.detail), (opts && opts.showLeaves));
    const mat = getMaterial();
    // One InstancedMesh per geometry layer: a single-geometry species (usual) yields
    // one mesh; a multi-colour species (ivy-wisteria) yields one per layer. A layer
    // with `fixed` pins its own colour (foliage band = green); other layers take the
    // per-item colour (it.color) falling back to the call's base colour.
    const specs = (built.layers || [{ geometry: built.geometry }])
      .filter(l => l && l.geometry)
      .map(l => ({ geo: l.geometry, fixed: l.fixed || null }));
    const meshes = [];
    let triangles = 0;
    const m = new T.Matrix4(), q = new T.Quaternion();
    const ax = new T.Vector3(0, 0, 1), pos = new T.Vector3(), scl = new T.Vector3(), c = new T.Color();
    // opts.orientAngle (degrees, default 90): lean of orientOutward species out of the
    // panel plane. 0 disables the pre-rotation entirely (flat pose).
    const orientAngle = (opts && opts.orientAngle != null) ? Number(opts.orientAngle) : 90;
    const orientQ = opts.orientOutward && Number.isFinite(orientAngle) && orientAngle > 0
      ? orientQuaternion(specs, orientAngle * Math.PI / 180)
      : null;
    for (const spec of specs) {
      const im = new T.InstancedMesh(spec.geo, mat, items.length);
      im.instanceMatrix.setUsage(T.StaticDrawUsage);
      im.frustumCulled = false;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        pos.set(it.x || 0, it.y || 0, it.z || 0);
        q.setFromAxisAngle(ax, it.rot || 0);
        if (orientQ) q.multiply(orientQ);          // local reorient first, then panel roll
        const sc = it.scale || 1; scl.set(sc, sc, sc);
        m.compose(pos, q, scl);
        im.setMatrixAt(i, m);
        const variant = it.variant != null ? it.variant : 0.5;
        c.set(spec.fixed || it.color || baseHex)
          .offsetHSL(0, 0, (variant - 0.5) * colorVariation * 0.6);
        im.setColorAt(i, c);
      }
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      meshes.push(im);
      triangles += (spec.geo.userData.triangles || 0) * items.length;
    }
    return { meshes, triangles, instances: items.length };
  }

  // Release per-build meshes: frees instance GPU buffers, keeps shared material + cached geometry.
  function release(meshes) {
    if (!meshes) return;
    for (let i = 0; i < meshes.length; i++) {
      const m = meshes[i];
      if (!m) continue;
      if (m.parent) m.parent.remove(m);
      if (m.dispose) m.dispose();
    }
  }

  function dispose() {
    if (geoCache) { geoCache.forEach(built => G.disposeGeometries(built)); geoCache.clear(); }
    if (material) { material.dispose(); material = null; }
  }

  return {
    list, has, get, estimateTriangles, build, release, dispose, ensureGeometry
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
