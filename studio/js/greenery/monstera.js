/* Monstera leaf — a broad cordate blade with a heart-shaped base (basal lobes + petiole
   notch), six deep angled edge splits (sinuses), seven oval fenestrations, a raised
   midrib with radiating lateral veins, and a long thin wire petiole, matching the
   reference leaf photo. Structural-layer statement foliage. Geometry is normalised so
   the longest axis = 1 (see greenery-core); attachment is the base of the wire.

   Built as a dense makeBlade grid (not a flat Shape) so the cup, cordate base bend and
   vein relief are true per-vertex curvature and holes are punched per-quad — a Shape
   only has outline vertices, so its interior cannot hold veins or smooth cupping. */
(function (root) {
  'use strict';
  const G = root.GreeneryCore;

  // Ovate envelope: ~35% wide at the base (so the cordate lobes have span) and a
  // smooth point at the tip.
  const env = u => Math.sin(Math.PI * Math.pow(0.09 + 0.91 * Math.min(1, Math.max(0, u)), 0.9));
  // Asymmetric sinus pulse: a wide approach before each split centre and a quick cut
  // after it, so every cut edge reads as slanted toward the tip, not perpendicular.
  function makePulse(centers, half, skew) {
    const k = skew != null ? skew : 0.6;
    return function (u) {
      let p = 0;
      for (let i = 0; i < centers.length; i++) {
        const d = u - centers[i];
        const h = d < 0 ? half * 2 * k : half * 2 * (1 - k);
        if (h > 0 && d >= -h && d <= h) p = Math.max(p, 0.5 + 0.5 * Math.cos(Math.PI * d / h));
      }
      return p;
    };
  }

  G.register({
    type: 'monstera',
    label: 'Monstera leaf',
    build(G) {
      const L = 1;                       // blade length (pre-normalisation)
      const halfW = 0.42;                // near-square blade like the reference
      // Six sinuses per side, cut ~62% in; the cut fades near base/tip so the cordate
      // lobes and the pointed tip stay solid.
      const splits = [0.17, 0.31, 0.45, 0.59, 0.73, 0.86];
      const pulse = makePulse(splits, 0.055, 0.6);
      const profile = u => {
        const depthScale = Math.min(1, u / 0.22) * Math.min(1, (1 - u) / 0.15);
        return env(u) * (1 - 0.62 * depthScale * pulse(u));
      };
      // Seven oval fenestrations along the midrib, between the splits (v in -1..1
      // across the blade, so they follow the narrowing blade instead of leaving it).
      const holes = [
        { u: 0.23, v: 0.30, ru: 0.055, rv: 0.16 },
        { u: 0.27, v: -0.27, ru: 0.043, rv: 0.13 },
        { u: 0.37, v: -0.32, ru: 0.058, rv: 0.17 },
        { u: 0.43, v: 0.27, ru: 0.047, rv: 0.14 },
        { u: 0.51, v: 0.30, ru: 0.052, rv: 0.15 },
        { u: 0.61, v: 0.25, ru: 0.041, rv: 0.12 },
        { u: 0.65, v: -0.28, ru: 0.045, rv: 0.14 }
      ];
      const geo = G.makeBlade({
        length: L, halfWidth: halfW, profile,
        holes,
        cup: 0.035, bend: 0.02,
        midrib: 0.10,                    // raised central vein
        tipCurl: 0.03,
        lengthSegs: 44, widthSegs: 40
      });
      // Cordate base + lateral vein relief, applied per-vertex after tessellation.
      const veinYs = [0.24, 0.38, 0.52, 0.66, 0.79];
      const baseHalf = halfW * env(0);   // width at u=0 for the lobe falloff
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y0 = pos.getY(i);
        const u = Math.min(1, Math.max(0, y0 / L));
        // Heart base: the basal corners sweep below the petiole notch while the centre
        // line stays at the attachment point.
        const mask = Math.max(0, 1 - u / 0.16);
        const y = y0 - 0.11 * (x / baseHalf) * (x / baseHalf) * mask * mask;
        // Lateral veins: thin ridges from the midrib angling up toward each margin,
        // fading before the edge (reference: pale radiating veins).
        const ax = Math.abs(x);
        let v = 0;
        for (let k = 0; k < veinYs.length; k++) {
          const perp = Math.abs(y0 - (veinYs[k] + 0.5 * ax)) * 0.894;
          if (perp < 0.02 && ax < 0.36) {
            const s = (1 - perp / 0.02) * Math.max(0, 1 - ax / 0.36);
            if (s > v) v = s;
          }
        }
        pos.setXYZ(i, x, y, pos.getZ(i) + v * 0.020);
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();

      // Long thin wire petiole below the blade (attachment at the wire's base), gently
      // bowed like the reference's wire stems.
      const stem = G.makeTube([
        { x: 0.02, y: -0.55, z: -0.05 },
        { x: -0.015, y: -0.36, z: -0.02 },
        { x: 0.005, y: -0.16, z: -0.005 },
        { x: 0, y: 0, z: 0 }
      ], 0.011, 6);
      return G.mergeGeometries([stem, geo]);
    }
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
