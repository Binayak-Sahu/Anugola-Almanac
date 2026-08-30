/* ============================================================================
   views/today.js — the Daily Action Desk.

   The one screen the app should be judged on. It answers "what do I do in the
   next hour", ordered by consequence, with the reason attached. Everything
   else in the app is reference material for this page.
   ========================================================================== */

import { esc, mount, on, icon } from '../core/dom.js';
import { MONFULL, iso, round } from '../core/util.js';
import * as store from '../core/store.js';
import { DB, catalogue, proseHtml, prose } from '../core/data.js';
import { buildAgenda } from '../engine/agenda.js';
import { heatBand } from '../engine/heat.js';
import { chillHours, BALCONY_DEFAULT } from '../engine/solar.js';
import { section, meter, empty, chip } from '../ui/components.js';
import { toast } from '../ui/toast.js';
import { go } from '../core/router.js';

const ZONE_ORDER = ['A', 'B', 'C', 'D', 'E', 'indoor'];
const VIEW = 'today';

export function renderToday() {
  const state = store.get();
  const agenda = buildAgenda(DB, state);
  const c = agenda.conditions;

  mount('v-today', `
    ${header(c, agenda)}
    ${conditionStrip(c)}
    ${taskList(agenda)}
    ${sunPanel(c)}
    ${quickLog()}
    ${section('Starter bundles', starterBundles(), {
      eyebrow: 'Six things that work together, rather than six good ideas' })}
  `);
}

/* ------------------------------------------------------------------------- */

function header(c, agenda) {
  const worst = Object.entries(c.zones).reduce((a, [k, z]) => (z.band.level > (a?.[1]?.band.level ?? -1) ? [k, z] : a), null);
  const [worstZone, wz] = worst;

  return `
  <div class="sec">
    <div class="eyebrow">${esc(c.season.label)} · ${esc(MONFULL[c.month])}</div>
    <h1 style="margin:4px 0 6px">${greeting()}</h1>
    <p class="lede">
      ${agenda.counts.hi
        ? `<b>${agenda.counts.hi} urgent</b>, ${agenda.counts.med} due, ${agenda.counts.low} worth reading.`
        : agenda.open.length
          ? `${agenda.open.length} things to do. Nothing urgent.`
          : 'Nothing due. Go and look at the plants anyway.'}
      Hottest place on site right now is <b>${esc(worstZone === 'indoor' ? 'the room' : 'Zone ' + worstZone)}</b>
      at a modelled ${wz.band.beyondChart ? 'over 54' : wz.heatIndex} °C heat index —
      ${esc(wz.band.label.toLowerCase())}.
    </p>
  </div>`;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Still up';
  if (h < 11) return 'This morning';
  if (h < 16) return 'This afternoon';
  if (h < 20) return 'This evening';
  return 'Tonight';
}

/* --------------------------------------------------- the conditions strip - */

function conditionStrip(c) {
  const cards = ZONE_ORDER.map((z) => {
    const d = c.zones[z];
    const band = d.band;
    return `
    <button class="card zonecard" data-zone="${z}" data-act="gozone" data-z="${z}"
            title="${esc(d.why)}">
      <div class="spread">
        <span class="eyebrow">${z === 'indoor' ? 'The room' : 'Zone ' + z}</span>
        <span class="chip tone-mono">${band.label}</span>
      </div>
      <div class="num" style="font-size:26px;line-height:1.1;margin-top:6px">${d.high}<span style="font-size:13px;color:var(--muted)"> °C</span></div>
      <div class="subtle">feels ${band.beyondChart ? 'over 54' : d.heatIndex} · ${d.rh}% RH at the high · VPD ${d.vpd}</div>
      <div style="margin-top:8px">${meter((band.level + 1) / 5, band.level)}</div>
    </button>`;
  }).join('');

  const anyBeyond = ZONE_ORDER.some((z) => c.zones[z].band.beyondChart);

  return section('Site conditions', `<div class="grid g3">${cards}</div>
    <p class="subtle" style="margin-top:10px">
      Modelled from the Angul station average plus a per-zone offset. Humidity is shown for the
      afternoon, not the monthly mean — air holds roughly twice as much water at 40 °C as at
      30 °C, so a mean figure paired with a day high overstates the heat index badly.
      Log readings in <a href="#zones" data-act="go" data-view="zones"><b>Zones</b></a> and
      these numbers start using your measurements instead.
      ${anyBeyond ? '<br>Where it says “feels over 54”, the standard heat-index formula has run past the end of its published table — the exact number would be invented.' : ''}
    </p>`,
  { eyebrow: 'Right now' });
}

