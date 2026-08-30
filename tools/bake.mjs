#!/usr/bin/env node
/* ============================================================================
   bake.mjs — produce a single self-contained HTML file.

   WHY THIS EXISTS
   v9's best property was that you could double-click index.html and the whole
   app worked, offline, with no server. v10 is built from ES modules, and
   browsers refuse to load ES modules over file:// (they are fetched, and
   file:// fetches are cross-origin-null). fetch() for /data/*.json is blocked
   there too.

   Losing that would be a real regression, so it is restored here instead: this
   script inlines the stylesheets, bundles the module graph into one classic
   script, and embeds the knowledge base as a JSON blob the loader reads
   instead of fetching. The output opens from a USB stick.

       node tools/bake.mjs                  -> dist/almanac.html
       node tools/bake.mjs --with-state f.json  also bakes in a data backup

   The bundler is deliberately tiny — about 120 lines — because this codebase
   uses only static imports with no cycles and no default exports, which is a
   constraint worth keeping precisely so this file can stay small.
   ========================================================================== */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = 'src/main.js';
const OUT_DIR = resolve(ROOT, 'dist');

const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');
const rel = (abs) => relative(ROOT, abs).split('\\').join('/');

/* ==========================================================================
   1. Walk the module graph
   ========================================================================== */

const IMPORT_RE = /^[ \t]*import\s+(?:([\w$]+)\s*,\s*)?(?:(\*\s*as\s+[\w$]+)|(\{[\s\S]*?\}))?\s*from\s*['"]([^'"]+)['"];?[ \t]*$/gm;
const BARE_IMPORT_RE = /^[ \t]*import\s*['"]([^'"]+)['"];?[ \t]*$/gm;

const modules = new Map();   // rel path -> { source, deps }
const order = [];
const visiting = new Set();

function resolveSpec(fromRel, spec) {
  if (!spec.startsWith('.')) throw new Error(`bare specifier "${spec}" in ${fromRel} — the bundler only handles relative paths`);
  return rel(resolve(dirname(resolve(ROOT, fromRel)), spec));
}

function walk(modRel) {
  if (modules.has(modRel)) return;
  if (visiting.has(modRel)) {
    throw new Error(`import cycle reaching ${modRel}. The bundler is intentionally cycle-free; break the cycle rather than growing this script.`);
  }
  visiting.add(modRel);

  const source = read(modRel);
  const deps = [];

  for (const m of source.matchAll(IMPORT_RE)) deps.push(resolveSpec(modRel, m[4]));
  for (const m of source.matchAll(BARE_IMPORT_RE)) deps.push(resolveSpec(modRel, m[1]));

  for (const dep of deps) walk(dep);

  visiting.delete(modRel);
  modules.set(modRel, { source, deps });
  order.push(modRel);           // post-order = dependencies first
}

walk(ENTRY);

/* ==========================================================================
   2. Rewrite each module into a factory
   ========================================================================== */

function transform(modRel, source) {
  const exported = [];          // [exportedName, localName]

  let out = source;

  /* --- imports ---------------------------------------------------------- */
  out = out.replace(IMPORT_RE, (full, def, star, named, spec) => {
    const target = resolveSpec(modRel, spec);
    const req = `__req(${JSON.stringify(target)})`;
    const parts = [];
    if (star) parts.push(`const ${star.replace(/\*\s*as\s*/, '')} = ${req};`);
    if (named) {
      /* { a, b as c } -> { a, b: c } */
      const inner = named.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean)
        .map((s) => {
          const m = /^(\S+)\s+as\s+(\S+)$/.exec(s);
          return m ? `${m[1]}: ${m[2]}` : s;
        }).join(', ');
      parts.push(`const { ${inner} } = ${req};`);
    }
    if (def) parts.push(`const ${def} = ${req}.default;`);
    if (!parts.length) parts.push(`${req};`);
    return parts.join(' ');
  });

  out = out.replace(BARE_IMPORT_RE, (full, spec) => `__req(${JSON.stringify(resolveSpec(modRel, spec))});`);

  /* --- export { a, b as c } --------------------------------------------- */
  out = out.replace(/^[ \t]*export\s*\{([\s\S]*?)\};?[ \t]*$/gm, (full, inner) => {
    for (const piece of inner.split(',').map((s) => s.trim()).filter(Boolean)) {
      const m = /^(\S+)\s+as\s+(\S+)$/.exec(piece);
      if (m) exported.push([m[2], m[1]]);
      else exported.push([piece, piece]);
    }
    return '';
  });

  /* --- export const/let/var/function/class ------------------------------ */
  out = out.replace(/^([ \t]*)export\s+(async\s+function|function|class|const|let|var)\s+([\w$]+)/gm,
    (full, indent, kind, name) => {
      exported.push([name, name]);
      return `${indent}${kind} ${name}`;
    });

  if (/^\s*export\s+default/m.test(out)) {
    throw new Error(`${modRel} uses "export default" — the bundler does not handle it, and this codebase does not need it.`);
  }
  if (/^\s*export\s/m.test(out)) {
    throw new Error(`${modRel} has an export form the bundler does not recognise. Check it by hand.`);
  }

  const assignments = exported.length
    ? `\n__exports(${JSON.stringify(modRel)}, { ${exported.map(([name, local]) =>
        (name === local ? name : `${name}: ${local}`)).join(', ')} });\n`
    : '';

  return `/* ${modRel} */\n__define(${JSON.stringify(modRel)}, function (__req, __exports) {\n${out}\n${assignments}});\n`;
}

