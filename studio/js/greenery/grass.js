/* Grass tuft — a dense clump of slim, tapering blades fanning out from a compact base,
   each arching gently toward the viewer. Filler layer: low, soft, fills gaps between
   statement foliage. Geometry is normalised so the longest axis = 1 (see greenery-core);
   attachment is the base of the clump (origin). */
(function (root) {
  'use strict';
  const G = root.GreeneryCore;
  G.register({
    type: 'grass',
    label: 'Grass tuft',
    build(G) {
      const rand = G.mulberry32(0x9e3779b9);
      const parts = [];
      const N = 44;
      for (let i = 0; i < N; i++) {
        const angle = (rand() - 0.5) * Math.PI * 1.05;   // fan the tuft ±~95°
        const height = 0.5 + rand() * 0.5;               // blades 0.5..1.0 tall
        // Taper to a fine point: full near the base, pinched at the tip.
        const blade = G.makeBlade({
          length: height,
          halfWidth: 0.010 + rand() * 0.012,
          profile: u => Math.sin(Math.PI * Math.min(1, 0.06 + 0.88 * u)) * (1 - 0.82 * u * u),
          cup: 0.003,
          bend: 0.10 + rand() * 0.22,                    // arch the tip toward the viewer
          midrib: 0.15,                                  // faint central vein
          lengthSegs: 8, widthSegs: 3
        });
        // Fan outward from a tight base; slight scale variety keeps the clump organic.
        const r = 0.045 * rand();
        G.applyMatrix(blade, G.trs(
          Math.cos(angle) * r, 0, Math.sin(angle) * r * 0.5,
          angle * (0.55 + rand() * 0.4), 0.72 + rand() * 0.4));
        parts.push(blade);
      }
      return G.mergeGeometries(parts);
    }
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
