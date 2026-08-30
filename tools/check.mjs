#!/usr/bin/env node
/* ============================================================================
   check.mjs — the smoke test.

   Two halves:

     STATIC   every relative import in src/ resolves to a file that exists, and
              every named import corresponds to something that file actually
              exports. This catches the class of bug that a bundler would catch
              and a bundler-free setup would otherwise only find at runtime,
              on a phone, in a garden.

     BEHAVIOUR  the engines are pure functions with no DOM, so they can be
              exercised directly. The assertions below are the horticultural
              claims the app makes; if one breaks, the app is lying to its user.

   Run: npm run check
   ========================================================================== */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, relative, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
let checks = 0;

function ok(label, condition, detail = '') {
  checks++;
  if (condition) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.log(`  ✗ ${label}${detail ? '  — ' + detail : ''}`);
}

const near = (a, b, tol, label) => ok(label, Math.abs(a - b) <= tol, `got ${a}, expected ${b} ±${tol}`);

/* ==========================================================================
   STATIC — imports resolve, and names exist
   ========================================================================== */

function walkDir(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkDir(full, out);
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
}

const IMPORT_RE = /import\s+(?:([\w$]+)\s*,\s*)?(?:(\*\s*as\s+[\w$]+)|(\{[\s\S]*?\}))?\s*from\s*['"]([^'"]+)['"]/g;
const EXPORT_NAMED = /export\s+(?:async\s+function|function|class|const|let|var)\s+([\w$]+)/g;
const EXPORT_LIST = /export\s*\{([\s\S]*?)\}/g;

function exportsOf(file) {
  const src = readFileSync(file, 'utf8');
  const names = new Set();
  for (const m of src.matchAll(EXPORT_NAMED)) names.add(m[1]);
  for (const m of src.matchAll(EXPORT_LIST)) {
    for (const piece of m[1].split(',').map((s) => s.trim()).filter(Boolean)) {
      const as = /^(\S+)\s+as\s+(\S+)$/.exec(piece);
      names.add(as ? as[2] : piece);
    }
  }
  return names;
}

console.log('\nSTATIC — module graph');
const files = walkDir(resolve(ROOT, 'src'));
const exportCache = new Map();

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(IMPORT_RE)) {
    const spec = m[4];
    if (!spec.startsWith('.')) continue;
    const target = resolve(dirname(file), spec);
    const shortFrom = relative(ROOT, file);
    const shortTo = relative(ROOT, target);

    if (!existsSync(target)) {
      failures++; checks++;
      console.log(`  ✗ ${shortFrom} imports missing ${shortTo}`);
      continue;
    }
    if (!exportCache.has(target)) exportCache.set(target, exportsOf(target));
    const available = exportCache.get(target);

    if (m[3]) {
      for (const piece of m[3].slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean)) {
        const name = (/^(\S+)\s+as\s+/.exec(piece) || [, piece])[1];
        checks++;
        if (!available.has(name)) {
          failures++;
          console.log(`  ✗ ${shortFrom} imports { ${name} } from ${shortTo}, which does not export it`);
        }
      }
    }
  }
}
ok(`${files.length} modules scanned, all relative imports resolve`, true);

/* Every module listed in the service worker shell must exist, or the PWA
   installs a broken cache. */
console.log('\nSTATIC — service worker manifest');
const swSrc = readFileSync(resolve(ROOT, 'sw.js'), 'utf8');
const listed = [...swSrc.matchAll(/'\.\/(src\/[^']+|data\/[^']+)'/g)].map((m) => m[1]);
const missingFromDisk = listed.filter((p) => !existsSync(resolve(ROOT, p)));
ok(`${listed.length} precached paths all exist`, missingFromDisk.length === 0, missingFromDisk.join(', '));

const srcOnDisk = files.map((f) => relative(ROOT, f).split('\\').join('/'));
const notListed = srcOnDisk.filter((p) => !listed.includes(p));
ok('every src/ module is precached', notListed.length === 0, notListed.join(', '));

