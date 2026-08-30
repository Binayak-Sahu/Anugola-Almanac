#!/usr/bin/env node
/* ============================================================================
   extract-data.mjs — one-shot migration tool.

   Lifts every horticultural data literal out of the v9 monolith
   (legacy/index-v9.html) and writes it to data/*.json. Nothing is retyped by
   hand, so nothing is lost or transcribed wrong.

   Run once:  node tools/extract-data.mjs
   Re-runnable and idempotent. Kept in the repo as the audit trail for where
   the JSON came from.
   ========================================================================== */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(ROOT, 'legacy/index-v9.html');
const OUT = resolve(ROOT, 'data');

const html = readFileSync(SRC, 'utf8');

/* The monolith has exactly two <script> blocks: the JSON memory block and the
   application. We want the second. */
const appStart = html.indexOf('<script>', html.indexOf('</script>'));
const script = html.slice(appStart + 8, html.lastIndexOf('</script>'));

/* --------------------------------------------------------------------------
   A tolerant expression scanner.

   Finds `var NAME=` then walks forward tracking bracket depth while respecting
   string literals and their escapes, stopping at the first `;` seen at depth
   zero. This survives SVG path data, apostrophes inside prose, and the
   concatenated-then-.split() form that HABIT uses.
   -------------------------------------------------------------------------- */
/* Values already lifted, so later literals can reference earlier ones
   (ART is built out of the shared POT path string, for instance). */
const SCOPE = Object.create(null);

function readVar(name) {
  if (name in SCOPE) return SCOPE[name];
  const decl = new RegExp('(?:^|\\n)var ' + name + '\\s*=');
  const m = decl.exec(script);
  if (!m) throw new Error('could not find `var ' + name + '` in the monolith');

  let i = m.index + m[0].length;
  let depth = 0;
  let quote = null;
  const start = i;

  for (; i < script.length; i++) {
    const ch = script[i];

    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '/' && script[i + 1] === '*') { i = script.indexOf('*/', i) + 1; continue; }
    if (ch === '/' && script[i + 1] === '/') { i = script.indexOf('\n', i); continue; }

    if (ch === '(' || ch === '[' || ch === '{') { depth++; continue; }
    if (ch === ')' || ch === ']' || ch === '}') { depth--; continue; }
    if (ch === ';' && depth === 0) break;
  }

  const expr = script.slice(start, i).trim();
  const names = Object.keys(SCOPE);
  // eslint-disable-next-line no-new-func
  const value = new Function(...names, 'return (' + expr + ')')(...names.map((n) => SCOPE[n]));
  SCOPE[name] = value;
  return value;
}

/* Literals that exist only to be spliced into other literals. */
readVar('POT');

const pick = (...names) => Object.fromEntries(names.map((n) => [n, readVar(n)]));

/* -------------------------------------------------------------------------- */
/* 1. Raw literals                                                            */
/* -------------------------------------------------------------------------- */
const RAW = readVar('RAW');
const XTRA = readVar('XTRA');
const HABIT = readVar('HABIT');
const SEEDS2 = readVar('SEEDS2');
const SEEDSITE = readVar('SEEDSITE');
const COMFORT = readVar('COMFORT');
const COMFORT_X = readVar('COMFORT_X');

/* -------------------------------------------------------------------------- */
/* 2. Replay the monolith's own derivation, verbatim                          */
/* -------------------------------------------------------------------------- */
const slugOf = (t) =>
  String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x';

function comfort(name, cat) {
  for (let i = 0; i < COMFORT_X.length; i++) {
    if (COMFORT_X[i][0].test(name)) return COMFORT_X[i][1];
  }
  return COMFORT[cat] || [10, 38, 30, 60];
}

/* Seed packets are folded into the catalogue as buyable entries (index.html
   line ~3370). Replayed here so the JSON is complete on its own. */
for (const s of SEEDS2) {
  if (s.skip) continue;
  XTRA.push({
    n: s.n + ' (seed)', l: 'Seed packet · ' + s.pk, c: 'seed', pl: 'sun', w: 'oct', p: s.p,
    s: ({ ob: 'OB', nl: 'NL', ni: 'NI' })[s.s] || 'NL', d: 1, wa: s.sow, sz: s.bag, t: 0,
    site: SEEDSITE[s.g] || 'C', out: 1, kind: 'seed', prop: s.sow, yrs: s.days, bagf: s.bag,
    chill: 'None', verdict: s.star ? 'yes' : 'watch', cyc: s.days + ' · ' + s.win,
    pack: s.pk, per: s.per,
    no: (s.why || '') + ' Sow: ' + s.sow + '. ' + s.per + ' per bag.'
  });
}

