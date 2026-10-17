import { FlowerCore } from './core.js';

/* Dahlia — decorative dahlia: structured concentric layers of pointed petals. */
(function () {
  'use strict';
  const C = FlowerCore;
  C.register({
    type: 'dahlia',
    label: 'Dahlia',
    pack: 0.88,
    layers: [
      { count: 20, radius: 0.135, tilt: 0.18, z: 0.0, jitter: 0.02, tiltJitter: 0.02, sizeVar: 0.03, shade: 0.9,
        petal: { length: 0.33, width: 0.125, profile: 'taper', cup: 0.03, curl: 0.02, lengthSegs: 6, widthSegs: 5 } },
      { count: 13, radius: 0.105, tilt: 0.44, z: 0.014, angleOffset: Math.PI / 13, jitter: 0.02, tiltJitter: 0.03, sizeVar: 0.03, shade: 0.96,
        petal: { length: 0.28, width: 0.115, profile: 'taper', cup: 0.035, curl: 0.02, lengthSegs: 6, widthSegs: 5 } },
      { count: 8, radius: 0.075, tilt: 0.74, z: 0.026, jitter: 0.02, tiltJitter: 0.03, sizeVar: 0.04, lift: 0.05,
        petal: { length: 0.22, width: 0.1, profile: 'taper', cup: 0.04, curl: 0.015, lengthSegs: 6, widthSegs: 5 } },
      { count: 5, radius: 0.045, tilt: 1.05, z: 0.036, jitter: 0.03, tiltJitter: 0.04, sizeVar: 0.05, lift: 0.1,
        petal: { length: 0.15, width: 0.082, profile: 'taper', cup: 0.045, lengthSegs: 5, widthSegs: 5 } }
    ],
    center: { kind: 'dome', radius: 0.03, squashZ: 0.55, z: 0.042, scale: 0.7, followPalette: true, shade: 0.8, roughness: 0.85 }
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