/* ------------------------------------------------------------- task list -- */

function taskList(agenda) {
  if (!agenda.tasks.length) {
    return section("Today's list", empty('Nothing to do today. That is a real answer, not an empty state.'));
  }

  const rows = agenda.tasks.map((t) => `
    <div class="task ${t.done ? 'done' : ''}" data-pri="${t.pri}">
      <button class="box" data-act="tick" data-key="${esc(t.key)}" aria-pressed="${t.done}"
              aria-label="Mark done">
        <svg viewBox="0 0 24 24">${icon('check').replace(/<\/?svg[^>]*>/g, '')}</svg>
      </button>
      <div style="min-width:0">
        <div class="tt">${esc(t.title)}</div>
        <div class="td">${esc(t.detail || '')}</div>
        ${t.why ? `<div class="td" style="font-style:italic;color:var(--faint);margin-top:3px">${esc(t.why)}</div>` : ''}
      </div>
      ${t.link ? `<button class="btn sm ghost" data-act="golink" data-href="${esc(t.link)}">Open</button>` : ''}
    </div>`).join('');

  return section("Today's list", rows, {
    eyebrow: 'Ordered by what breaks if you skip it',
    aside: `<span class="pill">${agenda.open.length} open</span>`
  });
}

/* ------------------------------------------------------------- sun panel -- */

function sunPanel(c) {
  const geom = { ...BALCONY_DEFAULT, ...(store.get().settings.balconyGeometry || {}) };
  const site = chillHours(DB.climate.ANGUL);
  const sunrise = fmtHour(c.day.sunrise);
  const sunset = fmtHour(c.day.sunset);
  const b = c.balcony;

  return section('Sun and season', `
    <div class="grid g2">
      <div class="card">
        <div class="eyebrow">Today's sun</div>
        <div class="row" style="margin-top:8px;gap:18px">
          <div><div class="subtle">Rise</div><div class="num" style="font-size:19px">${sunrise}</div></div>
          <div><div class="subtle">Set</div><div class="num" style="font-size:19px">${sunset}</div></div>
          <div><div class="subtle">Daylight</div><div class="num" style="font-size:19px">${round(c.day.hours, 1)} h</div></div>
          <div><div class="subtle">Noon altitude</div><div class="num" style="font-size:19px">${Math.round(c.noonAltitude)}°</div></div>
        </div>
        <p class="subtle" style="margin-top:10px">
          At 20.95°N the June sun reaches ${Math.round(90 - Math.abs(20.95 - 23.45))}° — within two and a half degrees of vertical.
          That single fact is why a south overhang shades the balcony all summer and floods it in December.
        </p>
      </div>

      <div class="card" data-zone="C">
        <div class="eyebrow">Zone C · south balcony at noon</div>
        <div class="num" style="font-size:26px;margin-top:6px">${Math.round((b.sunlitFraction || 0) * 100)}%<span style="font-size:13px;color:var(--muted)"> of the glass in sun</span></div>
        <div class="subtle">Profile angle ${b.profile ? Math.round(b.profile) + '°' : '—'} ·
          overhang shadow drops ${b.drop != null ? round(b.drop, 2) + ' m' : '—'} ·
          sun reaches ${b.floorPenetration != null ? round(b.floorPenetration, 2) + ' m' : '—'} past the glass</div>
        <div style="margin-top:10px">${meter(b.sunlitFraction || 0)}</div>
        <p class="subtle" style="margin-top:8px">
          Computed from a ${geom.projection} m overhang measured out from the glass line.
          Measure yours on the <a href="#zones" data-act="go" data-view="zones"><b>Zones</b></a>
          screen and these become facts rather than defaults.
        </p>
      </div>

      <div class="card">
        <div class="eyebrow">Chill hours</div>
        <div class="num" style="font-size:26px;margin-top:6px">${site}<span style="font-size:13px;color:var(--muted)"> h below 7.2 °C / year</span></div>
        <p class="subtle" style="margin-top:6px">
          Apple needs 800–1200. Most peach 600+. Litchi 100–200 of genuine cool nights.
          This is the number that rules them out, and it is not going to change.
          ${chip('Computed, not asserted', { mono: true })}
        </p>
      </div>
    </div>`, { eyebrow: 'Latitude 20.95° N' });
}

