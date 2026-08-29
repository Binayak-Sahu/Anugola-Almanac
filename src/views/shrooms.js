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
import { DB } from '../core/data.js';
import { zoneMonth } from '../engine/heat.js';
import { section, chip, facts, yearStrip, stressColors, empty } from '../ui/components.js';

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

    ${section('Can be spawned this month', spawnNow(month), { eyebrow: MONFULL[month] })}

    <div class="sec">
      <div class="row" style="margin-bottom:12px">
        ${[['all', 'All'], ['yes', 'Works here'], ['watch', 'With a catch'], ['no', 'Ruled out']]
          .map(([k, l]) => `<button class="chip ${FILTER === k ? 'on' : ''}" data-act="shfilter" data-k="${k}">${l}</button>`).join('')}
      </div>
      <div class="grid g2">${list.map((sp) => card(sp, month)).join('')}</div>
    </div>

    ${section('The oyster year', oysterYear(), { eyebrow: 'Month by month' })}
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

function oysterYear() {
  const year = DB.mushrooms.OYEAR || [];
  if (!year.length) return empty('No oyster calendar in the data bundle.');
  return `<div class="grid g3">${year.map((y, i) => `
    <div class="card ${i === new Date().getMonth() ? 'hot' : 'flat'}">
      <div class="spread"><span class="eyebrow">${MON[i]}</span>
        <span class="chip tone-mono">${benchTemp(i)} °C</span></div>
      <p style="font-size:13px;margin-top:6px">${esc(typeof y === 'string' ? y : (y.d || y.t || JSON.stringify(y)))}</p>
    </div>`).join('')}</div>`;
}

/* ------------------------------------------------------------------ wire -- */

export function wireShrooms() {
  on('shfilter', (el, e, ds) => { FILTER = ds.k; renderShrooms(); });
  on('shopen', (el, e, ds) => { OPEN = OPEN === ds.k ? '' : ds.k; renderShrooms(); });
}