const bundleBody = order.map((m) => transform(m, modules.get(m).source)).join('\n');

const RUNTIME = `
(function () {
  var __factories = {}, __cache = {};
  function __define(id, fn) { __factories[id] = fn; }
  function __exportsFor(id, obj) { Object.assign(__cache[id], obj); }
  function __req(id) {
    if (__cache[id]) return __cache[id];
    var exp = __cache[id] = {};
    var fn = __factories[id];
    if (!fn) throw new Error('module not bundled: ' + id);
    fn(__req, __exportsFor);
    return exp;
  }
`;

/* ==========================================================================
   3. Assemble the page
   ========================================================================== */

const html = read('index.html');

/* Inline every stylesheet, in the order the page declares them. */
const cssFiles = [...html.matchAll(/<link rel="stylesheet" href="(src\/[^"]+)">/g)].map((m) => m[1]);
const css = cssFiles.map((f) => `/* ===== ${f} ===== */\n${read(f)}`).join('\n');

/* Embed the knowledge base so nothing has to be fetched. */
const DATA_FILES = ['catalogue', 'orchard', 'zones', 'seeds', 'mushrooms',
  'feed', 'soil', 'climate', 'sources', 'care', 'prose'];
const baked = Object.fromEntries(DATA_FILES.map((n) => [n, JSON.parse(read(`data/${n}.json`))]));

/* Optionally bake in a state backup, the way v9's "bake into this file" did. */
const stateArgIdx = process.argv.indexOf('--with-state');
let bakedState = null;
if (stateArgIdx > -1 && process.argv[stateArgIdx + 1]) {
  const payload = JSON.parse(readFileSync(process.argv[stateArgIdx + 1], 'utf8'));
  bakedState = payload.state || payload;
}

const themeBoot = read('src/ui/theme-boot.js');

/* Every splice below uses a FUNCTION replacer, never a replacement string.
   A replacement string re-interprets $$, $&, $1 … — and dom.js exports `$$`,
   so a string replacer silently rewrote `const $$ =` to `const $ =` and the
   whole bundle stopped parsing with a duplicate-declaration error. The bug is
   invisible in the source and only shows up in the built artefact, which is
   exactly why the parse check below exists too. */
const insert = (s) => () => s;

const dataScript = `<script id="baked-data" type="application/json">${JSON.stringify(baked).replace(/</g, '\\u003c')}</script>`;
const stateScript = bakedState
  ? `\n<script id="baked-state" type="application/json">${JSON.stringify(bakedState).replace(/</g, '\\u003c')}</script>`
  : '';
const appScript = `<script>\n${RUNTIME}\n${bundleBody}\n  __req(${JSON.stringify(ENTRY)});\n})();\n</script>`;

let out = html
  .replace(/<link rel="stylesheet" href="src\/[^"]+">\s*/g, '')
  .replace(/<script src="src\/ui\/theme-boot\.js"><\/script>/,
    insert(`<style>\n${css}\n</style>\n<script>\n${themeBoot}\n</script>`))
  .replace(/<script type="module" src="src\/main\.js"><\/script>/,
    insert(`${dataScript}${stateScript}\n${appScript}`));

/* Parse check. new Function compiles without executing, so this catches a
   malformed bundle here rather than on the user's laptop. */
try {
  // eslint-disable-next-line no-new-func
  new Function(`${RUNTIME}\n${bundleBody}\n})();`);
} catch (err) {
  console.error('\nThe generated bundle does not parse:\n  ' + err.message);
  process.exit(1);
}

/* The loader must read the embedded blob rather than fetch(). data.js checks
   for this global first — see loadAll(). */
out = out.replace('<body>', insert(`<body>
<!-- Baked build: the knowledge base is embedded below, so nothing is fetched
     and this file works from file:// with no server. -->`));

mkdirSync(OUT_DIR, { recursive: true });
const outPath = join(OUT_DIR, 'almanac.html');
writeFileSync(outPath, out);

console.log(`modules bundled : ${order.length}`);
console.log(`stylesheets     : ${cssFiles.length}`);
console.log(`knowledge base  : ${DATA_FILES.length} bundles`);
console.log(`state baked in  : ${bakedState ? 'yes' : 'no'}`);
console.log(`output          : ${rel(outPath)}  (${Math.round(out.length / 1024)} KB)`);