const XOFF = RAW.length;
for (const x of XTRA) RAW.push([x.n, x.l, x.c, x.pl, x.w, x.p, x.s, x.d, x.wa, x.sz, x.t, x.no]);

/* --------------------------------------------------------------------------
   Key uniqueness.

   v9 referenced catalogue rows by array index, so it never noticed that five
   rows collide on their name slug: Kagzi lime, Kaffir lime, Barbados cherry
   and Karonda each appear once in the houseplant list and once in the fruit
   list (differing only in capitalisation), and one untreated-beetroot seed row
   is entered twice.

   v10 references rows by key. A collision would mean pressing "I own this" on
   the fruit entry silently lights up the houseplant entry and the buy list
   double-counts. So keys are disambiguated here, deterministically: the kind
   is appended first (kagzi-lime / kagzi-lime-fruit), then a numeric suffix if
   that is still not enough. `dupOf` is kept on the row so the collision stays
   visible rather than being papered over.
   -------------------------------------------------------------------------- */
const usedKeys = new Set();
const collisions = [];

function uniqueKey(base, kind) {
  if (!usedKeys.has(base)) { usedKeys.add(base); return { key: base, dupOf: null }; }
  collisions.push(base);
  let candidate = `${base}-${kind}`;
  let n = 2;
  while (usedKeys.has(candidate)) candidate = `${base}-${kind}-${n++}`;
  usedKeys.add(candidate);
  return { key: candidate, dupOf: base };
}

const catalogue = RAW.map((r, i) => {
  const c = comfort(r[0], r[2]);
  const b = {
    i, key: slugOf(r[0]), name: r[0], lat: r[1], cat: r[2], place: r[3], when: r[4],
    price: r[5], src: r[6], diff: r[7], water: r[8], size: r[9], tox: r[10], note: r[11],
    habit: HABIT[i] || 'clump',
    tmin: c[0], tmax: c[1], hmin: c[2], hmax: c[3]
  };
  const x = XTRA[i - XOFF];
  if (x) {
    Object.assign(b, {
      out: 1, site: x.site, kind: x.kind, prop: x.prop, yrs: x.yrs, bagf: x.bagf,
      chill: x.chill, verdict: x.verdict, cyc: x.cyc || '', pack: x.pack || '', per: x.per || '',
      tmin: null, tmax: null, hmin: null, hmax: null
    });
  } else {
    b.kind = 'house';
  }

  const { key, dupOf } = uniqueKey(b.key, b.kind);
  b.key = key;
  if (dupOf) b.dupOf = dupOf;
  return b;
});

/* -------------------------------------------------------------------------- */
/* 3. Bundles, grouped by the screen that consumes them                       */
/* -------------------------------------------------------------------------- */
const bundles = {
  /* ART and HABIT_LBL are the catalogue's habit illustrations, keyed by the
     `habit` field on every row. They were filed under care.json in the first
     pass, which is why nothing rendered them. */
  'catalogue.json': { catalogue, ...pick('ART', 'HABIT_LBL') },
  /* OYEAR is the ORCHARD year — 'Root-prune woody pots', 'Shade net UP',
     'Buy grafted now'. It sits next to the mushroom literals in the v9 source,
     which is how it first got filed under mushrooms; index.html:1675 puts it
     squarely inside <section id="v-orchard">. */
  /* OG is the orchard's glyph set, keyed by the `g` field on every tree. */
  'orchard.json': pick('ORCHARD', 'POTPLAN', 'WSEASON', 'OYEAR', 'OG'),
  'zones.json': pick('ZONES', 'ACCLIM'),
  'seeds.json': pick('SEEDS2', 'SEEDGRP', 'SITELBL', 'CHERRY', 'TOMSTEP', 'UPG', 'SRC2'),
  'mushrooms.json': pick('SHROOMS', 'RUNPLAN'),
  'feed.json': pick('FEEDS', 'DEFIC', 'NPKS', 'ORGIN', 'PHBANDS', 'FEEDCAL', 'FEEDDONT', 'SALT'),
  'soil.json': pick('MIXES', 'COMP', 'POTTYPES', 'POTSIZES', 'BAGTYPES', 'BAGSIZES', 'OMIX'),
  'climate.json': pick('ANGUL', 'RECORD', 'ROOM_BUMP'),
  'sources.json': pick('SRC', 'GEAR', 'BUNDLES', 'CAL'),
  'care.json': { ...pick('SYMPTOMS', 'ROOMS', 'IDQ'), COMFORT }
};