const load = (p) => import(pathToFileURL(resolve(ROOT, p)).href);
const json = (p) => JSON.parse(readFileSync(resolve(ROOT, p), 'utf8'));

/* ==========================================================================
   CONTENT COVERAGE
   ==========================================================================
   The assertions that would have caught the v10 rebuild's real failure.

   The first pass extracted 245 KB of data faithfully and then rendered about
   three quarters of it. Twenty-five blocks — the audited cherry-tomato list,
   the deficiency guide, the gear checklist, the acclimation ladder — sat in
   data/*.json reaching no screen at all, while 438 tests passed. Extraction
   was tested; arrival was not.

   Three checks close that gap:
     1. every data block is rendered, or is on an explicit superseded list;
     2. every prose block with content is rendered;
     3. every block is referenced through the bundle it actually lives in,
        which is what would have caught OYEAR (the orchard's calendar) being
        filed under mushrooms and printed as raw JSON.
   ========================================================================== */

console.log('\nCOVERAGE — is the content actually on a screen?');

/* Superseded, with the reason. Anything not here must be rendered. */
const SUPERSEDED = {
  'climate.json:ROOM_BUMP': 'replaced by heat.ZONE_MODEL.indoor, which models the room per season rather than by a flat monthly bump',
  'feed.json:PHBANDS': 'replaced by engine/feed.js PH_BANDS, which adds the fly-ash band and the lock-out thresholds',
  'orchard.json:WSEASON': 'replaced by water.SEASONS, which carries the month indices as well as the labels',
  'care.json:COMFORT': 'folded into every catalogue row as tmin/tmax/hmin/hmax at extraction time',
  'care.json:COMFORT_X': 'same — the per-species overrides are already applied in catalogue.json'
};

const srcFiles = files.map((f) => ({ path: relative(ROOT, f).split('\\').join('/'), text: readFileSync(f, 'utf8') }));
const allSrc = srcFiles.map((f) => f.text).join('\n');

const dataFiles = readdirSync(resolve(ROOT, 'data')).filter((f) => f.endsWith('.json'));
const orphans = [];
const misplaced = [];
let covered = 0;

for (const file of dataFiles) {
  if (file === 'prose.json') continue;
  const payload = json(`data/${file}`);
  for (const key of Object.keys(payload)) {
    const id = `${file}:${key}`;
    if (SUPERSEDED[id]) continue;

    /* Match a PROPERTY ACCESS, not a bare word. `const BUNDLES = [...]` in
       core/data.js is not a reference to sources.json's BUNDLES, and matching
       bare identifiers hid exactly that for a whole rebuild. */
    const access = new RegExp('\\.' + key + '\\b');
    const users = srcFiles.filter((f) => access.test(f.text));
    if (!users.length) { orphans.push(id); continue; }
    covered++;

    /* And it must be reached through the bundle it lives in. */
    const bundle = file.replace('.json', '');
    const qualified = new RegExp('DB\\.' + bundle + '\\.' + key + '\\b');
    const wrongBundle = new RegExp('DB\\.(?!' + bundle + '\\b)[a-z]+\\.' + key + '\\b');
    if (!qualified.test(allSrc) && wrongBundle.test(allSrc)) misplaced.push(id);
  }
}

ok(`${covered} data blocks are rendered somewhere`, orphans.length === 0,
  orphans.length ? 'never rendered: ' + orphans.join(', ') : '');
ok('every data block is read from the bundle it lives in', misplaced.length === 0,
  misplaced.join(', '));
ok(`${Object.keys(SUPERSEDED).length} superseded blocks each carry a stated reason`,
  Object.values(SUPERSEDED).every((r) => typeof r === 'string' && r.length > 20));

/* ---- prose ----
   Superseded blocks are v9's own form chrome, which v10 re-implements as real
   components. Each still needs a stated reason, so "we rebuilt the widget" can
   never quietly become "we lost the paragraph". */
