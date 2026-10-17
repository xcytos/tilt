import { FlowerCore } from './core.js';

/* Rose — a naturally layered bloom. Outer petals open broadly and lie almost
   horizontal; each whorl inward is smaller, more upright and sits further forward,
   ending in a tight overlapping spiral bud. Rounded tips (tipPull), a full central
   ridge (ridgePow<1) and a thin rolled rim (edgePow>1) keep petals reading as curved
   shells rather than flat plates. */
(function () {
  'use strict';
  const C = FlowerCore;
  C.register({
    type: 'rose',
    label: 'Rose',
    pack: 1.0,
    layers: [
      // 1) Outermost whorl: broad, gently opening, nearly horizontal spoon petals.
      { count: 8, radius: 0.135, tilt: 0.12, z: 0.006, angleOffset: 0,
        jitter: 0.05, tiltJitter: 0.06, sizeVar: 0.07, zJitter: 0.010, rollJitter: 0.12, shade: 0.90,
        petal: { length: 0.36, width: 0.20, profile: 'spoon',
                 ridge: 0.028, ridgePow: 0.6, ridgeFade: 1.3,
                 edgeCurl: 0.05, edgePow: 1.7, curl: 0.10, curlPow: 1.9,
                 tipRound: 0.30, tipStart: 0.50, edgeWave: 0.03, edgeWaveFreq: 3,
                 lengthSegs: 8, widthSegs: 10 } },
      // 2) Second whorl: broad and softly rolled, still opening outward.
      { count: 8, radius: 0.11, tilt: 0.28, z: 0.022, angleOffset: Math.PI / 8,
        jitter: 0.05, tiltJitter: 0.07, sizeVar: 0.08, zJitter: 0.012, rollJitter: 0.14, shade: 0.94,
        petal: { length: 0.32, width: 0.185, profile: 'spoon',
                 ridge: 0.026, ridgePow: 0.6, ridgeFade: 1.3,
                 edgeCurl: 0.045, edgePow: 1.6, curl: 0.07, curlPow: 1.8,
                 tipRound: 0.28, tipStart: 0.50, edgeWave: 0.025, edgeWaveFreq: 3,
                 lengthSegs: 8, widthSegs: 10 } },
      // 3) Mid-outer: broader and beginning to cup around the centre.
      { count: 8, radius: 0.085, tilt: 0.50, z: 0.042, angleOffset: 0.35,
        jitter: 0.05, tiltJitter: 0.08, sizeVar: 0.09, zJitter: 0.012, rollJitter: 0.14, shade: 0.98,
        petal: { length: 0.27, width: 0.165, profile: 'cupped', cup: 0.05,
                 ridge: 0.024, ridgePow: 0.6, ridgeFade: 1.3,
                 edgeCurl: 0.04, edgePow: 1.5, curl: 0.05,
                 tipRound: 0.26, tipStart: 0.50,
                 lengthSegs: 7, widthSegs: 9 } },
      // 4) Mid: cupping upward around the bud.
      { count: 8, radius: 0.062, tilt: 0.72, z: 0.062, angleOffset: 0.6,
        jitter: 0.06, tiltJitter: 0.09, sizeVar: 0.10, zJitter: 0.012, rollJitter: 0.16, shade: 1.0,
        petal: { length: 0.23, width: 0.145, profile: 'cupped', cup: 0.055,
                 ridge: 0.020, ridgePow: 0.6, ridgeFade: 1.3,
                 edgeCurl: 0.032, edgePow: 1.5, curl: 0.04,
                 tipRound: 0.24, tipStart: 0.50,
                 lengthSegs: 7, widthSegs: 9 } },
      // 5) Inner whorl: short, cupped, near-upright, slightly lighter.
      { count: 6, radius: 0.042, tilt: 0.98, z: 0.085, angleOffset: 0.85,
        jitter: 0.07, tiltJitter: 0.11, sizeVar: 0.11, zJitter: 0.014, rollJitter: 0.18, lift: 0.08,
        petal: { length: 0.185, width: 0.12, profile: 'cupped', cup: 0.06,
                 ridge: 0.016, ridgePow: 0.55, edgeCurl: 0.026, curl: 0.03,
                 tipRound: 0.22, tipStart: 0.48,
                 lengthSegs: 6, widthSegs: 8 } },
      // 6) Spiral bud: small, overlapping, wrapping inward.
      { count: 5, radius: 0.024, tilt: 1.24, z: 0.108, angleOffset: 1.15,
        jitter: 0.08, tiltJitter: 0.13, sizeVar: 0.12, zJitter: 0.014, rollJitter: 0.20, lift: 0.10,
        petal: { length: 0.14, width: 0.095, profile: 'cupped', cup: 0.06,
                 ridge: 0.013, ridgePow: 0.55, edgeCurl: 0.02, curl: 0.025,
                 tipRound: 0.20, tipStart: 0.45,
                 lengthSegs: 5, widthSegs: 7 } },
      // 7) Core bud: tightest, near-vertical, forms the spiral tip.
      { count: 4, radius: 0.009, tilt: 1.50, z: 0.128, angleOffset: 1.5,
        jitter: 0.09, tiltJitter: 0.14, sizeVar: 0.13, zJitter: 0.012, rollJitter: 0.22, lift: 0.12,
        petal: { length: 0.105, width: 0.07, profile: 'narrow', cup: 0.05,
                 ridge: 0.010, ridgePow: 0.5, curl: 0.02,
                 tipRound: 0.16, tipStart: 0.45,
                 lengthSegs: 5, widthSegs: 7 } }
    ],
    // Small green receptacle tucked behind the bloom (never dominating the profile).
    center: { kind: 'dome', radius: 0.09, squashZ: 0.45, z: -0.02, scale: 1.0, color: 0x6f8a5a, roughness: 0.85 }
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
