/* Chrysanthemum — decorative mum: many slender, tapering fountain petals. */
(function (root) {
  'use strict';
  const C = root.FlowerCore;
  C.register({
    type: 'chrysanthemum',
    label: 'Chrysanthemum',
    pack: 0.94,
    layers: [
      { count: 22, radius: 0.12, tilt: 0.14, z: 0.0, jitter: 0.04, tiltJitter: 0.05, sizeVar: 0.05, shade: 0.9,
        petal: { length: 0.37, width: 0.05, profile: 'narrow', cup: 0.012, curl: 0.09, curlPow: 1.5, tipPinch: 0.3, lengthSegs: 7, widthSegs: 4 } },
      { count: 18, radius: 0.095, tilt: 0.4, z: 0.012, jitter: 0.05, tiltJitter: 0.06, sizeVar: 0.05, shade: 0.96,
        petal: { length: 0.32, width: 0.046, profile: 'narrow', cup: 0.014, curl: 0.075, curlPow: 1.5, tipPinch: 0.3, lengthSegs: 7, widthSegs: 4 } },
      { count: 14, radius: 0.065, tilt: 0.72, z: 0.022, jitter: 0.06, tiltJitter: 0.07, sizeVar: 0.06, lift: 0.05,
        petal: { length: 0.26, width: 0.042, profile: 'narrow', cup: 0.016, curl: 0.06, curlPow: 1.5, tipPinch: 0.25, lengthSegs: 6, widthSegs: 4 } },
      { count: 10, radius: 0.04, tilt: 1.05, z: 0.03, jitter: 0.07, tiltJitter: 0.09, sizeVar: 0.07, lift: 0.11,
        petal: { length: 0.18, width: 0.037, profile: 'narrow', cup: 0.018, curl: 0.045, curlPow: 1.4, tipPinch: 0.2, lengthSegs: 5, widthSegs: 4 } },
      { count: 7, radius: 0.02, tilt: 1.4, z: 0.036, jitter: 0.08, tiltJitter: 0.1, sizeVar: 0.08, lift: 0.15,
        petal: { length: 0.11, width: 0.032, profile: 'narrow', cup: 0.02, curl: 0.03, lengthSegs: 5, widthSegs: 4 } }
    ],
    center: { kind: 'dome', radius: 0.04, squashZ: 0.55, z: 0.04, scale: 0.8, followPalette: true, shade: 0.8, roughness: 0.85 }
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
