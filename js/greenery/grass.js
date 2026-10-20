import { GreeneryCore } from './greenery-core.js';

/* Grass tuft — artificial-turf style: a dense carpet of fine, mostly-vertical
    blades with near-uniform height and only a slight lean, like the reference turf
    close-up. Filler layer: low, soft, fills gaps between statement foliage.
    Geometry is normalised so the longest axis = 1 (see greenery-core);
    attachment is the base of the clump (origin). */
(function () {
  'use strict';
  const G = GreeneryCore;
  G.register({
    type: 'grass',
    label: 'Grass tuft',
    build(G) {
      const rand = G.mulberry32(0x9e3779b9);
      const parts = [];
      const N = 100;                                    // turf density (reference: dense carpet)
      for (let i = 0; i < N; i++) {
        const angle = rand() * Math.PI * 2;             // spread blades across the tuft disc
        const height = 0.65 + rand() * 0.35;            // near-uniform turf height
        // Taper to a fine point: full near the base, pinched at the tip.
        const blade = G.makeBlade({
          length: height,
          halfWidth: 0.008 + rand() * 0.010,            // fine blades
          profile: u => Math.sin(Math.PI * Math.min(1, 0.06 + 0.88 * u)) * (1 - 0.82 * u * u),
          cup: 0.003,
          bend: 0.02 + rand() * 0.07,                   // gentle tip curve - turf stands up
          midrib: 0.12,
          lengthSegs: 8, widthSegs: 3
        });
        // Tight carpet base; blades stand mostly vertical with a small random lean.
        const r = 0.05 * Math.sqrt(rand());
        G.applyMatrix(blade, G.trs(
          Math.cos(angle) * r, 0, Math.sin(angle) * r * 0.6,
          (rand() - 0.5) * 0.5, 0.8 + rand() * 0.3));
        parts.push(blade);
      }
      return G.mergeGeometries(parts);
    }
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
