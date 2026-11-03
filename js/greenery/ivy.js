import * as THREE from 'three';
import { GreeneryCore } from './greenery-core.js';

/* Ivy vine — a dense trailing vine lined with classic 5-lobed palmate ivy leaves,
   matching the reference "Ivy Vine Only" wall panel: leaves pack closely along a
   wiry stem that hangs from its stem-base attachment, each leaf on a short petiole
   angled outward so the blade lies near the panel face. Leaves are optional
   (G.wantsLeaves()) so a bare wiry stem can be placed too. Geometry is normalised
   so the longest axis = 1; attachment is the base (top) of the vine. */
(function () {
  'use strict';
  const G = GreeneryCore;
  const T = THREE;

  // One 5-lobed ivy leaf outline (THREE.Shape): palmate envelope with lobes at the
  // tip and ±72°/±144°, sinuses between, a notch at the petiole (bottom) and the two
  // basal lobes stretched slightly down. Petiole attaches near (0,0); tip points +Y.
  function ivyLeaf() {
    const R = 0.125;
    const N = 60;
    const pts = [];
    for (let i = 0; i <= N; i++) {
      const th = -Math.PI + (i / N) * Math.PI * 2;
      const lobe = Math.pow(Math.abs(Math.cos(2.5 * th)), 0.62);
      let r = R * (0.50 + 0.50 * lobe);
      const down = Math.max(0, -Math.cos(th));
      r *= 1 + 0.14 * down * down;       // ivy's basal lobes reach a little lower
      pts.push(new T.Vector2(Math.sin(th) * r * 0.92, Math.cos(th) * r + 0.06));
    }
    const geo = new T.ShapeGeometry(new T.Shape(pts));
    // Gentle cup across the blade + lift toward the tip.
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i) - 0.06;
      const u = Math.max(0, y) / R;
      pos.setZ(i, 0.010 * (x / (R * 0.92)) * (x / (R * 0.92)) + 0.008 * u * u);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    return geo;
  }

  G.register({
    type: 'ivy',
    label: 'Ivy vine',
    supportsLeaves: true,
    build(G) {
      const showLeaves = G.wantsLeaves();
      const rand = G.mulberry32(0x1f47e21);
      // Wiry stem hanging down (y: 0 -> -1) with a gentle S-drift in x and z.
      const pts = [];
      const N = 28;
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        pts.push({
          x: Math.sin(t * 3.6 + 0.4) * 0.045,
          y: -t,
          z: Math.sin(t * 2.8 + 1.2) * 0.015
        });
      }
      const stem = G.makeTube(pts, t => 0.010 * (1 - t * 0.45) + 0.004, 4);
      const parts = [stem];
      if (showLeaves) {
        const leaf = ivyLeaf();
        const nodes = 34;
        for (let i = 1; i <= nodes; i++) {
          const t = i / (nodes + 0.7);
          const p = pts[Math.min(N, Math.round(t * N))];
          const side = (i % 2) ? 1 : -1;
          const sc = (1 - t * 0.32) * (0.85 + rand() * 0.3);
          const bx = p.x + side * 0.055, by = p.y - 0.008, bz = p.z + (rand() - 0.5) * 0.012;
          // Short petiole from the stem node out to the leaf's notch.
          parts.push(G.makeTube([
            { x: p.x, y: p.y, z: p.z },
            { x: (p.x + bx) / 2, y: (p.y + by) / 2 - 0.006, z: (p.z + bz) / 2 },
            { x: bx, y: by, z: bz }
          ], 0.005, 3));
          const c = G.cloneGeom(leaf);
          // Random out-of-plane tilt so blades catch light individually (the reference
          // wall reads as layered leaves, not one flat green mass).
          G.applyMatrix(c, new T.Matrix4().makeRotationX((rand() - 0.5) * 0.7));
          G.applyMatrix(c, G.trs(bx, by, bz, -side * (1.15 + (rand() - 0.5) * 0.4), sc));
          parts.push(c);
        }
        // One terminal leaf closes the tip.
        const tipLeaf = G.cloneGeom(leaf);
        G.applyMatrix(tipLeaf, new T.Matrix4().makeRotationX((rand() - 0.5) * 0.7));
        G.applyMatrix(tipLeaf, G.trs(pts[N].x, pts[N].y - 0.01, pts[N].z, (rand() - 0.5) * 0.3, 0.62));
        parts.push(tipLeaf);
      }
      return G.mergeGeometries(parts);
    }
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
