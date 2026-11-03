import * as THREE from 'three';
import { GreeneryCore } from './greenery-core.js';

/* Wisteria garland — hangs downward from its attachment point (stem base at the top): a
   slim main stem carrying 4-5 drooping racemes densely packed with small 4-petal
   blossoms, plus a band of green leaflets at the top (G.wantsLeaves()). Two colour
   layers: the blossoms take the item colour (pink by default, supportsColor), while the
   stems and leaflets stay green via a fixed layer colour. Trailing layer: drapes down
   the panel. Geometry normalises the longest axis to 1 about the origin. */
(function () {
  'use strict';
  const G = GreeneryCore;
  const T = THREE;

  G.register({
    type: 'ivy-vine',
    label: 'Ivy / wisteria vine',
    supportsLeaves: true,
    supportsColor: true,
    build(G) {
      const showLeaves = G.wantsLeaves();
      const rand = G.mulberry32(0x51ed270b);
      const stems = [];             // fixed-green layer: main stem, racemes, leaflets
      const blossoms = [];          // item-coloured layer: 4-petal flowers

      // Main stem hangs downward (y: 0 -> -1) with a gentle S-drift in x and z.
      const pts = [];
      const N = 26;
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        pts.push({ x: Math.sin(t * 3.1) * 0.05, y: -t, z: Math.sin(t * 2.2 + 1.1) * 0.012 });
      }
      stems.push(G.makeTube(pts, t => 0.016 * (1 - t * 0.6) + 0.005, 6));

      // One small 4-petal blossom: petals radiate in the local XY plane, face +Z.
      const petal = G.makeBlade({
        length: 0.030, halfWidth: 0.017,
        profile: u => Math.pow(Math.sin(Math.PI * Math.min(1, 0.20 + 0.68 * u)), 0.55),
        cup: 0.005, bend: 0.012,
        lengthSegs: 4, widthSegs: 4
      });
      const flowerParts = [];
      for (let k = 0; k < 4; k++) {
        const p = G.cloneGeom(petal);
        G.applyMatrix(p, G.trs(0, 0, 0, k * Math.PI / 2, 1));
        flowerParts.push(p);
      }
      const flower = G.mergeGeometries(flowerParts);

      const face = new T.Vector3(0, 0, 1);
      function addBlossom(x, y, z, az, sc) {
        // Face outward from the raceme with a slight downward tilt (wisteria nods).
        const dir = new T.Vector3(Math.sin(az) * 0.42, -0.16, 0.88).normalize();
        const q = new T.Quaternion().setFromUnitVectors(face, dir);
        const m = new T.Matrix4().compose(
          new T.Vector3(x, y, z), q, new T.Vector3(sc, sc, sc));
        blossoms.push(G.applyMatrix(G.cloneGeom(flower), m));
      }

      // Five racemes droop from the main stem; each is a tapering axis carrying a dense
      // golden-angle spiral of blossoms that shrink toward the tip.
      const racemes = 5;
      for (let i = 0; i < racemes; i++) {
        const t0 = 0.08 + i * 0.19;
        const p0 = pts[Math.min(N, Math.round(t0 * N))];
        const side = i % 2 ? 1 : -1;
        const len = 0.30 + rand() * 0.06;
        const M = 6;
        const rp = [];
        for (let j = 0; j <= M; j++) {
          const u = j / M;
          rp.push({
            x: p0.x + side * (0.02 + u * 0.10) + Math.sin(u * 2.4) * 0.02,
            y: p0.y - u * len,
            z: p0.z + Math.sin(u * 3.1 + i) * 0.012
          });
        }
        stems.push(G.makeTube(rp, u => 0.010 * (1 - u * 0.7) + 0.003, 4));
        const K = 13;
        for (let j = 1; j <= K; j++) {
          const u = j / (K + 0.3);
          const seg = Math.min(M - 1, Math.floor(u * M)), f = u * M - seg;
          const a = rp[seg], b = rp[seg + 1];
          const fx = a.x + (b.x - a.x) * f, fy = a.y + (b.y - a.y) * f, fz = a.z + (b.z - a.z) * f;
          const az = j * 2.399 + rand() * 0.6;   // golden-angle spiral + jitter
          const off = 0.013;
          addBlossom(fx + Math.cos(az) * off, fy, fz + Math.sin(az) * off,
            az, (1 - u * 0.5) * (0.8 + rand() * 0.4));
        }
      }

      // Green leaflet band at the top (gated by the leaves toggle).
      if (showLeaves) {
        const leaflet = G.makeBlade({
          length: 0.11, halfWidth: 0.05,
          profile: u => Math.pow(Math.sin(Math.PI * Math.min(1, 0.12 + 0.78 * u)), 0.6),
          cup: 0.01, bend: 0.015,
          midrib: 0.09, tipCurl: 0.03,
          lengthSegs: 5, widthSegs: 6
        });
        const band = [0.04, 0.10, 0.16, 0.22, 0.28];
        for (let i = 0; i < band.length; i++) {
          const p = pts[Math.min(N, Math.round(band[i] * N))];
          const side = i % 2 ? 1 : -1;
          const sc = 0.95 - i * 0.1;
          const bx = p.x + side * 0.018;
          stems.push(G.makeTube([
            { x: p.x, y: p.y, z: p.z },
            { x: bx, y: p.y + 0.01, z: p.z }
          ], 0.005, 3));
          const c = G.cloneGeom(leaflet);
          G.applyMatrix(c, G.trs(bx, p.y + 0.01, p.z,
            -side * (1.2 + rand() * 0.3), sc * (0.85 + rand() * 0.3)));
          stems.push(c);
        }
      }

      return {
        layers: [
          { geometry: G.mergeGeometries(blossoms) },
          { geometry: G.mergeGeometries(stems), fixed: '#3f7d38' }
        ]
      };
    }
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
