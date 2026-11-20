// Vendors the exact three.js build TILT loads, so the editor, the homepage
// previews and the standalone file work with no CDN at all.
//
//   node tools/vendor-three.mjs
//
// It downloads build/three.module.js plus every examples/jsm module the
// editor imports (and their relative dependencies) into vendor/three/, and
// leaves the import map in TILT.html pointing at those local files.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const VERSION = '0.160.0';
const BASE = `https://unpkg.com/three@${VERSION}/`;
const OUT = path.join(ROOT, 'vendor', 'three');

// What the editor actually imports. Relative dependencies are crawled from
// here, so the vendor tree stays exactly as large as the app needs.
const ENTRIES = [
    'build/three.module.js',
    'examples/jsm/controls/OrbitControls.js',
    'examples/jsm/environments/RoomEnvironment.js',
    'examples/jsm/postprocessing/EffectComposer.js',
    'examples/jsm/postprocessing/RenderPass.js',
    'examples/jsm/postprocessing/UnrealBloomPass.js',
    'examples/jsm/postprocessing/OutlinePass.js',
    'examples/jsm/postprocessing/OutputPass.js'
];

function depPaths(fromRel, code) {
    const out = [];
    const re = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;
    let m;
    while ((m = re.exec(code))) {
        const spec = m[1];
        let abs;
        if (spec.startsWith('.')) {
            abs = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec));
        } else if (spec.startsWith('three/addons/')) {
            abs = 'examples/jsm/' + spec.slice('three/addons/'.length);
        } else {
            continue; // bare 'three' resolves through the import map
        }
        out.push(abs.endsWith('.js') ? abs : abs + '.js');
    }
    return out;
}

async function fetchText(rel) {
    const res = await fetch(BASE + rel);
    if (!res.ok) throw new Error(`${rel}: ${res.status} ${res.statusText}`);
    return res.text();
}

const seen = new Map();
const queue = [...ENTRIES];

while (queue.length) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    const code = await fetchText(rel);
    seen.set(rel, code);
    for (const dep of depPaths(rel, code)) {
        if (!seen.has(dep)) queue.push(dep);
    }
}

for (const [rel, code] of seen) {
    const dest = path.join(OUT, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, code);
}

const bytes = [...seen.values()].reduce((n, s) => n + Buffer.byteLength(s), 0);
console.log(`vendored three@${VERSION}: ${seen.size} files, ${bytes} bytes`);
console.log(`  ${path.relative(ROOT, OUT)}`);
for (const rel of [...seen.keys()].sort()) console.log(`  ${rel}`);
