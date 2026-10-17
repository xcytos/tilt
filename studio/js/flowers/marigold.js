/* Marigold — dense African marigold: dome of many narrow, ruffled petals. */
(function (root) {
  'use strict';
  const C = root.FlowerCore;
  C.register({
    type: 'marigold',
    label: 'Marigold',
    pack: 0.9,
    layers: [
      { count: 26, radius: 0.15, tilt: 0.12, z: 0.0, jitter: 0.05, tiltJitter: 0.05, sizeVar: 0.05, shade: 0.86,
        petal: { length: 0.30, width: 0.062, profile: 'narrow', cup: 0.014, curl: 0.03, ruffle: 0.013, ruffleFreq: 6, lengthSegs: 6, widthSegs: 4 } },
      { count: 22, radius: 0.12, tilt: 0.33, z: 0.01, jitter: 0.05, tiltJitter: 0.06, sizeVar: 0.05, shade: 0.92,
        petal: { length: 0.27, width: 0.058, profile: 'narrow', cup: 0.016, curl: 0.028, ruffle: 0.012, ruffleFreq: 6, lengthSegs: 6, widthSegs: 4 } },
      { count: 18, radius: 0.09, tilt: 0.6, z: 0.018, jitter: 0.06, tiltJitter: 0.07, sizeVar: 0.06, shade: 0.98, lift: 0.03,
        petal: { length: 0.23, width: 0.052, profile: 'narrow', cup: 0.018, curl: 0.025, ruffle: 0.011, ruffleFreq: 6, lengthSegs: 6, widthSegs: 4 } },
      { count: 13, radius: 0.06, tilt: 0.92, z: 0.026, jitter: 0.07, tiltJitter: 0.08, sizeVar: 0.07, lift: 0.08,
        petal: { length: 0.17, width: 0.046, profile: 'narrow', cup: 0.02, curl: 0.02, ruffle: 0.01, ruffleFreq: 5, lengthSegs: 5, widthSegs: 4 } },
      { count: 10, radius: 0.032, tilt: 1.25, z: 0.034, jitter: 0.08, tiltJitter: 0.1, sizeVar: 0.08, lift: 0.13,
        petal: { length: 0.12, width: 0.04, profile: 'narrow', cup: 0.02, curl: 0.015, ruffle: 0.008, ruffleFreq: 5, lengthSegs: 5, widthSegs: 4 } }
    ],
    // Compact textured centre in the same colour family.
    center: { kind: 'dome', radius: 0.05, squashZ: 0.55, z: 0.04, scale: 0.9, followPalette: true, shade: 0.78, roughness: 0.85 }
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
