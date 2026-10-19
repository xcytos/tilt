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
  function build(opts) {
    const type = opts && opts.type;
    const s = G.get(type);
    if (!s) throw new Error('Unknown greenery type: "' + type + '"');
    const items = (opts && opts.items) || [];
    if (!items.length) return { meshes: [], triangles: 0, instances: 0 };
    const baseHex = (opts && opts.color) || '#4a7c3f';
    const colorVariation = (opts && opts.colorVariation != null) ? opts.colorVariation : 0.3;
    const built = ensureGeometry(type, (opts && opts.detail), (opts && opts.showLeaves));
    const geo = built.geometry;
    const mat = getMaterial();
    const im = new T.InstancedMesh(geo, mat, items.length);
    im.instanceMatrix.setUsage(T.StaticDrawUsage);
    im.frustumCulled = false;
    const base = new T.Color(baseHex);
    const m = new T.Matrix4(), q = new T.Quaternion();
    const ax = new T.Vector3(0, 0, 1), pos = new T.Vector3(), scl = new T.Vector3(), c = new T.Color();
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      pos.set(it.x || 0, it.y || 0, it.z || 0);
      q.setFromAxisAngle(ax, it.rot || 0);
      const sc = it.scale || 1; scl.set(sc, sc, sc);
      m.compose(pos, q, scl);
      im.setMatrixAt(i, m);
      const variant = it.variant != null ? it.variant : 0.5;
      c.copy(base).offsetHSL(0, 0, (variant - 0.5) * colorVariation * 0.6);
      im.setColorAt(i, c);
    }
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    return { meshes: [im], triangles: (geo.userData.triangles || 0) * items.length, instances: items.length };
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
