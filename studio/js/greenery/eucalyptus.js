/* Eucalyptus spray — a visible central stem carrying pairs of rounded oval leaves.
   Volume-layer soft filler foliage; attachment at the base of the stem.
   Geometry is normalised so the longest axis = 1 (see greenery-core). */
(function (root) {
  'use strict';
  const G = root.GreeneryCore;
  G.register({
    type: 'eucalyptus',
    label: 'Eucalyptus spray',
    build(G) {
      // Main stem: gentle sine drift, tapering radius, base at origin to tip near +Y.
      const pts = [];
      const N = 12;
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        pts.push({ x: Math.sin(t * 1.7) * 0.05, y: t * 0.94, z: Math.sin(t * 1.2) * 0.03 });
      }
      const stem = G.makeTube(pts, t => 0.015 * (1 - t * 0.5) + 0.005, 6);
      // Distinct oval leaflet. Kept narrow (not the old fat pow(sin,0.5) blob) with a smooth
      // elliptic profile so opposite pairs stay separate instead of merging into one mass.
      const leaf = G.makeBlade({
        length: 0.20, halfWidth: 0.072,
        profile: u => Math.sin(Math.PI * Math.min(1, 0.14 + 0.72 * u)),
        cup: 0.015, bend: 0.025,
        midrib: 0.09, tipCurl: 0.03, // raised central vein + softly curling tip
        lengthSegs: 6, widthSegs: 7
      });
      const parts = [stem];
      const nodes = 7;
      for (let i = 1; i <= nodes; i++) {
        const t = i / (nodes + 1);
        const y = pts[Math.round(t * N)].y, x = pts[Math.round(t * N)].x, z = pts[Math.round(t * N)].z;
        const sc = 1 - t * 0.4;                    // leaves shrink gently toward the tip
        for (const side of [1, -1]) {
          const c = G.cloneGeom(leaf);
          // Fan each leaf outward (~68°) and slightly forward so the pair spreads sideways
          // along the stem rather than stacking into a blob.
          G.applyMatrix(c, G.trs(x + side * 0.02, y, z, -side * (1.18 - t * 0.2), sc));
          parts.push(c);
        }
      }
      // Terminal leaf closes the tip of the spray.
      const tip = G.cloneGeom(leaf);
      G.applyMatrix(tip, G.trs(pts[N].x, pts[N].y, pts[N].z, 0.15, 0.55));
      parts.push(tip);
      return G.mergeGeometries(parts);
    }
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
