/* Eucalyptus spray — several upright stems fanning from one base, each densely
    carrying opposite pairs of near-circular silver-dollar coin leaves held nearly
    horizontal, like the reference photo of a vase full of stalks.
    Volume-layer soft filler foliage; attachment at the base of the spray.
    Geometry is normalised so the longest axis = 1 (see greenery-core). */
(function (root) {
  'use strict';
  const G = root.GreeneryCore;
  G.register({
    type: 'eucalyptus',
    label: 'Eucalyptus spray',
    build(G) {
      const rand = G.mulberry32(0x2ea1e77c);
      const parts = [];
      // Coin leaf: nearly circular (0.15 long x 0.15 wide) with a broad rounded
      // profile so each leaf reads as a silver-dollar disc, not an oval.
      const leaf = G.makeBlade({
        length: 0.15, halfWidth: 0.075,
        profile: u => Math.pow(Math.sin(Math.PI * Math.min(1, 0.07 + 0.86 * u)), 0.4),
        cup: 0.012, bend: 0.02,
        midrib: 0.07, tipCurl: 0.02,
        lengthSegs: 6, widthSegs: 7
      });
      const stems = 6;
      for (let s = 0; s < stems; s++) {
        const lean = ((s / (stems - 1)) - 0.5) * 0.9;   // fan the spray ±~26°
        const hs = 0.78 + 0.22 * ((s * 53) % 7) / 7;     // per-stem height variety
        // Upright stem with a slight zigzag drift and gentle depth.
        const pts = [];
        const N = 12;
        for (let i = 0; i <= N; i++) {
          const t = i / N;
          pts.push({
            x: Math.sin(t * 1.6 + s) * 0.03 + lean * t * 0.5,
            y: t * 0.96 * hs,
            z: Math.sin(t * 1.3 + s * 0.7) * 0.025
          });
        }
        parts.push(G.makeTube(pts, t => 0.012 * (1 - t * 0.5) + 0.004, 6));
        const nodes = 10;
        for (let i = 1; i <= nodes; i++) {
          const t = i / (nodes + 1);
          const p = pts[Math.round(t * N)];
          const sc = (1 - t * 0.35) * hs;                // leaves shrink toward the tip
          for (const side of [1, -1]) {
            const c = G.cloneGeom(leaf);
            // Coin leaves stand nearly horizontal (±90°) with a small upward tilt.
            G.applyMatrix(c, G.trs(p.x + side * 0.018, p.y, p.z,
              -side * (1.5 - t * 0.15), sc * (0.9 + rand() * 0.2)));
            parts.push(c);
          }
        }
        // Terminal leaf closes the tip of each stem.
        const tip = G.cloneGeom(leaf);
        G.applyMatrix(tip, G.trs(pts[N].x, pts[N].y, pts[N].z, (rand() - 0.5) * 0.4, 0.5 * hs));
        parts.push(tip);
      }
      return G.mergeGeometries(parts);
    }
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