/* COMFORT_X keys are RegExp literals — JSON can't hold them. Store the source
   so the runtime can rebuild them with new RegExp(). */
bundles['care.json'].COMFORT_X = COMFORT_X.map(([re, val]) => [re.source, re.flags, val]);

mkdirSync(OUT, { recursive: true });
let total = 0;
for (const [file, payload] of Object.entries(bundles)) {
  const json = JSON.stringify(payload, null, 1);
  writeFileSync(resolve(OUT, file), json + '\n');
  total += json.length;
  const rows = Object.entries(payload)
    .map(([k, v]) => k + ':' + (Array.isArray(v) ? v.length : Object.keys(v || {}).length))
    .join(' ');
  console.log(String(Math.round(json.length / 1024)).padStart(5) + ' KB  ' + file.padEnd(18) + rows);
}
console.log('\n' + catalogue.length + ' catalogue entries · ' + Math.round(total / 1024) + ' KB total');
if (collisions.length) {
  console.log('\n' + collisions.length + ' key collision(s) disambiguated — these are duplicate rows in the v9 data:');
  for (const c of collisions) console.log('  · ' + c);
}

/* ==========================================================================
   4. PROSE
   ==========================================================================
   The pass that was missing, and the reason a quarter of v9 never reached a
   v10 screen: `readVar` lifts JavaScript literals, and roughly 30 KB of the
   almanac was never a literal. It was written straight into the markup —
   31 callouts and 51 list items carrying most of the actual teaching
   ("Why not air conditioning", "The coal-belt problem", the seed-starting
   mix rules, the basket worth ordering).

   v9's markup is regular enough to walk mechanically. Every screen is a
   <section class="view" id="v-NAME">, and every block inside it is a
   <div class="sec"> with an optional <div class="sec-h"> carrying its
   heading. So: split by section, walk balanced <div class="sec"> regions,
   pull the heading apart from the body, and drop the empty elements that
   were only ever JavaScript mount points.

   Lifting verbatim rather than retyping is the whole point — the wording is
   provably unchanged, and tools/check.mjs can then assert every block
   reaches a screen.
   ========================================================================== */

const bodyStart = html.indexOf('<body>');
const bodyHtml = html.slice(bodyStart, appStart);

/** Walk balanced <div …> regions starting at `from`, return the end index. */
function matchDiv(src, from) {
  const tag = /<(\/?)div\b[^>]*?(\/?)>/g;
  tag.lastIndex = from;
  let depth = 0;
  let m;
  while ((m = tag.exec(src))) {
    if (m[2] === '/') continue;             // self-closing, ignore
    depth += m[1] ? -1 : 1;
    if (depth === 0) return tag.lastIndex;
  }
  return src.length;
}

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
  '&nbsp;': ' ', '&ndash;': '\u2013', '&mdash;': '\u2014', '&times;': '\u00d7',
  '&deg;': '\u00b0', '&hellip;': '\u2026', '&rsquo;': '\u2019', '&middot;': '\u00b7' };