const PROSE_SUPERSEDED = {
  'today/outdoors': 'cross-link cards into the Orchard and Zones screens; v10 has a persistent nav that does this',
  'catalogue/catalogue': 'the filter bar\'s own labels; v10 renders its own filters from the catalogue, with live counts',
  'bags/mix-calculator': 'the calculator form controls; v10 rebuilds them and scales amendments to the bag, which v9 did not',
  'feed/dose-calculator': 'the dose form, plus a rule v10 deliberately supersedes: v9 fed at "about 3% of bag volume" at label concentration, which under-delivers nitrogen while concentrating salt. engine/feed.js doses per 10 L of substrate and dissolves it in a full soak instead — see the PRODUCTS comment there'
};

const proseDoc = json('data/prose.json');
const proseOrphans = [];
let proseCovered = 0;
let proseEmpty = 0;

for (const [view, blocks] of Object.entries(proseDoc)) {
  for (const block of blocks) {
    /* A block whose body is empty was only ever a heading v10 re-authored. */
    if ((block.chars || 0) < 40) { proseEmpty++; continue; }
    if (PROSE_SUPERSEDED[`${view}/${block.slug}`]) continue;
    /* Must appear inside a prose call, not merely somewhere in the source —
       the slug "catalogue" matches half the codebase as a bare string. */
    const called = new RegExp("prose(?:Section|Html)?\\([^)]*['\"]" + block.slug + "['\"]");
    if (called.test(allSrc)) proseCovered++;
    else proseOrphans.push(`${view}/${block.slug}`);
  }
}

ok(`${proseCovered} prose blocks are rendered`, proseOrphans.length === 0,
  proseOrphans.length ? 'never rendered: ' + proseOrphans.join(', ') : '');
ok(`${proseEmpty} heading-only blocks correctly need no rendering`, true);

/* Mount markers must be filled by whoever renders the block. */
const unfilledMounts = [];
for (const [view, blocks] of Object.entries(proseDoc)) {
  for (const block of blocks) {
    if ((block.chars || 0) < 40) continue;
    if (PROSE_SUPERSEDED[`${view}/${block.slug}`]) continue;
    for (const m of block.html.matchAll(/<!--mount:([a-zA-Z0-9_]+)-->/g)) {
      if (!allSrc.includes(m[1])) unfilledMounts.push(`${view}/${block.slug} → ${m[1]}`);
    }
  }
}
ok('every mount marker in rendered prose is filled with data',
  unfilledMounts.length === 0, unfilledMounts.join(', '));
ok(`${Object.keys(PROSE_SUPERSEDED).length} superseded prose blocks each carry a stated reason`,
  Object.values(PROSE_SUPERSEDED).every((r) => typeof r === 'string' && r.length > 20));

/* ==========================================================================
   BEHAVIOUR
   ========================================================================== */

const solar = await load('src/engine/solar.js');
const heat = await load('src/engine/heat.js');
const water = await load('src/engine/water.js');
const orchard = await load('src/engine/orchard.js');
const germ = await load('src/engine/germination.js');
const feed = await load('src/engine/feed.js');
const agenda = await load('src/engine/agenda.js');
const schema = await load('src/core/schema.js');

const climate = json('data/climate.json');
const orchardData = json('data/orchard.json');
const catalogue = json('data/catalogue.json');

console.log('\nDATA');
ok('catalogue has 225 entries', catalogue.catalogue.length === 225, `got ${catalogue.catalogue.length}`);
ok('every catalogue key is unique — nothing can reference the wrong plant',
  new Set(catalogue.catalogue.map((p) => p.key)).size === catalogue.catalogue.length);
ok('the five v9 duplicate rows are disambiguated and labelled',
  catalogue.catalogue.filter((p) => p.dupOf).length === 5);
ok('8 orchard trees', orchardData.ORCHARD.length === 8);
ok('12 months of climate data', climate.ANGUL.length === 12);

