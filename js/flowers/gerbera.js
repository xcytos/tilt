import { FlowerCore } from './core.js';

/* Gerbera daisy — large gerbera: one dominant ring of long ray petals around a clear disc. */
(function () {
  'use strict';
  const C = FlowerCore;
  C.register({
    type: 'gerbera',
    label: 'Gerbera daisy',
    pack: 1.04,
    layers: [
      // Dominant single ring of long, narrow ray petals (low tilt = flat head).
      { count: 24, radius: 0.14, tilt: 0.06, z: 0.0, jitter: 0.02, tiltJitter: 0.03, sizeVar: 0.04, shade: 0.96,
        petal: { length: 0.36, width: 0.06, profile: 'ray', cup: 0.012, cupFade: 0.4, curl: 0.03, tipPinch: 0.2, lengthSegs: 7, widthSegs: 4 } },
      // Short petaloid transition ring just inside the rays.
      { count: 18, radius: 0.075, tilt: 0.16, z: 0.008, jitter: 0.03, tiltJitter: 0.03, sizeVar: 0.05, shade: 0.82,
        petal: { length: 0.16, width: 0.045, profile: 'ray', cup: 0.01, curl: 0.02, lengthSegs: 5, widthSegs: 4 } }
    ],
    // Clear pollen disc (natural golden-brown eye, independent of petal colour).
    center: { kind: 'dome', radius: 0.075, squashZ: 0.34, z: 0.012, scale: 1.0, color: 0x9c7a2a, roughness: 0.9 }
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
