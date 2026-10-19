/* Ivy / wisteria vine — a long, sinuous trailing stem carrying alternating pointed-ovate
   leaves and a few bare tendrils. Trailing layer: drapes down/across the panel. The
   leaves are optional (G.wantsLeaves()) so a bare wiry vine can be placed too.
   Geometry is normalised so the longest axis = 1; attachment is the base (start) of the
   vine, which runs up +Y. */
(function (root) {
  'use strict';
  const G = root.GreeneryCore;
  G.register({
    type: 'ivy-vine',
    label: 'Ivy / wisteria vine',
    supportsLeaves: true,
    build(G) {
      const showLeaves = G.wantsLeaves();
      const rand = G.mulberry32(0x51ed270b);
      // Sinuous main stem: a gentle S-drift in X with a little depth in Z.
      const pts = [];
      const N = 26;
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        pts.push({
          x: Math.sin(t * 3.1) * 0.10,
          y: t,
          z: Math.sin(t * 2.2 + 1.1) * 0.05
        });
      }
      const stem = G.makeTube(pts, t => 0.020 * (1 - t * 0.55) + 0.006, 6);
      const parts = [stem];
      // A few bare tendrils curl off the stem between the leaves.
      for (let k = 0; k < 4; k++) {
        const t = 0.18 + k * 0.22;
        const p = pts[Math.min(N, Math.round(t * N))];
        const side = k % 2 ? 1 : -1;
        const tend = [];
        for (let j = 0; j <= 6; j++) {
          const u = j / 6;
          tend.push({ x: p.x + side * u * 0.10, y: p.y + u * 0.04, z: p.z + Math.sin(u * 3.4) * 0.03 });
        }
        parts.push(G.makeTube(tend, u => 0.008 * (1 - u * 0.7) + 0.002, 4));
      }
      if (showLeaves) {
        // Pointed-ovate ivy leaf: broad near the base, tapering to a soft point.
        const leaf = G.makeBlade({
          length: 0.24, halfWidth: 0.115,
          profile: u => Math.pow(Math.sin(Math.PI * Math.min(1, 0.10 + 0.80 * u)), 0.62),
          cup: 0.02, bend: 0.03,
          midrib: 0.10, tipCurl: 0.05,
          lengthSegs: 7, widthSegs: 8
        });
        const pairs = 9;
        for (let i = 1; i <= pairs; i++) {
          const t = i / (pairs + 0.5);
          const p = pts[Math.min(N, Math.round(t * N))];
          const sc = 0.85 - t * 0.4;                    // leaves shrink toward the tip
          for (const side of [1, -1]) {
            const c = G.cloneGeom(leaf);
            // Fan each leaf outward and slightly forward so pairs spread along the stem.
            G.applyMatrix(c, G.trs(p.x + side * 0.02, p.y, p.z, -side * (1.05 - t * 0.25), sc * (0.9 + rand() * 0.25)));
            parts.push(c);
          }
        }
      }
      return G.mergeGeometries(parts);
    }
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
