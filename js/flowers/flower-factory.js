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
  let geoCache = new Map();   // type -> built geometries (multiple species can coexist)

  function getPetalMaterial() {
    if (!petalMaterial) {
      petalMaterial = new T.MeshStandardMaterial({
        color: 0xffffff, roughness: 0.72, metalness: 0, side: T.DoubleSide,
        vertexColors: true // required for InstancedMesh.instanceColor to tint diffuse
      });
    }
    return petalMaterial;
  }

  function list() { return C.list(); }
  function has(type) { return !!C.get(type); }
  function get(type) { return C.get(type); }
  function petalsPerFlower(type) { const s = C.get(type); return s ? C.petalsPerFlower(s) : 0; }

  // Build (or reuse) the species' geometries. Cached per species so several species
  // (main panel + flower borders) can be built at once without thrashing.
  function ensureGeometry(type) {
    const s = C.get(type);
    if (!s) throw new Error('Unknown flower type: "' + type + '"');
    let built = geoCache.get(type);
    if (built) return built;
    built = C.buildGeometries(s);
    geoCache.set(type, built);
    return built;
  }

  // Estimated triangles to render `flowerCount` flowers of `type`.
  function estimateTriangles(type, flowerCount) {
    const built = ensureGeometry(type);
    return C.trianglesOf(built) * Math.max(0, flowerCount | 0);
  }

  // Build instanced meshes. opts: { type, flowers:[{x,y,seed,colorIndex}], colors:[THREE.Color], S }
  // Throws for an unknown species — never silently falls back.
  function build(opts) {
    const type = opts && opts.type;
    const s = C.get(type);
    if (!s) throw new Error('Unknown flower type: "' + type + '"');
    const flowers = (opts && opts.flowers) || [];
    const colors = (opts && opts.colors) || [];
    const S = (opts && opts.S) || 1;
    const built = ensureGeometry(type);
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
