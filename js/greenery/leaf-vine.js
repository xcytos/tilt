import * as THREE from 'three';
import { GreeneryCore } from './greenery-core.js';

/* Leaf vine — a fine, wiry vine running horizontally (attached at its base on the
   left) lined with alternate heart-shaped leaves on short petioles, matching the
   reference vine (single leaves alternating side to side, not opposite pairs).
   Trailing/filler layer: softens edges and fills gaps. Leaves are optional
   (G.wantsLeaves()) so a bare wiry stem can be placed too. Geometry is normalised so
   the longest axis = 1; attachment is the base (start) of the vine. */
(function () {
  'use strict';
  const G = GreeneryCore;
  const T = THREE;

  // One heart-shaped leaf outline (THREE.Shape): ovate envelope with a cordate base —
  // basal lobes hanging below a rounded cleft where the petiole attaches.
  function heartLeaf() {
    const L = 0.16, halfW = 0.078, D = 0.10;  // cleft depth 10% of the leaf
    const env = u => Math.sin(Math.PI * Math.pow(0.12 + 0.88 * Math.min(1, Math.max(0, u)), 0.9));
    const mask = u => { const m = Math.max(0, 1 - u / 0.18); return m * m; };
    const N = 44;
    const pts = [];
    // Right side up (CCW), left side down — winding makes front faces point +Z.
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      pts.push(new T.Vector2(halfW * env(u), (u - D * mask(u)) * L));
    }
    for (let i = N - 1; i >= 0; i--) {
      const u = i / N;
      pts.push(new T.Vector2(-halfW * env(u), (u - D * mask(u)) * L));
    }
    // Rounded basal cleft joining the two lobes through the petiole point (0,0).
    const hw0 = halfW * env(0);
    for (let k = 1; k < 10; k++) {
      const s = k / 10;
      pts.push(new T.Vector2(-hw0 + 2 * hw0 * s, (-D + D * Math.sin(Math.PI * s)) * L));
    }
    const geo = new T.ShapeGeometry(new T.Shape(pts));
    // Gentle cup and tip lift (leaf is small; outline vertices carry the curl).
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      const u = Math.max(0, y) / L;
      pos.setZ(i, 0.010 * (x / halfW) * (x / halfW) + 0.012 * u * u);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    return geo;
  }

  G.register({
    type: 'leaf-vine',
    label: 'Leaf vine',
    supportsLeaves: true,
    build(G) {
      const showLeaves = G.wantsLeaves();
      const rand = G.mulberry32(0x2545f491);
      // Near-straight wiry stem with only a gentle drift (reference vine runs fairly
      // straight between leaves).
      const pts = [];
      const N = 24;
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        pts.push({
          x: Math.sin(t * 4.3) * 0.035,
          y: t,
          z: Math.sin(t * 3.0 + 0.6) * 0.04
        });
      }
      const stem = G.makeTube(pts, t => 0.010 * (1 - t * 0.5) + 0.004, 4);
      const parts = [stem];
      if (showLeaves) {
        const leaf = heartLeaf();
        const nodes = 19;
        for (let i = 1; i <= nodes; i++) {
          const t = i / (nodes + 0.6);
          const p = pts[Math.min(N, Math.round(t * N))];
          const side = (i % 2) ? 1 : -1;      // alternate side to side
          const sc = (1 - t * 0.38) * (0.85 + rand() * 0.3);
          const bx = p.x + side * 0.03, by = p.y + 0.012, bz = p.z + (rand() - 0.5) * 0.02;
          // Short petiole from the stem node out to the leaf's cleft.
          parts.push(G.makeTube([
            { x: p.x, y: p.y, z: p.z },
            { x: (p.x + bx) / 2, y: (p.y + by) / 2 + 0.008, z: (p.z + bz) / 2 },
            { x: bx, y: by, z: bz }
          ], 0.006, 3));
          const c = G.cloneGeom(leaf);
          G.applyMatrix(c, G.trs(bx, by, bz, -side * (0.95 + (rand() - 0.5) * 0.35), sc));
          parts.push(c);
        }
        // One terminal leaf closes the tip.
        const tipLeaf = G.cloneGeom(leaf);
        G.applyMatrix(tipLeaf, G.trs(pts[N].x, pts[N].y + 0.01, pts[N].z, (rand() - 0.5) * 0.3, 0.6));
        parts.push(tipLeaf);
      }
      // Lay the vine down: the stem runs +X from its attachment and the leaves, which
      // alternated sideways from the upright stem, end up alternating above and below
      // the vine — the usable panel position.
      const merged = G.mergeGeometries(parts);
      G.applyMatrix(merged, G.trs(0, 0, 0, -Math.PI / 2, 1));
      return merged;
    }
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