console.log('\nSOLAR — the fact the whole site rests on');
const june = new Date(2026, 5, 21);
const dec = new Date(2026, 11, 21);
near(solar.noonAltitude(june), 87.5, 1.2, 'June noon sun within 2.5° of vertical');
near(solar.noonAltitude(dec), 45.6, 1.2, 'December noon sun sits at ~45°');
near(solar.dayLength(june).hours, 13.2, 0.4, 'longest day ≈ 13.2 h');
near(solar.dayLength(dec).hours, 11.0, 0.4, 'shortest day ≈ 11 h');
ok('sun is up at noon in June', solar.sunPosition(new Date(2026, 5, 21, 12)).altitude > 80);
ok('sun is below the horizon at midnight', solar.sunPosition(new Date(2026, 5, 21, 0)).altitude < 0);

const chill = solar.chillHours(climate.ANGUL);
ok(`chill hours effectively zero (got ${chill})`, chill < 60);
ok('apple ruled out on chill', solar.chillVerdict(800, chill).ok === false);

console.log('\nSOLAR — the Zone C overhang, which is the whole balcony premise');
const yearShade = solar.overhangYear(solar.BALCONY_DEFAULT, 2026);
const summerSun = yearShade[5].sunlitFraction;   // June
const winterSun = yearShade[11].sunlitFraction;  // December
ok(`June noon: balcony shaded (${Math.round(summerSun * 100)}% glass in sun)`, summerSun < 0.25);
ok(`December noon: balcony flooded (${Math.round(winterSun * 100)}% glass in sun)`, winterSun > 0.7);
ok('the calendar really does invert', winterSun - summerSun > 0.5);

console.log('\nHEAT');
const mayA = heat.zoneMonth('A', 4, climate.ANGUL);
ok(`Zone A May high is brutal (${mayA.high} °C)`, mayA.high > 44);
ok('terrace runs hotter than ground', heat.zoneMonth('B', 4, climate.ANGUL).high > mayA.high);
ok('first-floor shade runs cooler', heat.zoneMonth('D', 4, climate.ANGUL).high < mayA.high);
ok('Zone C inverts: cooler than the terrace in May',
  heat.zoneMonth('C', 4, climate.ANGUL).high < heat.zoneMonth('B', 4, climate.ANGUL).high);

const blackPot = heat.rootZoneTemp({ airHigh: mayA.high, bag: 'black-plastic', date: new Date(2026, 4, 15) });
const goodSetup = heat.rootZoneTemp({ airHigh: mayA.high, bag: 'fabric-pale', shade: '50', mulched: true, date: new Date(2026, 4, 15) });
ok(`black plastic root zone is lethal (${blackPot} °C)`, blackPot > 48);
ok(`pale bag + net + mulch is survivable (${goodSetup} °C)`, goodSetup < blackPot - 8);
ok('lethal band is reported as lethal', heat.rootZoneVerdict(blackPot).level === 4);

ok('heat index exceeds air temp in humid heat', heat.heatIndexC(40, 70) > 40);
ok('afternoon RH is well below the monthly mean', heat.daytimeRh(85, 32.5, 25.5) < 75);
ok('afternoon RH conversion is a no-op at the mean temperature',
  Math.abs(heat.daytimeRh(85, 29, 29) - 85) <= 1);
const augC = heat.zoneMonth('C', 7, climate.ANGUL);
const augHi = heat.heatIndexC(augC.high, augC.rh);
ok(`August balcony heat index is believable (${augHi} °C, not 60)`, augHi > 36 && augHi < 50);
ok('the monthly mean humidity is still reported alongside it', augC.meanRh > augC.rh);
ok('heat index past the published table is flagged', heat.heatBand(58).beyondChart === true);
ok('an ordinary heat index is not flagged', heat.heatBand(38).beyondChart === false);
ok('heat index below air temp in dry heat', heat.heatIndexC(40, 15) < 40);
ok('VPD rises as humidity falls', heat.vpd(35, 30) > heat.vpd(35, 80));

console.log('\nWATER — the v8 bug must stay fixed');
const prose = water.schedule({ base: { text: 'Rarely' }, zone: 'A', lastWatered: '2026-08-01' });
ok('prose watering rule produces NO invented schedule', prose.scheduled === false && prose.intervalDays === null);
ok('prose rule is passed through verbatim', prose.rule === 'Rarely');

