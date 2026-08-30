/* ============================================================================
   views/shrooms.js — the mushroom bench.

   Mushrooms are the one crop on this site where the hot season is an advantage
   rather than a problem: milky and paddy straw both want the temperatures that
   kill everything else. The bench belongs in Zone E, the closed parking, which
   is too dark to grow anything green and exactly right for this.

   Each species carries its own temperature window, so the grid can say plainly
   which ones can be spawned this month and which cannot.
   ========================================================================== */

import { esc, mount, on } from '../core/dom.js';
import { MON, MONFULL } from '../core/util.js';
import { DB, proseHtml, prose } from '../core/data.js';
import { zoneMonth } from '../engine/heat.js';
import { section, chip, facts, yearStrip, stressColors, stepper, empty } from '../ui/components.js';

let FILTER = 'all';
let OPEN = '';

/** Bench temperature: Zone E, mid-way between day high and night low. */
function benchTemp(month) {
  const z = zoneMonth('E', month, DB.climate.ANGUL);
  return Math.round(((z.high + z.low) / 2) * 10) / 10;
}

/** Can this species be spawned in this month? */
function monthFit(sp, month) {
  const t = benchTemp(month);
  const [lo, hi] = sp.ts || [20, 30];
  if (t >= lo && t <= hi) return 2;                       // ideal
  if (t >= lo - 3 && t <= hi + 3) return 1;               // workable
  return 0;                                              // no
}

export function renderShrooms() {
  const month = new Date().getMonth();
  const all = DB.mushrooms.SHROOMS;
  const list = FILTER === 'all' ? all : all.filter((s) => s.verdict === FILTER);

  mount('v-shrooms', `
    <div class="sec">
      <div class="eyebrow">Zone E · closed parking · ${benchTemp(month)} °C on the bench</div>
      <h1 style="margin:4px 0 6px">Mushrooms</h1>
      <p class="lede">
        The one crop here that likes the heat. Paddy straw is free around Talcher after harvest,
        and the nearest spawn is KVK Angul, then OUAT Bhubaneswar about 150 km away — which makes
        spawn availability, not skill, the thing that decides what you can grow.
      </p>
    </div>

    ${proseSection('fourteen-mushrooms-one-hot-room')}
    ${proseSection('right-now', { shroomnow: spawnNow(month) })}

    <div class="sec">
      <div class="row" style="margin-bottom:12px">
        ${[['all', 'All'], ['yes', 'Works here'], ['watch', 'With a catch'], ['no', 'Ruled out']]
          .map(([k, l]) => `<button class="chip ${FILTER === k ? 'on' : ''}" data-act="shfilter" data-k="${k}">${l}</button>`).join('')}
      </div>
      <div class="grid g2">${list.map((sp) => card(sp, month)).join('')}</div>
    </div>

    ${section('The bench year', benchYear(), { eyebrow: 'What can be spawned, month by month' })}
    ${section('Starting a run', runPlan(), { eyebrow: 'One bag, not five' })}
    ${proseSection('sharing-an-enclosed-room-with-plants')}
  `);
}

/* ------------------------------------------------------------------------- */

function spawnNow(month) {
  const ready = DB.mushrooms.SHROOMS.filter((s) => s.verdict !== 'no' && monthFit(s, month) === 2);
  if (!ready.length) {
    return empty(`Nothing sits in its ideal band at ${benchTemp(month)} °C. Wait, or run a species at the edge of its range and accept a slower colonisation.`);
  }
  return `<div class="row">${ready.map((s) =>
    `<button class="chip tone-ok" data-act="shopen" data-k="${esc(s.k)}"><i class="dotc"></i>${esc(s.name)}</button>`).join('')}</div>
    <p class="subtle" style="margin-top:10px">
      Spawn rate is 2–5% of wet substrate weight. Buy fresh — spawn more than about six weeks old
      colonises slowly enough that contamination usually wins the race.
    </p>`;
}

function card(sp, month) {
  const tone = { yes: 'ok', watch: 'watch', no: 'no' }[sp.verdict] || '';
  const fits = Array.from({ length: 12 }, (_, m) => monthFit(sp, m));
  const open = OPEN === sp.k;

  return `
  <article class="card">
    <div class="spread" style="align-items:flex-start">
      <div style="min-width:0">
        <h3>${esc(sp.name)}</h3>
        <div class="subtle" style="font-style:italic">${esc(sp.latin)}${sp.odia ? ' · ' + esc(sp.odia) : ''}</div>
      </div>
      ${chip({ yes: 'Works here', watch: 'With a catch', no: 'Ruled out' }[sp.verdict] || sp.verdict, { tone, dot: true })}
    </div>

    <div class="row" style="margin:10px 0">
      ${chip(`spawn ${sp.ts?.[0]}–${sp.ts?.[1]} °C`, { mono: true })}
      ${chip(`fruit ${sp.tf?.[0]}–${sp.tf?.[1]} °C`, { mono: true })}
      ${chip(`${sp.rh?.[0]}–${sp.rh?.[1]}% RH`, { mono: true })}
      ${sp.start ? chip('Start here', { tone: 'ok' }) : ''}
    </div>

    <div style="margin:12px 0">
      <div class="eyebrow">Bench fit through the year</div>
      <div style="margin-top:6px">${yearStrip(fits.map((f) => (f + 1) / 3, 0), {
        colors: fits.map((f) => `var(--stress-${f === 2 ? 0 : f === 1 ? 2 : 4})`)
      })}</div>
    </div>

    <p style="font-size:13.5px">${esc(sp.why)}</p>

    <button class="btn sm ghost" data-act="shopen" data-k="${esc(sp.k)}" style="margin-top:10px">${open ? 'Less' : 'Full sheet'}</button>

    ${open ? facts([
      ['Substrate', sp.sub], ['Casing', sp.casing], ['Spawn rate', sp.rate],
      ['First pins', sp.first], ['Cycle', sp.cycle], ['Yield', sp.yield],
      ['Spawn from', sp.spawnat], ['Eating', sp.eat]
    ]) : ''}
  </article>`;
}

