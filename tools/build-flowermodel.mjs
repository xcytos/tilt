// Generates studio/model.js (classic UMD) from js/flowermodel.js (the shared ESM
// source of truth). The Studio loads the UMD as a plain <script>; the TILT bundle
// imports the ESM. Both run the exact same body, so placement math and the
// settings schema can never drift between the two apps.
//
//   node tools/build-flowermodel.mjs          # regenerate studio/model.js
//
// js/flowermodel.js must keep the exact wrapper:
//   export const FlowerModel = (function () {  ...body...  })();
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SRC = path.join(ROOT, 'js', 'flowermodel.js');
const OUT = path.join(ROOT, 'studio', 'model.js');

const PREFIX = 'export const FlowerModel = (function () {';
const SUFFIX = '})();';

export function umdFromEsm(esm) {
    const a = esm.indexOf(PREFIX);
    if (a < 0) throw new Error('js/flowermodel.js is missing the "export const FlowerModel = (function () {" wrapper');
    const bodyStart = a + PREFIX.length;
    const b = esm.lastIndexOf(SUFFIX);
    if (b < 0 || b < bodyStart) throw new Error('js/flowermodel.js is missing the closing "})();"');
    const body = esm.slice(bodyStart, b).replace(/^\r?\n/, '').replace(/\s+$/, '');

    return `/* Pure arrangement calculations. Browser + Node compatible.
 * GENERATED from js/flowermodel.js by tools/build-flowermodel.mjs - do not edit this copy.
 * Edit js/flowermodel.js and re-run: node tools/build-flowermodel.mjs */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof window !== 'undefined') window.FlowerModel = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
${body}
});
`;
}

const invokedDirectly =
    process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
    const esm = fs.readFileSync(SRC, 'utf8');
    const umd = umdFromEsm(esm);
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, umd);
    console.log(`built ${path.relative(ROOT, OUT)} (${umd.length} bytes) from js/flowermodel.js`);
}