const numeric = water.schedule({ base: { text: '8–12 days' }, zone: 'indoor', lastWatered: '2026-08-01' });
ok('numeric rule produces a schedule', numeric.scheduled === true && numeric.intervalDays > 0);

const mango = orchardData.ORCHARD.find((t) => t.id === 'mango');
const dry = water.schedule({ base: { seasonalDays: mango.wd }, zone: 'A', litres: 43, date: new Date(2026, 4, 1) });
const monsoon = water.schedule({ base: { seasonalDays: mango.wd }, zone: 'A', litres: 43, date: new Date(2026, 7, 1) });
ok('mango is watered more often in the dry gap than the monsoon', dry.intervalDays < monsoon.intervalDays);

const papaya = orchardData.ORCHARD.find((t) => t.id === 'papaya');
const papayaMonsoon = water.schedule({ base: { seasonalDays: papaya.wd }, zone: 'A', date: new Date(2026, 7, 1) });
ok('papaya in monsoon: no schedule, check drainage instead', papayaMonsoon.scheduled === false);

ok('terrace dries faster than shade', water.ZONE_DRY.B < water.ZONE_DRY.D);

console.log('\nORCHARD');
ok('"2–3 years" parses to a window', (() => {
  const d = orchard.parseDuration('2–3 years');
  return d && d.min === 731 && d.max === 1096;
})());
ok('"~90 days" parses', orchard.parseDuration('~90 days')?.min === 90);
ok('"8–10 months → around June 2027" parses', orchard.parseDuration(papaya.first)?.min === 244);

ok('"year 3 — final" is an age trigger flagged final', (() => {
  const t = orchard.parseBagTrigger('year 3 — final');
  return t.kind === 'age' && t.final === true && t.minDays === 1096;
})());
ok('"at ~1.5 ft" is a height trigger', orchard.parseBagTrigger('at ~1.5 ft').kind === 'height');
ok('"now" is recognised', orchard.parseBagTrigger('now').kind === 'now');

/* Every shipped tree must produce a coherent status with no throw. */
let ladderOk = true;
for (const spec of orchardData.ORCHARD) {
  const status = orchard.treeStatus(spec, null);
  if (!status.ladder.rungs.length) ladderOk = false;
  if (status.ladder.rungs.at(-1).final !== true) ladderOk = false;
}
ok('all 8 trees produce a ladder ending in a final bag', ladderOk);

/* A mango potted two years ago is overdue for its 20×20 step-up. */
const twoYearsAgo = new Date(Date.now() - 730 * 864e5).toISOString().slice(0, 10);
const lateMango = orchard.treeStatus(mango, {
  id: 'mango', acquired: twoYearsAgo, stage: 'potted', bagIdx: 0,
  bags: [{ size: '15×15', litres: '43 L', on: twoYearsAgo }], events: [], photos: [], alive: true
});
ok('an overdue step-up raises an alert', lateMango.alerts.some((a) => a.kind === 'potup'));
ok('fruiting countdown reports progress', lateMango.fruit.progress > 0.5 && lateMango.fruit.progress <= 1);

/* Root-pruning only applies once it is standing in the final bag. */
const finalBagged = orchard.treeStatus(mango, {
  id: 'mango', acquired: '2020-01-01', stage: 'growing', bagIdx: 2,
  bags: [{ size: '15×15', litres: '43 L', on: '2020-01-01' },
         { size: '20×20', litres: '100 L', on: '2021-06-01' },
         { size: '24×24', litres: '178 L', on: '2023-01-01' }],
  lastRootPrune: '2023-01-01', events: [], photos: [], alive: true
});
ok('root-prune applies in the final bag', finalBagged.prune.applicable === true);
ok('root-prune overdue after 30 months', finalBagged.prune.overdue === true);
ok('root-prune does not apply mid-ladder', lateMango.prune.applicable === false);

console.log('\nGERMINATION — thermal time, not a fixed number of days');
const chilli25 = germ.expectedDays('Chilli Bhut Jolokia', 25);
const chilli30 = germ.expectedDays('Chilli Bhut Jolokia', 30);
ok('chilli germinates faster when warmer', chilli30.days < chilli25.days);
ok(`chilli at 25 °C ≈ ${chilli25.days} days`, chilli25.days >= 6 && chilli25.days <= 10);