const deent = (s) => String(s).replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e] ?? e);
const stripTags = (s) => deent(String(s).replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

const proseSlug = (t) => slugOf(stripTags(t)).slice(0, 60);

function extractProse() {
  const out = {};
  const sectionRe = /<section class="view[^"]*" id="v-([a-z]+)">/g;
  let s;

  while ((s = sectionRe.exec(bodyHtml))) {
    const view = s[1];
    /* The section ends where the next one begins, or at the closing tag. */
    sectionRe.lastIndex = s.index + s[0].length;
    const nextIdx = bodyHtml.indexOf('<section class="view', sectionRe.lastIndex);
    const end = nextIdx === -1 ? bodyHtml.length : nextIdx;
    const chunk = bodyHtml.slice(sectionRe.lastIndex, end);

    const blocks = [];
    const secRe = /<div class="sec">/g;
    let b;
    while ((b = secRe.exec(chunk))) {
      const blockEnd = matchDiv(chunk, b.index);
      let inner = chunk.slice(b.index + b[0].length, blockEnd - '</div>'.length);
      secRe.lastIndex = blockEnd;

      /* Heading, sub-heading and eyebrow, wherever they sit. */
      const secH = /<div class="sec-h">([\s\S]*?)<\/div>/.exec(inner);
      const headSrc = secH ? secH[1] : inner;
      const headMatch = /<h[234][^>]*>([\s\S]*?)<\/h[234]>/.exec(headSrc);
      const heading = headMatch ? headMatch[1] : '';
      const sub = (/<span class="sub[^"]*">([\s\S]*?)<\/span>/.exec(headSrc) || [, ''])[1];
      const eyebrow = (/<p class="eyebrow">([\s\S]*?)<\/p>/.exec(inner) || [, ''])[1];
      const lede = (/<p class="lede">([\s\S]*?)<\/p>/.exec(inner) || [, ''])[1];

      /* Remove the heading furniture from the body — the view re-renders it
         with v10's own section() component.

         Only ever remove the block's OWN heading. Stripping "the first h3"
         unconditionally silently ate "Getting spawn", which is a nested
         heading inside the mushroom room-sharing block, not that block's
         title. Remove exactly the matched string, exactly once. */
      if (secH) {
        inner = inner.replace(secH[0], '');
      } else if (headMatch) {
        inner = inner.replace(headMatch[0], '');
      }
      inner = inner
        .replace(/<p class="eyebrow">[\s\S]*?<\/p>/, '')
        .replace(/<p class="lede">[\s\S]*?<\/p>/, '');

      /* Empty elements carrying an id were JavaScript mount points. Replace
         each with a marker rather than deleting it: position carries meaning.
         In the cherry-tomato block the list sits BETWEEN the warning and the
         footnote, and dropping it outright would silently reorder the page. */
      const mounts = [];
      inner = inner.replace(
        /<(div|span|table|tbody|form|ul|ol)([^>]*?)id="([^"]+)"([^>]*?)>\s*<\/\1>/g,
        (full, tag, pre, id) => { mounts.push(id); return `<!--mount:${id}-->`; }
      );
      /* Any remaining id is on a wrapper we keep; note it but leave it. */
      for (const m of inner.matchAll(/id="([a-zA-Z0-9_]+)"/g)) mounts.push(m[1]);

      const htmlBody = inner.replace(/\s+/g, ' ').trim();
      const text = stripTags(htmlBody);

      /* A block with no heading and no surviving prose was pure scaffolding. */
      if (!heading && !text && !eyebrow && !lede) continue;

      blocks.push({
        slug: proseSlug(heading || eyebrow || 'block-' + blocks.length),
        heading: stripTags(heading),
        sub: stripTags(sub),
        eyebrow: stripTags(eyebrow),
        lede: stripTags(lede),
        html: htmlBody,
        mounts,
        chars: text.length
      });
    }

    /* Slugs must be unique within a view — they are the handle a view uses. */
    const seen = new Set();
    for (const blk of blocks) {
      let slug = blk.slug || 'block';
      let n = 2;
      while (seen.has(slug)) slug = `${blk.slug}-${n++}`;
      seen.add(slug);
      blk.slug = slug;
    }

    out[view] = blocks;
  }
  return out;
}

const prose = extractProse();

/* The Memory screen was all forms and dialogs, rebuilt wholesale as
   views/settings.js. Its markup carries nothing worth lifting. */
delete prose.memory;

bundles['prose.json'] = prose;

{
  const json = JSON.stringify(prose, null, 1);
  writeFileSync(resolve(OUT, 'prose.json'), json + '\n');
  const blocks = Object.values(prose).reduce((a, v) => a + v.length, 0);
  const chars = Object.values(prose).flat().reduce((a, b) => a + b.chars, 0);
  console.log('\n' + String(Math.round(json.length / 1024)).padStart(5)
    + ' KB  prose.json        ' + blocks + ' blocks across '
    + Object.keys(prose).length + ' views · ' + Math.round(chars / 1024) + ' KB of prose');
  for (const [view, blks] of Object.entries(prose)) {
    console.log('        v-' + view.padEnd(10) + blks.map((b) => b.slug).join(', '));
  }
}
