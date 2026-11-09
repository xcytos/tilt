import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

// Dependency order. app.js must stay last: it runs code at module scope.
export const ORDER = [
    'js/scenes.js',
    'js/layouts.js',
    'js/colorways.js',
    'js/recipes.js',
    'js/project.js',
    'js/version.js',
    'js/flowermodel.js',
    'js/flowers/core.js',
    'js/flowers/rose.js',
    'js/flowers/marigold.js',
    'js/flowers/chrysanthemum.js',
    'js/flowers/dahlia.js',
    'js/flowers/gerbera.js',
    'js/flowers/flower-factory.js',
    'js/greenery/greenery-core.js',
    'js/greenery/monstera.js',
    'js/greenery/eucalyptus.js',
    'js/greenery/boston-fern.js',
    'js/greenery/grass.js',
    'js/greenery/ivy-vine.js',
    'js/greenery/ivy.js',
    'js/greenery/leaf-vine.js',
    'js/greenery/greenery-factory.js',
    'js/flowers/scene.js',
    'js/objects/flowerpanel.js',
    'js/objects/flowerchip.js',
    'js/objectchip.js',
    'js/registry.js',
    'js/objects/o2tilt.js',
    'js/objects/pillar.js',
    'js/elements/light.js',
    'js/viewer.js',
    'js/panel.js',
    'js/editor.js',
    'js/app.js'
];

const ENTRY_TAG = '<script type="module" src="./js/app.js"></script>';

function read(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

// Splits a module into its import statements and the rest of the code.
export function splitImports(rel, code) {
    const lines = code.split('\n');
    const rest = [];
    const imports = [];
    let buf = null;

    for (const line of lines) {
        if (buf === null) {
            if (/^\s*import\b/.test(line)) {
                buf = line;
                if (isCompleteImport(buf)) { imports.push(buf); buf = null; }
            } else {
                rest.push(line);
            }
            continue;
        }
        buf += '\n' + line;
        if (isCompleteImport(buf)) { imports.push(buf); buf = null; }
    }
    if (buf !== null) throw new Error(`${rel}: unterminated import statement`);

    return { code: rest.join('\n'), imports };
}

function isCompleteImport(text) {
    if (/^import\s*['"]/.test(text.trim())) return true;
    return /from\s*['"][^'"]+['"]\s*;?\s*$/.test(text);
}

export function stripExports(rel, code) {
    if (/^export\s*\{/m.test(code) || /export\s+default\b/.test(code)) {
        throw new Error(`${rel}: export lists / export default are not supported by the bundler`);
    }
    return code.replace(/^export\s+(?=(?:async\s+)?(?:function|class|const|let|var)\b)/gm, '');
}

export function topLevelNames(code) {
    const names = [];
    const re = /^(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
    let m;
    while ((m = re.exec(code))) names.push(m[1]);
    return names;
}

export function bundle() {
    const allImports = [];
    const chunks = [];
    const seen = new Set();

    for (const rel of ORDER) {
        const { code, imports } = splitImports(rel, read(rel));
        allImports.push(...imports);
        chunks.push(`// ---- ${rel} ----\n` + stripExports(rel, code).trim() + '\n');
    }

    // Bare specifiers (three + addons) resolve through the import map; local
    // './x.js' imports resolve inside the bundle. Duplicates are illegal.
    const remote = [];
    for (const line of allImports) {
        const spec = /from\s*['"]([^'"]+)['"]/.exec(line);
        const name = spec ? spec[1] : null;
        if (name && name.startsWith('.')) continue;
        const key = name || line.trim();
        if (seen.has(key)) continue;
        seen.add(key);
        remote.push(line.trim());
    }

    const code = chunks.join('\n');
    const names = topLevelNames(code);
    const dupes = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
    if (dupes.length) {
        throw new Error(`duplicate top-level declarations after bundling: ${dupes.join(', ')}`);
    }

    return remote.join('\n') + '\n\n' + code;
}

export function buildTo(out) {
    const html = read('TILT.html');
    if (!html.includes(ENTRY_TAG)) {
        throw new Error(`TILT.html no longer contains ${ENTRY_TAG}`);
    }

    const code = bundle().trimEnd();
    const script = `<script type="module">\n${code}\n    </script>`;
    // Function replacer: the bundle is full of `$&`, `$'` and friends
    // (regex sources, template strings), and a string replacement would
    // silently expand them and splice HTML tail into the module.
    const built = html.replace(ENTRY_TAG, () => script);

    fs.writeFileSync(out, built);
    return built;
}

const invokedDirectly =
    process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
    const outArg = process.argv.indexOf('--out');
    const out = outArg >= 0 ? path.resolve(process.argv[outArg + 1])
                            : path.join(ROOT, 'TILT.standalone.html');
    const built = buildTo(out);
    console.log(`built ${path.relative(ROOT, out)} (${built.length} bytes, ${ORDER.length} modules)`);
}
