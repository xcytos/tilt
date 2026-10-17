import * as THREE from 'three';
import { GreeneryCore } from './greenery-core.js';

/* Monstera leaf — a broad cordate/ovate blade with deep characteristic edge splits
   (sinuses) and smooth oval fenestrations, on a short petiole. Structural-layer
   statement foliage. Geometry is normalised so the longest axis = 1 (see greenery-core).

   The blade is built from a THREE.Shape (outer outline + hole paths) so that:
     - the silhouette is smooth and recognisably monstera (not a jagged grid blob),
     - fenestrations are true, smooth openings (not blocky per-quad cutouts),
     - the outline is wound CCW so face normals point +Z (front faces the camera),
       which removes the inverted-winding / back-face darkening seen previously.
   A gentle cup + tip lift is applied by displacing Z after triangulation. */
(function () {
  'use strict';
  const G = GreeneryCore;
  const T = THREE;

  // Smooth ovate envelope: 0 at base and tip, broad plateau across the middle. The high
  // exponent keeps the upper half broad so it reads as a leaf plate, not a fir-tree cone.
  const env = u => Math.sin(Math.PI * Math.pow(Math.max(0, Math.min(1, u)), 0.85));
  // Split (sinus) pulse: 1 at a split centre, smoothly 0 one half-spacing away.
  function makePulse(centers, half) {
    return function (u) {
      let p = 0;
      for (let i = 0; i < centers.length; i++) {
        const d = Math.abs(u - centers[i]);
        if (d < half) p = Math.max(p, 0.5 + 0.5 * Math.cos(Math.PI * d / half));
      }
      return p;
    };
  }

  G.register({
    type: 'monstera',
    label: 'Monstera leaf',
    build(G) {
      const L = 1;                       // length; normalizeLongAxis keeps it at 1
      const halfW = 0.42;                // broad blade (near-square silhouette like monstera)
      // Fewer, broader lobes: 5 sinuses per side, cut ~52% in so a wide central webbing
      // keeps every lobe attached. Narrow sinuses -> broad rounded fingers, not barbs.
      const splits = [0.16, 0.30, 0.44, 0.58, 0.72];
      const splitDepth = 0.52;
      const splitHalf = 0.05;
      const pulse = makePulse(splits, splitHalf);
      const hw = u => halfW * env(u) * (1 - splitDepth * pulse(u));

      // Outer outline, wound CCW (up the right edge, then down the left) so the
      // triangulated front face points +Z (toward the camera).
      const N = 220;
      const pts = [];
      for (let i = 0; i <= N; i++) { const u = i / N; pts.push(new T.Vector2(hw(u), u * L)); }
      for (let i = N - 1; i >= 1; i--) { const u = i / N; pts.push(new T.Vector2(-hw(u), u * L)); }
      const shape = new T.Shape(pts);

      // Smooth oval fenestrations along the midrib, placed between the splits so they
      // stay inside the solid central webbing (never crossing an edge sinus). Real openings.
      const holes = [
        { x: 0.060, y: 0.23, rx: 0.032, ry: 0.056 },
        { x: -0.062, y: 0.37, rx: 0.034, ry: 0.060 },
        { x: 0.058, y: 0.51, rx: 0.032, ry: 0.054 },
        { x: -0.054, y: 0.65, rx: 0.028, ry: 0.046 }
      ];
      for (let i = 0; i < holes.length; i++) {
        const h = holes[i], path = new T.Path();
        path.absellipse(h.x, h.y, h.rx, h.ry, 0, Math.PI * 2, false, 0);
        shape.holes.push(path);
      }

      // Triangulate outline + holes, then give the blade a gentle cup (edges lift)
      // and a tip lift so it reads as a leaf rather than a flat cutout.
      const geo = new T.ShapeGeometry(shape, 26);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i);
        pos.setZ(i, 0.055 * (x / halfW) * (x / halfW) + 0.075 * (y / L) * (y / L));
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();

      // Short petiole below the blade (attachment at the stem base / origin).
      const stem = G.makeTube(
        [{ x: 0, y: -0.15, z: -0.03 }, { x: 0, y: -0.05, z: -0.012 }, { x: 0, y: 0, z: 0 }],
        0.018, 7);
      return G.mergeGeometries([stem, geo]);
    }
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
