import * as THREE from 'three';
import { FlowerCore } from './core.js';
// Species self-register into FlowerCore at module-evaluation time. The bundle
// concatenates them via ORDER (these imports are stripped); the native-ESM dev
// path needs them so `build()` can find a registered species.
import './rose.js';
import './marigold.js';
import './chrysanthemum.js';
import './dahlia.js';
import './gerbera.js';

/* Flower Panel Studio — flower factory (public API).
   Loads after core + species files. Builds cached, instanced flower meshes.
   Exposes: FlowerEngine (ESM) */
export const FlowerEngine = (function () {
  'use strict';
  const C = FlowerCore;
  const T = THREE;

  let petalMaterial = null;   // one shared material for all petals (colours via instanceColor)
  let geoCache = new Map();   // "type@detail" -> built geometries (several species + quality levels can coexist)

  function getPetalMaterial() {
    if (!petalMaterial) {
      // Lambert, not Standard: flowers are matte petals lit by the scene, and the
      // full-PBR per-fragment cost of Standard is what stalls weak mobile GPUs at
      // millions of petals. Lambert keeps vertexColors + instanceColor tinting.
      petalMaterial = new T.MeshLambertMaterial({
        color: 0xffffff, side: T.DoubleSide,
        vertexColors: true // required for InstancedMesh.instanceColor to tint diffuse
      });
    }
    return petalMaterial;
  }

  function list() { return C.list(); }
  function has(type) { return !!C.get(type); }
  function get(type) { return C.get(type); }
  function petalsPerFlower(type) { const s = C.get(type); return s ? C.petalsPerFlower(s) : 0; }

  // Build (or reuse) the species' geometries at a quality detail level. Cached per
  // species+detail so several species and quality levels can be built without thrashing.
  function ensureGeometry(type, detail) {
    const s = C.get(type);
    if (!s) throw new Error('Unknown flower type: "' + type + '"');
    const d = detail != null ? detail : 1;
    const key = type + '@' + d;
    let built = geoCache.get(key);
    if (built) return built;
    built = C.buildGeometries(s, d);
    geoCache.set(key, built);
    return built;
  }

  // Estimated triangles to render `flowerCount` flowers of `type`.
  function estimateTriangles(type, flowerCount, detail) {
    const built = ensureGeometry(type, detail);
    return C.trianglesOf(built) * Math.max(0, flowerCount | 0);
  }

  // Build instanced meshes. opts: { type, flowers:[{x,y,seed,colorIndex}], colors:[THREE.Color], S, detail }
  // Throws for an unknown species — never silently falls back.
  function build(opts) {
    const type = opts && opts.type;
    const s = C.get(type);
    if (!s) throw new Error('Unknown flower type: "' + type + '"');
    const flowers = (opts && opts.flowers) || [];
    const colors = (opts && opts.colors) || [];
    const S = (opts && opts.S) || 1;
    const detail = (opts && opts.detail) != null ? opts.detail : 1;
    const built = ensureGeometry(type, detail);
    const pm = getPetalMaterial();
    const rings = C.buildRings({ flowers, colors, S, petalMaterial: pm, layers: built.layers });
    const centre = built.center
      ? C.buildCenter({ flowers, colors, S, center: built.center })
      : { meshes: [], triangles: 0 };
    return {
      meshes: rings.meshes.concat(centre.meshes),
      triangles: rings.triangles + centre.triangles,
      petalsPerFlower: C.petalsPerFlower(s),
      perFlowerTriangles: C.trianglesOf(built)
    };
  }

  // Release per-build meshes: frees instance GPU buffers and per-build (centre) materials,
  // but keeps the shared petal material and cached geometry.
  function release(meshes) {
    if (!meshes) return;
    for (let i = 0; i < meshes.length; i++) {
      const m = meshes[i];
      if (!m) continue;
      if (m.parent) m.parent.remove(m);
      if (m.material && m.material !== petalMaterial) {
        if (Array.isArray(m.material)) m.material.forEach(mm => mm && mm.dispose && mm.dispose());
        else if (m.material.dispose) m.material.dispose();
      }
      if (m.dispose) m.dispose();
    }
  }

  // Full teardown (frees all cached geometry + shared material). Not needed for normal rebuilds.
  function dispose() {
    if (geoCache) { geoCache.forEach(built => C.disposeGeometries(built)); geoCache.clear(); }
    if (petalMaterial) { petalMaterial.dispose(); petalMaterial = null; }
  }

  return {
    list, has, get, petalsPerFlower, estimateTriangles,
    build, release, dispose, ensureGeometry
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
