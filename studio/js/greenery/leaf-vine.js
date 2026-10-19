/* Leaf vine — a fine, wiry trailing stem densely lined with small paired oval leaflets.
   Trailing/filler layer: a delicate green lace that softens edges and fills gaps. Leaves
   are optional (G.wantsLeaves()) so a bare wiry stem can be placed too. Geometry is
   normalised so the longest axis = 1; attachment is the base (start) of the vine. */
(function (root) {
  'use strict';
  const G = root.GreeneryCore;
  G.register({
    type: 'leaf-vine',
    label: 'Leaf vine',
    supportsLeaves: true,
    build(G) {
      const showLeaves = G.wantsLeaves();
      const rand = G.mulberry32(0x2545f491);
      // Fine wiry stem with a tighter S-drift than the ivy.
      const pts = [];
      const N = 24;
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        pts.push({
          x: Math.sin(t * 4.3) * 0.07,
          y: t,
          z: Math.sin(t * 3.0 + 0.6) * 0.04
        });
      }
      const stem = G.makeTube(pts, t => 0.010 * (1 - t * 0.5) + 0.004, 4);
      const parts = [stem];
      if (showLeaves) {
        // Small oval leaflet: rounded, lightly cupped, faint midrib.
        const leaflet = G.makeBlade({
          length: 0.13, halfWidth: 0.055,
          profile: u => Math.sin(Math.PI * Math.min(1, 0.14 + 0.72 * u)),
          cup: 0.01, bend: 0.015,
          midrib: 0.08,
          lengthSegs: 5, widthSegs: 6
        });
        const pairs = 16;
        for (let i = 1; i <= pairs; i++) {
          const t = i / (pairs + 0.5);
          const p = pts[Math.min(N, Math.round(t * N))];
          const sc = 0.9 - t * 0.45;
          for (const side of [1, -1]) {
            const c = G.cloneGeom(leaflet);
            G.applyMatrix(c, G.trs(p.x + side * 0.012, p.y, p.z, -side * (1.15 - t * 0.3), sc * (0.85 + rand() * 0.3)));
            parts.push(c);
          }
        }
        // One terminal leaflet closes the tip.
        const tipLeaf = G.cloneGeom(leaflet);
        G.applyMatrix(tipLeaf, G.trs(pts[N].x, pts[N].y, pts[N].z, 0.12, 0.45));
        parts.push(tipLeaf);
      }
      return G.mergeGeometries(parts);
    }
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