const fmtHour = (h) => {
  if (h == null) return '—';
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm % 60).padStart(2, '0')}`;
};

/* -------------------------------------------------------------- quick log - */

function quickLog() {
  return section('Log a reading', `
    <form class="card" id="readingform">
      <div class="grid g4" style="align-items:end">
        <label class="fld"><span>Zone</span>
          <select class="input" name="zone">
            ${ZONE_ORDER.map((z) => `<option value="${z}">${z === 'indoor' ? 'The room' : 'Zone ' + z}</option>`).join('')}
          </select></label>
        <label class="fld"><span>Temp °C</span><input class="input" name="tempC" type="number" step="0.1" inputmode="decimal" placeholder="41.5"></label>
        <label class="fld"><span>Humidity %</span><input class="input" name="rh" type="number" step="1" inputmode="numeric" placeholder="38"></label>
        <button class="btn pri" type="submit">Save reading</button>
      </div>
      <p class="subtle" style="margin-top:10px">
        Eight afternoon readings in a zone and the app stops modelling that zone and starts using your numbers.
      </p>
    </form>`, { eyebrow: 'Continuous improvement' });
}

/* ------------------------------------------------------------------ wire -- */

export function wireToday() {
  on('tick', (nodeEl, e, ds) => {
    const now = store.toggleTask(ds.key);
    if (now) toast('Done');
  });

  on('golink', (nodeEl, e, ds) => {
    const [view, target = ''] = String(ds.href).replace('#', '').split('/');
    go(view, target);
  });

  on('gozone', (nodeEl, e, ds) => go('zones', ds.z));

  on('bundle', (nodeEl, e, ds) => {
    const keys = String(ds.keys).split(',').filter(Boolean);
    const picks = store.get().picks;
    const adding = !keys.every((k) => picks.includes(k));
    store.transact(() => {
      for (const k of keys) {
        if (picks.includes(k) !== adding) store.togglePick(k);
      }
    }, 'picks');
    toast(adding ? `${keys.length} added to the buy list` : 'Removed from the buy list');
  });

  document.addEventListener('submit', (e) => {
    if (e.target.id !== 'readingform') return;
    e.preventDefault();
    const f = new FormData(e.target);
    const tempC = f.get('tempC') === '' ? null : Number(f.get('tempC'));
    const rh = f.get('rh') === '' ? null : Number(f.get('rh'));
    if (tempC === null && rh === null) { toast('Enter a temperature or a humidity first'); return; }
    store.addReading({ zone: f.get('zone'), tempC, rh });
    e.target.reset();
    toast('Reading saved');
  });
}

/* ==========================================================================
   STARTER BUNDLES
   ==========================================================================
   Six pre-built baskets from data/sources.json. The point of a bundle over a
   wishlist is that the six plants inside it want the same thing — the dark
   corner set all tolerate 500 lux, the first order all ship safely in monsoon
   — so they can share a shelf and a watering can without one of them slowly
   losing.

   Rows are [name, why, [plant names]].
   ========================================================================== */

function starterBundles() {
  const state = store.get();
  const cat = catalogue(state);
  const bySlug = new Map(cat.map((p) => [p.name, p]));

  return `<div class="grid g2">${DB.sources.BUNDLES.map(([name, why, plants]) => {
    const total = plants.reduce((a, n) => a + (bySlug.get(n)?.price || 0), 0);
    const keys = plants.map((n) => bySlug.get(n)?.key).filter(Boolean);
    const allPicked = keys.length > 0 && keys.every((k) => state.picks.includes(k));
    return `<article class="card">
      <div class="spread" style="align-items:flex-start">
        <h3>${esc(name)}</h3>
        <span class="pill">${total ? '₹' + total.toLocaleString('en-IN') : '—'}</span>
      </div>
      <p class="subtle" style="margin-top:6px">${esc(why)}</p>
      <ul style="margin:10px 0 0 16px;font-size:13px;color:var(--ink-2)">
        ${plants.map((n) => `<li>${esc(n)}</li>`).join('')}
      </ul>
      <button class="btn ${allPicked ? '' : 'pri'} sm" style="margin-top:12px"
              data-act="bundle" data-keys="${esc(keys.join(','))}">
        ${allPicked ? 'Remove from buy list' : 'Add all to buy list'}
      </button>
    </article>`;
  }).join('')}</div>`;
}

/** Wrap a lifted v9 block in v10's own section furniture. */
function proseSection(slug, mounts = {}, view = VIEW) {
  const block = prose(view, slug);
  if (!block) return '';
  return section(block.heading, proseHtml(view, slug, mounts), {
    eyebrow: block.sub || block.eyebrow || ''
  });
}