const chilliCold = germ.expectedDays('Chilli', 11);
ok('below base temperature there is NO estimate, and the reason is given',
  chilliCold.days === null && /does not develop/.test(chilliCold.warning));

ok('lettuce is flagged thermo-dormant when hot', /thermo-dormancy|Warmer/.test(germ.expectedDays('Lettuce Lollo Rosso', 33).warning));
ok('radish is matched to the radish profile', germ.thermalFor('Radish Pusa Chetki').key === 'radish');
ok('bhindi resolves to okra', germ.thermalFor('Bhindi').key === 'okra');

const sown = schema.newSowing({ name: 'Radish Pusa Chetki', sownOn: '2026-01-01', qtySown: 20, zone: 'C' });
const st = germ.sowingStatus(sown, 22, new Date(2026, 1, 20));
ok('a sowing that never came up is flagged', st.overdue === true && st.alerts.length > 0);

const partial = schema.newSowing({ name: 'Radish', sownOn: '2026-01-01', qtySown: 20, counts: [{ on: '2026-01-06', up: 4 }] });
const ps = germ.sowingStatus(partial, 22, new Date(2026, 0, 20));
ok('germination rate is computed', Math.abs(ps.rate - 0.2) < 0.001);
ok('low germination raises an alert', ps.alerts.some((a) => a.kind === 'germlow'));

console.log('\nFEED — the coal-ash problem');
const npk = feed.PRODUCTS.find((p) => p.id === 'npk191919');
const d = feed.dose(npk, 43, 1);
ok(`19:19:19 on a 43 L bag = ${d.grams} g in ${d.solutionLitres} L (${d.ppm.n} ppm N)`, d.grams > 5 && d.grams < 12);
ok('resulting nitrogen lands in the standard band', feed.doseVerdict(d.ppm.n).label === 'Standard');
ok('no shipped product at standard strength exceeds "strong"',
  feed.PRODUCTS.filter((p) => p.mode === 'drench')
    .every((p) => feed.doseVerdict(feed.dose(p, 43, 1).ppm.n).level <= 1));
ok('the too-strong band exists and is reachable', feed.doseVerdict(400).level === 2);
ok('concentration is independent of bag size',
  Math.abs(feed.dose(npk, 12, 1).gPerL - feed.dose(npk, 178, 1).gPerL) < 0.01);
ok('a foliar product is not bag-scaled',
  feed.dose(feed.PRODUCTS.find((p) => p.mode === 'foliar'), 43, 1).mode === 'foliar');
ok('an incorporated product prescribes no solution',
  feed.dose(feed.PRODUCTS.find((p) => p.mode === 'incorporate'), 43, 1).solutionLitres === 0);

ok('pH 8.2 is the fly-ash alkaline band', feed.phBand(8.2).key === 'severe');
ok('pH 6.2 is ideal', feed.phBand(6.2).key === 'ideal');
ok('EDTA is rejected above pH 7', feed.ironChelate(7.8).form === 'Fe-EDDHA');
ok('EDTA is fine at pH 6', feed.ironChelate(6.0).form === 'Fe-EDTA');

const sulphur = feed.sulphurDose(43, 7.8, 6.2, 'coco');
ok(`sulphur dose is a real number (${sulphur.grams} g)`, sulphur.grams > 20 && sulphur.grams < 100);
ok('terrace catches more ash drift than the closed balcony',
  feed.ashDrift({ zone: 'B' }).drift > feed.ashDrift({ zone: 'C' }).drift);
ok('mulch cuts ash drift', feed.ashDrift({ zone: 'A', covered: true }).drift < feed.ashDrift({ zone: 'A' }).drift);

ok('May says feed nothing', feed.feedGate(4).feed === false);
ok('a freshly potted plant is not fed', feed.feedGate(9, { pottedWithinDays: 5 }).feed === false);
ok('October feeds normally', feed.feedGate(9).feed === true);
ok('extreme heat suspends feeding', feed.feedGate(9, { heatIndexC: 47 }).feed === false);

