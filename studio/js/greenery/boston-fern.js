/* Boston fern bush — a full clump of arching, feathery fronds radiating from a compact
   base. Filler/volume layer. Geometry is normalised so the longest axis = 1 (see
   greenery-core); attachment is the base of the clump (origin). */
(function (root) {
  'use strict';
  const G = root.GreeneryCore;
  // One canonical frond pointing +Y: an arching rachis that lifts then droops at the
  // tip, densely carrying serrated scallop-margin pinnae that shrink toward the point,
  // matching the reference's long feathery fronds.
  function makeFrond(G) {
    const pts = [];
    const N = 10;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      // Arch laterally (panel plane); lift the middle in Z then droop the tip below
      // the crown plane so fronds fountain out and hang like the reference.
      pts.push({
        x: 0.11 * Math.sin(t * 1.9),
        y: t,
        z: 0.12 * Math.sin(t * Math.PI * 0.85) - 0.10 * t * t * t
      });
    }
    const rachis = G.makeTube(pts, t => 0.015 * (1 - t * 0.65) + 0.005, 5);
    // Pinna with scalloped margins (lobes = 4 shallow notches sampled cleanly at
    // lengthSegs 8) and a forward lean so neighbouring pairs overlap into a feather.
    const leaflet = G.makeBlade({
      length: 0.19, halfWidth: 0.052,
      profile: u => Math.pow(Math.sin(Math.PI * Math.min(1, 0.16 + 0.72 * u)), 0.5),
      cup: 0.006, bend: 0.02,
      midrib: 0.07, // faint central rachis vein for depth
      lobes: { count: 4, depth: 0.12 }, // scalloped pinna margin (reference)
      lengthSegs: 8, widthSegs: 3
    });
    const parts = [rachis];
    const pairs = 21; // dense pinnae (reference: many per frond)
    for (let i = 1; i <= pairs; i++) {
      const t = i / (pairs + 0.5);
      const p = pts[Math.min(N, Math.round(t * N))];
      const sc = 1 - t * 0.5;                        // pinnae shorten gradually to the tip
      for (const side of [1, -1]) {
        const c = G.cloneGeom(leaflet);
        // -side puts +X on the right; ~1.0 rad (~57°) leans leaflets forward (outward +
        // up), which overlaps them into a soft feather instead of a spiky starburst.
        G.applyMatrix(c, G.trs(p.x, p.y, p.z, -side * 1.0, sc));
        parts.push(c);
      }
    }
    return G.mergeGeometries(parts);
  }
  G.register({
    type: 'boston-fern',
    label: 'Boston fern bush',
    build(G) {
      const frond = makeFrond(G);
      const parts = [];
      // Outer ring: long arching fronds forming the rounded silhouette.
      const outer = 13;
      for (let k = 0; k < outer; k++) {
        const theta = k / outer * Math.PI * 2 + 0.2;
        const sc = 0.5 * (0.86 + 0.32 * ((k * 37) % 7) / 7);
        parts.push(G.applyMatrix(G.cloneGeom(frond), G.trs(0, 0, 0, theta, sc)));
      }
      // Middle ring fills the body of the clump.
      const mid = 7;
      for (let k = 0; k < mid; k++) {
        const theta = k / mid * Math.PI * 2 + 0.65;
        parts.push(G.applyMatrix(G.cloneGeom(frond), G.trs(0, 0, 0.008, theta, 0.36)));
      }
      // Short inner fronds close the centre so no hollow starburst core shows.
      const inner = 4;
      for (let k = 0; k < inner; k++) {
        const theta = k / inner * Math.PI * 2 + 1.1;
        parts.push(G.applyMatrix(G.cloneGeom(frond), G.trs(0, 0, 0.014, theta, 0.2)));
      }
      return G.mergeGeometries(parts);
    }
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
