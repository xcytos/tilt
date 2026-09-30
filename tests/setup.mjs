import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const dest = path.join(HERE, 'vendor', 'three160.js');

if (fs.existsSync(dest)) {
    console.log('three@0.160.0 already at', dest);
    process.exit(0);
}

const SRC = 'https://unpkg.com/three@0.160.0/build/three.module.js';
console.log('downloading', SRC);
const res = await fetch(SRC);
if (!res.ok) {
    console.error('download failed:', res.status, res.statusText);
    process.exit(1);
}
fs.mkdirSync(path.dirname(dest), { recursive: true });
const body = await res.text();
fs.writeFileSync(dest, body);
console.log('saved', dest, `(${body.length} bytes)`);