/* ==========================================================================
   THE BENCH YEAR
   ==========================================================================
   This used to render OYEAR — which is the ORCHARD calendar, mis-filed into
   data/mushrooms.json by the first extraction pass. Its rows are arrays, so
   the object-shaped fallback here fell through to JSON.stringify and printed
   raw JSON on the screen under a heading that was wrong anyway.

   Replaced with a real mushroom calendar built from data the bench already
   has: Zone E's modelled temperature each month against each species' own
   spawning window.
   ========================================================================== */

function benchYear() {
  const now = new Date().getMonth();
  const species = DB.mushrooms.SHROOMS.filter((s) => s.verdict !== 'no');

  return `<div class="grid g3">${MON.map((m, i) => {
    const t = benchTemp(i);
    const ideal = species.filter((s) => monthFit(s, i) === 2);
    const workable = species.filter((s) => monthFit(s, i) === 1);
    return `<div class="card ${i === now ? '' : 'flat'}">
      <div class="spread">
        <span class="eyebrow">${m}${i === now ? ' · now' : ''}</span>
        <span class="chip tone-mono">${t} °C</span>
      </div>
      ${ideal.length
        ? `<div class="row" style="margin-top:8px">${ideal.map((s) =>
            chip(s.name, { tone: 'ok' })).join('')}</div>`
        : '<p class="subtle" style="margin-top:8px">Nothing in its ideal band.</p>'}
      ${workable.length
        ? `<div class="row" style="margin-top:6px">${workable.map((s) =>
            chip(s.name, { tone: 'watch' })).join('')}</div>`
        : ''}
    </div>`;
  }).join('')}</div>
  <p class="subtle" style="margin-top:10px">
    Green sits inside its spawning band; amber is workable at the edge, with slower
    colonisation and a better chance of contamination winning the race.
  </p>`;
}

/* --------------------------------------------------------------- run plan -- */

/* RUNPLAN is keyed by species, each a list of [dayOffset, stage, what, action].
   The day offsets are what make it a plan rather than a list: spawn on the 1st
   and the bag should be solid white by day 16, pinning by 22, cutting by 28. */

let RUNSPECIES = 'oyster';

const RUN_LABEL = {
  oyster: 'Oyster', pink: 'Pink oyster', milky: 'Milky',
  paddy: 'Paddy straw', reishi: 'Reishi'
};

function runPlan() {
  const plans = DB.mushrooms.RUNPLAN;
  const keys = Object.keys(plans);
  if (!keys.length) return empty('No run plan in the data bundle.');
  const active = plans[RUNSPECIES] ? RUNSPECIES : keys[0];
  const steps = plans[active];

  return `
    <div class="row" style="margin-bottom:14px">
      ${keys.map((k) => `<button class="chip ${k === active ? 'on' : ''}"
        data-act="runpick" data-k="${esc(k)}">${esc(RUN_LABEL[k] || k)}</button>`).join('')}
    </div>
    ${stepper(steps.map(([day, stage, what, action]) => ({
      title: `Day ${day} — ${stage}`,
      body: what,
      why: action || ''
    })))}
    <p class="subtle" style="margin-top:10px">
      Start with one bag in October, not five. One bag teaches you what full colonisation
      looks like and what contamination smells like, for the price of one bottle of spawn.
    </p>`;
}

/** Wrap a lifted v9 block in v10's own section furniture. */
const VIEW = 'shrooms';

function proseSection(slug, mounts = {}, view = VIEW) {
  const block = prose(view, slug);
  if (!block) return '';
  return section(block.heading, proseHtml(view, slug, mounts), {
    eyebrow: block.sub || block.eyebrow || ''
  });
}

/* ------------------------------------------------------------------ wire -- */

export function wireShrooms() {
  on('shfilter', (el, e, ds) => { FILTER = ds.k; renderShrooms(); });
  on('shopen', (el, e, ds) => { OPEN = OPEN === ds.k ? '' : ds.k; renderShrooms(); });
  on('runpick', (el, e, ds) => { RUNSPECIES = ds.k; renderShrooms(); });
}
