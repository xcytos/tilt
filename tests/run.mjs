import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const vendor = path.join(HERE, 'vendor', 'three160.js');

if (!fs.existsSync(vendor)) {
    const boot = spawnSync(process.execPath, [path.join(HERE, 'setup.mjs')], { stdio: 'inherit' });
    if (boot.status) process.exit(boot.status);
}

const files = fs.readdirSync(HERE).filter(f => /^test\d*\.mjs$/.test(f)).sort();
let failed = 0;

for (const f of files) {
    console.log(`\n=== ${f}`);
    const r = spawnSync(process.execPath, [path.join(HERE, f)], { stdio: 'inherit' });
    if (r.status) failed++;
}

console.log(`\n${files.length - failed}/${files.length} suites passed`);
process.exit(failed ? 1 : 0);
