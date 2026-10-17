/* Flower Panel Studio — greenery factory (public API).
   Loads after greenery-core + model files. Builds cached, instanced greenery meshes.
   One InstancedMesh per model (single merged geometry) keeps draw calls minimal.
   Exposes: window.GreeneryEngine */
(function (root) {
  'use strict';
  const G = root.GreeneryCore;
  const T = root.THREE;
  if (!G) { throw new Error('GreeneryEngine requires GreeneryCore'); }

  let material = null;    // one shared material for all greenery (colour via instanceColor)
  let geoCache = new Map(); // type -> built geometry (several types can coexist)

  function getMaterial() {
    if (!material) {
      material = new T.MeshStandardMaterial({
        color: 0xffffff, roughness: 0.66, metalness: 0, side: T.DoubleSide,
        vertexColors: true // required for InstancedMesh.instanceColor to tint diffuse
      });
    }
    return material;
  }

  function list() { return G.list(); }
  function has(type) { return !!G.get(type); }
  function get(type) { return G.get(type); }

  function ensureGeometry(type) {
    const s = G.get(type);
    if (!s) throw new Error('Unknown greenery type: "' + type + '"');
    let built = geoCache.get(type);
    if (built) return built;
    built = G.buildGeometries(s);
    geoCache.set(type, built);
    return built;
  }

  function estimateTriangles(type, count) {
    return G.trianglesOf(ensureGeometry(type)) * Math.max(0, count | 0);
  }

  // Build instanced meshes. opts: { type, items:[{x,y,z,rot,scale,variant}], color, colorVariation }.
  // Throws for an unknown type — never silently falls back.
  function build(opts) {
    const type = opts && opts.type;
    const s = G.get(type);
    if (!s) throw new Error('Unknown greenery type: "' + type + '"');
    const items = (opts && opts.items) || [];
    if (!items.length) return { meshes: [], triangles: 0, instances: 0 };
    const baseHex = (opts && opts.color) || '#4a7c3f';
    const colorVariation = (opts && opts.colorVariation != null) ? opts.colorVariation : 0.3;
    const built = ensureGeometry(type);
    const geo = built.geometry;
    const mat = getMaterial();
    const im = new T.InstancedMesh(geo, mat, items.length);
    im.instanceMatrix.setUsage(T.StaticDrawUsage);
    im.frustumCulled = false;
    const base = new T.Color(baseHex).convertSRGBToLinear();
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

  root.GreeneryEngine = {
    list, has, get, estimateTriangles, build, release, dispose, ensureGeometry
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
