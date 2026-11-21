import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DECOR = path.resolve(HERE, '..');
const read = rel => fs.readFileSync(path.join(DECOR, rel), 'utf8');

let fails = 0;
const check = (l, c, x = '') => {
  if (c) console.log('  ok   ' + l);
  else { fails++; console.log('  FAIL ' + l + (x ? '  ' + x : '')); }
};

const viewer = read('js/viewer.js');
const panel = read('js/panel.js');
const app = read('js/app.js');
const buildSrc = read('tools/build.mjs');

// ------------------------------------------------- 1. render preferences
console.log('\nrender preferences: one contract, one restore, one writer');
check('versioned, namespaced storage key',
  viewer.includes("RENDER_PREFS_KEY = 'tilt-render-prefs-v1'"));
check('legacy quality key is migrated, not dropped',
  viewer.includes("LEGACY_QUALITY_KEY = 'tilt-render-quality'")
  && /getItem\(LEGACY_QUALITY_KEY\)/.test(viewer));
check('defaults are shadows on / key box off / standard',
  /quality: 'standard',\s*\n\s*shadows: true,\s*\n\s*shadowBox: false/.test(viewer));
check('storage is read inside try/catch (denied storage cannot break boot)',
  /function readRenderPrefs\(\) \{[\s\S]*?try \{[\s\S]*?localStorage[\s\S]*?\} catch/.test(viewer));
check('writes are also guarded',
  /function writeRenderPrefs[\s\S]*?try \{[\s\S]*?localStorage[\s\S]*?\} catch/.test(viewer));

const iQ = viewer.indexOf('this.setQuality(savedRenderPrefs.quality, false)');
const iS = viewer.indexOf('this.setShadowsEnabled(savedRenderPrefs.shadows, false)');
const iB = viewer.indexOf('this.setShadowBoxVisible(savedRenderPrefs.shadowBox, false)');
check('restore order: lights/scene -> quality -> shadows -> key box',
  iQ >= 0 && iS > iQ && iB > iS, `${iQ} ${iS} ${iB}`);
check('boot restore never rewrites storage (persist=false)',
  iQ > 0 && iS > 0 && iB > 0
  && viewer.slice(iQ, iQ + 80).includes(', false)')
  && viewer.slice(iS, iS + 90).includes(', false)')
  && viewer.slice(iB, iB + 95).includes(', false)'));
check('boot applies the shadow flag to the renderer itself',
  viewer.includes('renderer.shadowMap.enabled = savedRenderPrefs.shadows;'));

for (const [name, sig] of [
  ['setQuality', 'setQuality(q, persist = true)'],
  ['setShadowsEnabled', 'setShadowsEnabled(on, persist = true)'],
  ['setShadowBoxVisible', 'setShadowBoxVisible(on, persist = true)']
]) {
  check(`${name} takes a persist flag`, viewer.includes(sig));
}
check('every setter gates its write on persist',
  (viewer.match(/if \(persist\) writeRenderPrefs\(/g) || []).length === 3,
  String((viewer.match(/if \(persist\) writeRenderPrefs\(/g) || []).length));
check('quality and shadow keys are written independently',
  /writeRenderPrefs\(\{ quality: next \}\)/.test(viewer)
  && /writeRenderPrefs\(\{ shadows: next \}\)/.test(viewer)
  && /writeRenderPrefs\(\{ shadowBox: !!on \}\)/.test(viewer));

check('the Look shelf reads the viewer back, not a local guess',
  panel.includes('shadowInfo ? shadowInfo()')
  && /enabled: this\.renderer\.shadowMap\.enabled/.test(viewer)
  && /boxVisible: !!\(this\._shadowBox && this\._shadowBox\.visible\)/.test(viewer));
check('user toggles persist (no persist=false from the panel path)',
  /onShadowToggle: on => viewer\.setShadowsEnabled\(on\)/.test(app)
  && /onShadowBoxToggle: on => viewer\.setShadowBoxVisible\(on\)/.test(app)
  && /onQualityChange: guard\(q => viewer\.setQuality\(q\)\)/.test(app));

// ------------------------------------------------------- 2. S Curve split
console.log('\nS Curve vs generic frame code');
const setShape = read('js/setShape.js');
check('setShape.js is the single home of the SET shape keys',
  /export const SET_SHAPE_KEYS = Object\.freeze\(\[/.test(setShape)
  && setShape.includes("'gap'") && setShape.includes("'lobes'"));
check('app.js imports it instead of declaring its own',
  app.includes("import { SET_SHAPE_KEYS } from './setShape.js'")
  && !/const SET_SHAPE_KEYS\s*=/.test(app));
check('project.js accepts exactly what app.js writes',
  read('js/project.js').includes("import { SET_SHAPE_KEYS } from './setShape.js'")
  && !read('js/project.js').includes('DOC_SET_SHAPE_KEYS'));
check('the build orders setShape.js before project.js and app.js',
  /'js\/setShape\.js'/.test(buildSrc)
  && buildSrc.indexOf("'js/setShape.js'") < buildSrc.indexOf("'js/project.js'")
  && buildSrc.indexOf("'js/setShape.js'") < buildSrc.indexOf("'js/app.js'"));

const applyBody = app.slice(app.indexOf('function applySetParams'),
  app.indexOf('async function syncScene'));
check('applying a SET goes through each model schema, not PARAMS',
  applyBody.includes('m.params') && !applyBody.includes('PARAMS[')
  && applyBody.includes("meta.type !== 'range'"));
check('the registry still binds the concrete S Curve type once',
  app.includes("registry.register('o2tilt-frame', createO2TiltModel, PARAMS)"));
check('legacy ids stay mapped to o2tilt on disk (documented, not renamed)',
  app.includes("'o2tilt-classic': 'o2tilt'"));

check('selection.js describes frames, not the S Curve',
  !/S Curve|S-curve|S curve/.test(read('js/selection.js')));
check('the light family describes the frame route, not the S Curve',
  !/S Curve|S-curve|S curve/.test(read('js/elements/light.js')));
check('the model catalog keeps the S Curve name where it belongs',
  read('js/registry.js').includes("name: 'S Curve'")
  && read('js/objects/o2tilt.js').includes("MODEL_NAME = 'S Curve'"));

console.log('\nchips stay separated by subject');
check('frame cycles shape / colour / lights',
  /frame: \['shape', 'colour', 'lights'\]/.test(read('js/selection.js')));
check('pillar, light, flower and decor chips do not borrow the frame chips',
  /pillar: \['pillars'\]/.test(read('js/selection.js'))
  && /light: \['lights'\]/.test(read('js/selection.js'))
  && /flower: \['flowers'\]/.test(read('js/selection.js'))
  && /decor: \['stage'\]/.test(read('js/selection.js')));
check('the Shape chip renders ranges, Colour renders toggles, Lights its own block',
  /tool === 'shape' && shapeRanges\.length/.test(panel)
  && /tool === 'colour' && normalToggles\.length/.test(panel)
  && /tool === 'lights'\) inner\.appendChild\(lightsBlock\(key\)\)/.test(panel)
  && /tool === 'pillars'\) inner\.appendChild\(pillarsBlock\(key\)\)/.test(panel));

// ------------------------------------------------------- 3. no runtime CDN
console.log('\nruntime CDN');
const shell = read('TILT.html');
const standalone = read('TILT.standalone.html');
const modelsHtml = read('models.html');
check('the editor has no Tailwind Play CDN',
  !/cdn\.tailwindcss\.com/.test(shell));
check('the editor styles itself from the compiled sheet',
  shell.includes('<link rel="stylesheet" href="./css/tailwind.css">'));
check('the editor resolves three locally',
  shell.includes('"three": "./vendor/three/build/three.module.js"')
  && !/unpkg\.com/.test(shell));
check('the homepage previews resolve three locally',
  modelsHtml.includes('"three": "./vendor/three/build/three.module.js"')
  && !/unpkg\.com/.test(modelsHtml));
check('the standalone copy carries the styles inline, no fetch',
  !/cdn\.tailwindcss\.com|unpkg\.com/.test(standalone)
  && standalone.includes('<style>'));
const tailwind = read('css/tailwind.css');
check('the compiled sheet is real output, not a stub',
  tailwind.length > 8000 && tailwind.includes('box-sizing:border-box'));
check('dark mode is class-driven (the editor flips .dark on <html>)',
  tailwind.includes(':is(.dark *)') && !tailwind.includes('prefers-color-scheme'));
check('the build fails loudly if the sheet is missing or unlinked',
  buildSrc.includes('TILT.html no longer contains ${TAILWIND_TAG}')
  && buildSrc.includes('fs.readFileSync(cssPath'));
check('the build inlines the sheet with a function replacer (no $ expansion)',
  buildSrc.includes('built.replace(TAILWIND_TAG,')
  && buildSrc.includes('() => `<style>'));
check('the service worker caches the local sheet for offline',
  read('sw.js').includes("'/css/tailwind.css'")
  && read('sw.js').includes("VERSION = 'tilt-v3'"));
check('vendor/three is a committed local copy, not a test fixture',
  fs.existsSync(path.join(DECOR, 'vendor/three/build/three.module.js'))
  && !/vendor\/three/.test(read('.gitignore')));

// Every asset reference in the product, not just the shell the plan names.
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules' || e.name === 'vendor'
        || e.name === '.tmp') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(html|css|js|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
};
const EXTERNAL_ASSET = /<script[^>]+src=["']https?:\/\/|<link[^>]+href=["']https?:\/\/|url\(\s*["']?https?:\/\//;
const offenders = walk(DECOR)
  .filter(f => EXTERNAL_ASSET.test(fs.readFileSync(f, 'utf8')))
  .map(f => path.relative(DECOR, f));
check('no external script, stylesheet or url() anywhere in the product',
  offenders.length === 0, offenders.join(', '));
check('the Flower Studio loads three from vendor/three0128',
  read('studio/index.html').includes('../vendor/three0128/three.min.js')
  && fs.existsSync(path.join(DECOR, 'vendor/three0128/three.min.js')));
check('vendored sources are exempt from whitespace checks, ours are not',
  read('.gitattributes').includes('vendor/** -whitespace')
  && read('.gitattributes').includes('render-lab/vendor/** -whitespace'));

// -------------------------------------------- 4. focus, motion, touch
console.log('\nfocus and motion');
const cssFiles = ['home/home.css', 'home/models.css', 'studio/styles.css', 'TILT.html'];
for (const f of cssFiles) {
  const src = read(f);
  check(`${f}: no transition: all`, !/transition:\s*all/.test(src));
}
for (const f of ['home/home.css', 'home/models.css']) {
  const src = read(f);
  check(`${f}: outline:none has a visible focus replacement`,
    /outline: none/.test(src)
    && /:focus-visible/.test(src) && /:focus-within/.test(src));
}
check('TILT.html: every interactive control gets a keyboard focus ring',
  /:where\(button, a, input, select, textarea, summary, \[tabindex\]\):focus-visible/.test(shell));
check('TILT.html: the range input keeps a keyboard ring despite the pointer reset',
  /input\[type=range\]:focus \{ outline: none; \}/.test(shell)
  && /input\[type=range\]:focus-visible \{ outline: 2px solid/.test(shell));
check('TILT.html: the shelf field has its own focus style',
  /#sheet-input:focus \{ outline: 2px solid/.test(shell));
for (const f of ['home/home.css', 'home/models.css', 'studio/styles.css', 'TILT.html']) {
  check(`${f}: reduced-motion path`, /prefers-reduced-motion/.test(read(f)));
}
check('the home search rings the whole field on focus',
  read('home/home.css').includes('.search:focus-within')
  && read('home/models.css').includes('.search:focus-within'));
check('touch chips reach 44px on coarse pointers',
  /@media \(pointer: coarse\)[\s\S]*?\.chip \{ min-height: 44px; \}/.test(read('home/home.css')));
check('the editor bar targets are already 44px',
  /\.tb-btn \{[^}]*min-height: 44px/.test(shell));

// ------------------------------------------------------------ 5. the plan
console.log('\nLevel 1 plan');
const plan = read('plans/ui-quality-level-1.md');
check('the plan is on the branch', plan.includes('TILT UI Quality'));
check('it pins the integration base and merge target',
  plan.includes('`selection-save-reload` at `3e6f901`')
  && plan.includes('`selection-save-reload` only. No direct `main` merge.'));
check('it records the scorecard gate',
  plan.includes('No dimension below 3') && plan.includes('3.5'));
const scorecard = read('plans/ui-quality-level-1-scorecard.md');
check('the scorecard scores every surface in scope',
  (scorecard.match(/^\| \d+ \| /gm) || []).length === 10,
  String((scorecard.match(/^\| \d+ \| /gm) || []).length));
check('P0/P1 surfaces all clear the weighted gate',
  ['**3.65**', '**4.00**', '**3.50**', '**3.85**'].every(s => scorecard.includes(s)));
check('the handoff records rollback and the manual gates still open',
  plan.includes('Merge is held') && plan.includes('Rollback:')
  && scorecard.includes('Stage 9 manual protocol'));
check('the Level 2 backlog is written down',
  scorecard.includes('## Level 2 backlog') && scorecard.includes('| Medium |'));

console.log('');
if (fails) { console.log(`${fails} check(s) failed`); process.exit(1); }
console.log('ALL CHECKS PASSED');