console.log('\nAGENDA — the Action Desk assembles without throwing');
const DB = {
  climate, orchard: orchardData, catalogue,
  feed: json('data/feed.json'), seeds: json('data/seeds.json'),
  zones: json('data/zones.json'), soil: json('data/soil.json'),
  sources: json('data/sources.json'), care: json('data/care.json'),
  mushrooms: json('data/mushrooms.json')
};

const state = schema.freshState();
state.specimens = [schema.newSpecimen({ name: 'Peperomia', water: '8–12 days', watered: '2026-01-01' })];
state.orchard = { mango: schema.newOrchardRecord('mango', { acquired: twoYearsAgo, bags: [{ size: '15×15', litres: '43 L', on: twoYearsAgo }] }) };
state.sowings = [sown];

for (const month of [0, 4, 7, 10]) {
  const a = agenda.buildAgenda(DB, state, new Date(2026, month, 15));
  ok(`${['Jan', 'May', 'Aug', 'Nov'][[0, 4, 7, 10].indexOf(month)]}: agenda builds (${a.tasks.length} tasks)`, a.tasks.length > 0);
}

const may = agenda.buildAgenda(DB, state, new Date(2026, 4, 15));
ok('May raises a heat task', may.tasks.some((t) => t.kind === 'heat'));
ok('May tells you not to feed', may.tasks.some((t) => /Do not feed/.test(t.title)));
ok('the overdue mango step-up reaches the desk', may.tasks.some((t) => t.kind === 'potup'));
ok('every task carries a reason', may.tasks.every((t) => typeof t.why === 'string'));
ok('urgent tasks sort above the rest', (() => {
  const open = may.open;
  const rank = { hi: 0, med: 1, low: 2 };
  return open.every((t, i) => i === 0 || rank[open[i - 1].pri] <= rank[t.pri]);
})());

console.log('\nSCHEMA — migration from the v9 ledger');
const v9 = {
  theme: 'night',
  specimens: [
    { sid: 's1', idd: true, name: 'Peperomia', sp: 16, lat: 'Peperomia obtusifolia', habit: 'clump', zone: 'desk', water: '8–12 days', notes: 'Doing well.', watered: '2026-08-20' },
    { sid: 's5', idd: false, name: 'Tall one (big)', sp: null, lat: 'Zingiberaceae? — unconfirmed', habit: 'cane', zone: 'sun', water: '3–5 days', notes: 'DO THE SMELL TEST.', watered: '' }
  ],
  picks: ['a', 'b'], qty: { a: 2 }, tasks: { x: '2026-01-01' }, journal: [], runs: [],
  cloud: null, ckey: 'secret', __log: 'the log', __profile: 'the profile'
};
const migrated = schema.migrate(v9, { catalogue: catalogue.catalogue });
ok('migrates to v10', migrated.v === 10);
ok('night mode becomes dark', migrated.settings.mode === 'dark');
ok('skin defaults to jungle', migrated.settings.skin === 'jungle');
ok('numeric species index becomes a stable slug',
  migrated.specimens[0].key === catalogue.catalogue[16].key,
  `got ${migrated.specimens[0].key}`);
ok('an unidentified plant keeps a null key', migrated.specimens[1].key === null);
ok('watering history is seeded from the last watering', migrated.specimens[0].hist.length === 1);
ok('log and profile survive', migrated.log === 'the log' && migrated.profile === 'the profile');
ok('shopping list survives', migrated.picks.length === 2);
ok('new collections exist and are empty', migrated.sowings.length === 0 && migrated.readings.length === 0);
ok('migration is idempotent', JSON.stringify(schema.migrate(migrated, { catalogue: catalogue.catalogue })) === JSON.stringify(migrated));
ok('garbage normalises rather than throwing', schema.migrate({ specimens: 'nope', orchard: 5 }).specimens.length === 0);

/* ========================================================================== */
console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) { console.log(`${failures} FAILED\n`); process.exit(1); }
console.log('all good\n');
