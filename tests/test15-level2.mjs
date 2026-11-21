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

const index = read('index.html');
const homeCss = read('home/home.css');
const homeJs = read('home/home.js');
const modelsCss = read('home/models.css');
const tilt = read('TILT.html');
const editor = read('js/editor.js');
const studio = read('studio/styles.css');
const tailwind = read('css/tailwind.css');
const standalone = read('TILT.standalone.html');

// ------------------------------------------------- 1. live regions
console.log('\nlive regions: outcomes that arrive after load are announced');
check('home has a persistent polite region',
  /<div id="live" class="sr-only" role="status" aria-live="polite">/.test(index));
check('it is never toggled with [hidden] (a hidden region goes silent)',
  !/id="live"[^>]*\bhidden\b/.test(index) && !/liveEl\.hidden/.test(homeJs));
check('home.css keeps it on screen but out of view',
  /\.sr-only \{[^}]*clip-path/.test(homeCss) && /\.sr-only \{[^}]*overflow: hidden/.test(homeCss));
check('every toast is mirrored into the region',
  /function announce\(message\) \{[\s\S]{0,120}?liveEl\.textContent = message;/.test(homeJs)
  && /function toast\(message\) \{[\s\S]{0,220}?announce\(message\);/.test(homeJs));
check('the offline notice is announced when it appears',
  /notice\.hidden = false;\s*\n\s*announce\('Projects live on the server/.test(homeJs));

check('the editor has a separate polite region for save outcomes',
  /id="save-announce" class="sr-only" role="status" aria-live="polite"/.test(tilt)
  && /id="save-announce" class="sr-only" role="status" aria-live="polite"/.test(standalone));
check('the visible save status itself stays quiet (no per-cycle chatter)',
  /<span id="save-status"[^>]*(aria-live|role="status")/.test(tilt) === false);
check('going offline is announced, and so is the return from it',
  /if \(next === 'offline'\) announce\(STATUS_TEXT\.offline\);/.test(editor)
  && /else if \(was === 'offline'\) announce\(STATUS_TEXT\[next\]\);/.test(editor));
check('flash confirmations are announced',
  /function flash\(text\) \{[\s\S]{0,200}?announce\(text\);/.test(editor));
const setStatusBody = editor.slice(editor.indexOf('function setStatus'),
  editor.indexOf('// A short-lived message'));
const setStatusCalls = setStatusBody.match(/announce\(/g) || [];
check('setStatus announces only the two transitions that matter, '
  + 'never routine save cycles',
  setStatusCalls.length === 2 && !/^\s*announce\(/m.test(setStatusBody),
  String(setStatusCalls.length));
check('an older shell without the region cannot break the editor',
  /if \(announceEl\) announceEl\.textContent = text;/.test(editor));
check('the editor stylesheet actually ships the clip utility',
  tailwind.includes('.sr-only{'));

// ------------------------------------------------- 2. token bridge
console.log('\ntoken bridge: one vocabulary, mapped per page, nothing renamed');

const CANON = ['--ui-bg', '--ui-surface', '--ui-line', '--ui-line-strong',
  '--ui-text', '--ui-muted', '--ui-accent', '--ui-danger', '--ui-radius',
  '--ui-shadow', '--ui-tap', '--ui-ring'];

const surfaces = [
  ['home/home.css', homeCss],
  ['home/models.css', modelsCss],
  ['TILT.html', tilt],
  ['studio/styles.css', studio],
];

for (const [name, src] of surfaces) {
  const missing = CANON.filter(t => !src.includes(t + ':'));
  check(name + ' resolves the full canonical set', missing.length === 0,
    missing.join(' '));
}

for (const [name, src] of surfaces) {
  const refs = [...src.matchAll(/--ui-[a-z-]+:\s*var\((--[a-z0-9-]+)\)/g)]
    .map(m => m[1]);
  const unresolved = refs.filter(v => !src.includes(v + ':'));
  check(name + ' maps only onto tokens it defines itself',
    refs.length > 0 && unresolved.length === 0, unresolved.join(' '));
}

check('the shell keeps its local names (no class rewriting)',
  ['--ui-surface-2:', '--ui-ink:', '--ui-accent-soft:', '--ui-radius-sm:']
    .every(t => tilt.includes(t)));
check('each page keeps its own palette', /--bg: #f4f5f7/.test(homeCss)
  && /--text: #18181b/.test(homeCss) && /--paper:#f2f3ef/.test(studio));
check('shell text rides on its --ui-ink, backdrop on the body tone',
  tilt.includes('--ui-text: var(--ui-ink)') && tilt.includes('--ui-bg: #f3f4f6'));
check('shell ring and shadow match the rules the shell really paints',
  tilt.includes('--ui-ring: #0284c7') && tilt.includes('--ui-shadow: 0 20px 50px'));
check('home maps ring onto the colour its focus ring already uses',
  /--ui-ring: var\(--accent\)/.test(homeCss));
check('studio maps text, bg and accent onto its own tokens',
  studio.includes('--ui-text:var(--ink)') && studio.includes('--ui-bg:var(--paper)')
  && studio.includes('--ui-accent:var(--green)'));

// The aliases must live on the same element the theme flag is written to,
// so a var() on :root picks up the dark override without an extra block.
check('home declares aliases on :root while the flag lands on documentElement',
  /:root \{\n\s+--ui-bg: var\(--bg\)/.test(homeCss)
  && index.includes("classList.add('dark')"));
check('studio declares aliases on :root while the flag lands on documentElement',
  /:root\{\s*--ui-bg:var\(--paper\)/.test(studio)
  && read('studio/app.js').includes('documentElement.dataset.theme=theme'));
check('the shell declares its bridge inside the same :root as its palette',
  /--ui-tap: 44px;\s*\n(?:[^}]*\n)*?\s+--ui-bg: #f3f4f6;/.test(tilt));

// ------------------------------------------------- 3. documented contract
console.log('\ncontract: the bridge is written down where it is used');
check('home explains why the bridge exists',
  homeCss.includes('shared UI token bridge'));
check('models and studio carry the same note',
  modelsCss.includes('shared UI token bridge')
  && studio.includes('shared UI token bridge'));
check('the shell documents its three stand-ins',
  tilt.includes('Shared UI token bridge'));
check('studio is honest about the tokens it has no local equivalent for',
  studio.includes('--ui-tap states the shared 44px target'));

console.log(`\n${fails} check(s) failed`);
process.exit(fails ? 1 : 0);
