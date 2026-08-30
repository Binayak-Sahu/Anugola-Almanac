/* ============================================================================
   views/zones.js — the five micro-climates, and the readings that correct them.

   This is where the app's honesty lives. Every temperature it shows is either
   MODELLED (station average plus a per-zone offset) or MEASURED (the user's
   own readings, once there are enough to mean anything). The screen says which,
   always, and shows the model being replaced as data arrives.
   ========================================================================== */

import { esc, mount, on } from '../core/dom.js';
import { MON, MONFULL, round } from '../core/util.js';
import * as store from '../core/store.js';
import { DB, proseHtml, prose } from '../core/data.js';
import { zoneMonth, zoneMonthCalibrated, calibrate, heatIndexC, heatBand, vpd, vpdBand,
  rootZoneTemp, rootZoneVerdict, ZONE_MODEL, BAG_FACTOR } from '../engine/heat.js';
import { overhangYear, BALCONY_DEFAULT } from '../engine/solar.js';
import { section, chip, meter, yearStrip, stressColors, facts, stepper, empty } from '../ui/components.js';
import { toast, toastUndo } from '../ui/toast.js';

const ZONE_KEYS = ['A', 'B', 'C', 'D', 'E'];
const VIEW = 'zones';

export function renderZones(target = '') {
  const state = store.get();
  const cal = calibrate(state.readings, DB.climate.ANGUL);

  mount('v-zones', `
    <div class="sec">
      <div class="eyebrow">Five micro-climates, one property</div>
      <h1 style="margin:4px 0 6px">Zones</h1>
      <p class="lede">
        Plants stay put. Nothing is shuttled between zones — a plant bought for shade that gets
        moved into sun is a plant you have decided to lose. Each zone below carries its own
        modelled year, and the readings you log replace the model one zone at a time.
      </p>
    </div>

    ${section('Calibration', calibrationPanel(cal, state), { eyebrow: 'Model vs. measurement' })}

    ${ZONE_KEYS.map((k) => zoneCard(k, cal, target)).join('')}

    ${section('Zone C: why the calendar is inverted', balconyPanel(), { eyebrow: 'Overhang geometry' })}

    ${section('Root zone', rootZonePanel(), { eyebrow: 'The number nobody measures' })}

    ${section('The acclimation ladder', acclimationLadder(), {
      eyebrow: 'Roughly a week at each step. This is why the eight are alive.' })}

    ${proseSection('shade-requirement-by-plant')}
    ${proseSection('why-not-air-conditioning')}
    ${proseSection('the-coal-belt-problem')}

    ${section('Readings', readingsPanel(state), { eyebrow: `${state.readings.length} logged` })}
  `);

  if (target) document.getElementById(`zone-${target}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

/* ------------------------------------------------------------------------- */

function calibrationPanel(cal, state) {
  const rows = ZONE_KEYS.map((z) => {
    const c = cal[z];
    const n = c?.samples || 0;
    const need = Math.max(0, 8 - n);
    return `
    <div class="card" data-zone="${z}">
      <div class="spread">
        <span class="eyebrow">Zone ${z}</span>
        ${chip(c?.trusted ? 'Measured' : 'Modelled', { tone: c?.trusted ? 'ok' : 'watch' })}
      </div>
      <div class="num" style="font-size:20px;margin-top:6px">${n} <span style="font-size:12px;color:var(--muted)">afternoon readings</span></div>
      ${c?.trusted
        ? `<div class="subtle">correcting by ${c.dayBias > 0 ? '+' : ''}${c.dayBias} °C, ${c.rhBias > 0 ? '+' : ''}${c.rhBias}% RH</div>`
        : `<div class="subtle">${need} more and this zone switches to your data</div>`}
      <div style="margin-top:8px">${meter(Math.min(1, n / 8))}</div>
    </div>`;
  }).join('');

  return `<div class="grid g3">${rows}</div>
    <p class="subtle" style="margin-top:10px">
      Only readings taken between noon and 17:00 speak to the day high, so those are the ones counted.
      Below eight the correction would be noise, and a confident wrong number is worse than an honest estimate.
    </p>`;
}

/* --------------------------------------------------------------- one zone - */

function zoneCard(k, cal, target) {
  const spec = DB.zones.ZONES.find((z) => z.k === k);
  const model = ZONE_MODEL[k];
  const months = Array.from({ length: 12 }, (_, m) => zoneMonthCalibrated(k, m, DB.climate.ANGUL, cal));
  const now = months[new Date().getMonth()];

  const hi = heatIndexC(now.high, now.rh);
  const band = heatBand(hi);
  const v = vpd(now.high, now.rh);

  const stress = months.map((m) => heatBand(heatIndexC(m.high, m.rh)).level);
  const norm = stress.map((s) => (s + 1) / 5);

  return `
  <div class="sec" id="zone-${k}">
    <article class="card" data-zone="${k}">
      <div class="spread" style="align-items:flex-start">
        <div style="min-width:0">
          <div class="eyebrow">Zone ${k}</div>
          <h2 style="margin-top:2px">${esc(spec.name)}</h2>
          <div class="subtle">${esc(spec.sub)}</div>
        </div>
        <div class="row">
          ${chip(now.modelled ? 'Modelled' : `From ${now.samples} readings`, { tone: now.modelled ? 'watch' : 'ok' })}
          ${chip(band.label, { tone: band.level >= 3 ? 'no' : band.level >= 2 ? 'watch' : 'ok' })}
        </div>
      </div>

      <p class="lede" style="font-size:13.5px;margin-top:10px">${esc(spec.d)}</p>

      <div class="grid g4" style="margin-top:14px">
        <div class="card flat"><div class="eyebrow">${MONFULL[new Date().getMonth()]} high</div>
          <div class="num" style="font-size:22px">${now.high} °C</div></div>
        <div class="card flat"><div class="eyebrow">Night low</div>
          <div class="num" style="font-size:22px">${now.low} °C</div></div>
        <div class="card flat"><div class="eyebrow">Heat index</div>
          <div class="num" style="font-size:22px">${hi} °C</div></div>
        <div class="card flat"><div class="eyebrow">VPD</div>
          <div class="num" style="font-size:22px">${v} kPa</div>
          <div class="subtle">${esc(vpdBand(v).label)}</div></div>
      </div>

      <div style="margin-top:16px">
        <div class="eyebrow">Heat stress through the year</div>
        <div style="margin-top:6px">${yearStrip(norm, { colors: stressColors(stress) })}</div>
      </div>

      <div class="grid g2" style="margin-top:14px">
        <div class="card sunk">
          <div class="eyebrow">What lives here</div>
          <ul style="margin:6px 0 0 16px;font-size:13px">${spec.has.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>
        </div>
        <div class="card sunk">
          <div class="eyebrow">The fix</div>
          <p style="font-size:13px;margin-top:4px">${esc(spec.foot)}</p>
          <p class="subtle" style="margin-top:8px">${esc(model.why)}</p>
        </div>
      </div>
    </article>
  </div>`;
}

/* ------------------------------------------------------------- balcony ---- */

function balconyPanel() {
  const geom = { ...BALCONY_DEFAULT, ...(store.get().settings.balconyGeometry || {}) };
  const year = overhangYear(geom);
  const values = year.map((y) => y.sunlitFraction || 0);

  return `
  <div class="card" data-zone="C">
    <p class="lede" style="font-size:13.5px">
      At 20.95°N the June sun reaches 87.5° at noon — near vertical. A ${geom.projection} m overhang
      therefore casts its shadow straight down the glass and shades the balcony completely.
      In December the same sun sits at 45.6° and reaches
      ${round(year[11].floorPenetration || 0, 1)} m past the glass line. Same balcony, opposite season.
    </p>
    <div style="margin-top:14px">
      <div class="eyebrow">Fraction of the glass in sun at solar noon</div>
      <div style="margin-top:6px;color:var(--zone-c)">${yearStrip(values)}</div>
    </div>
    <div class="scrollx" style="margin-top:14px">
      <table class="data stack">
        <thead><tr><th>Month</th><th>Noon altitude</th><th>Profile angle</th><th>Shadow drop</th><th>Glass in sun</th><th>Reaches</th></tr></thead>
        <tbody>${year.map((y) => `<tr>
          <td data-l="Month">${MON[y.month]}</td>
          <td data-l="Noon altitude">${Math.round(y.altitude)}°</td>
          <td data-l="Profile">${y.profile ? Math.round(y.profile) + '°' : '—'}</td>
          <td data-l="Shadow drop">${y.drop != null ? round(y.drop, 2) + ' m' : '—'}</td>
          <td data-l="Glass in sun">${Math.round((y.sunlitFraction || 0) * 100)}%</td>
          <td data-l="Reaches">${round(y.floorPenetration || 0, 2)} m</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>
    <form class="row" id="geomform" style="margin-top:14px">
      <label class="fld"><span>Overhang projection (m)</span>
        <input class="input" name="projection" type="number" step="0.05" value="${geom.projection}"></label>
      <label class="fld"><span>Glass height (m)</span>
        <input class="input" name="openingHeight" type="number" step="0.05" value="${geom.openingHeight}"></label>
      <label class="fld"><span>Sill height (m)</span>
        <input class="input" name="sillHeight" type="number" step="0.05" value="${geom.sillHeight}"></label>
      <button class="btn" type="submit" style="align-self:flex-end">Recalculate</button>
    </form>
    <p class="subtle" style="margin-top:8px">Measure yours with a tape and these become facts rather than defaults.</p>
  </div>`;
}

/* ------------------------------------------------------------ root zone --- */

function rootZonePanel() {
  const m = new Date().getMonth();
  const airHigh = zoneMonth('A', m, DB.climate.ANGUL).high;

  const options = [
    ['black-plastic', 'Black plastic pot, full sun', 'none', false],
    ['hdpe-dark', 'Dark HDPE woven bag', 'none', false],
    ['fabric-pale', 'Pale 400 GSM fabric bag', 'none', false],
    ['fabric-pale', 'Pale fabric + 50% net', '50', false],
    ['fabric-pale', 'Pale fabric + 50% net + mulch', '50', true],
    ['double-potted', 'Double-potted, raised, mulched', '50', true]
  ];

  return `
  <div class="card">
    <p class="lede" style="font-size:13.5px">
      Feeder roots stop working around 35 °C and start dying near 40 °C. Leaves look untouched
      while it happens, so the plant "suddenly" collapses a fortnight later. This is the
      modelled peak root-zone temperature in Zone A this month, at ${airHigh} °C air.
    </p>
    <div class="scrollx" style="margin-top:12px">
      <table class="data stack">
        <thead><tr><th>Setup</th><th>Root zone</th><th>Verdict</th></tr></thead>
        <tbody>${options.map(([bag, label, shade, mulched]) => {
          const t = rootZoneTemp({ airHigh, bag, shade, mulched });
          const v = rootZoneVerdict(t);
          return `<tr>
            <td data-l="Setup">${esc(label)}</td>
            <td data-l="Root zone"><span class="num" style="font-size:15px;color:var(--stress-${v.level})">${t} °C</span></td>
            <td data-l="Verdict">${esc(v.text)}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>
    <p class="subtle" style="margin-top:10px">
      The entire difference between the top row and the bottom is a pale bag, a net and two inches
      of mulch. Nothing exotic, and it is worth more than any fertiliser you can buy.
    </p>
  </div>`;
}

/* -------------------------------------------------------------- readings -- */

function readingsPanel(state) {
  if (!state.readings.length) {
    return empty('No readings yet. A ₹300 hygrometer in Zone C and one in Zone A will teach you more than the rest of this app.');
  }
  return `<div class="scrollx"><table class="data stack">
    <thead><tr><th>When</th><th>Zone</th><th>Temp</th><th>RH</th><th>Note</th><th></th></tr></thead>
    <tbody>${state.readings.slice(0, 60).map((r) => `<tr>
      <td data-l="When">${esc(new Date(r.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }))}</td>
      <td data-l="Zone"><span class="chip tone-zone" data-zone="${esc(r.zone)}">${esc(r.zone)}</span></td>
      <td data-l="Temp">${r.tempC ?? '—'} °C</td>
      <td data-l="RH">${r.rh ?? '—'}%</td>
      <td data-l="Note">${esc(r.note || '')}</td>
      <td><button class="btn sm ghost danger" data-act="rmreading" data-id="${esc(r.id)}">×</button></td>
    </tr>`).join('')}</tbody></table></div>
    ${state.readings.length > 60 ? `<p class="subtle" style="margin-top:8px">Showing the most recent 60 of ${state.readings.length}.</p>` : ''}`;
}

/* ------------------------------------------------------------------ wire -- */

export function wireZones() {
  on('rmreading', (el, e, ds) => {
    const rec = store.get().readings.find((x) => x.id === ds.id);
    const backup = JSON.parse(JSON.stringify(rec));
    store.removeReading(ds.id);
    toastUndo('Reading deleted', () => store.addReading(backup));
  });

  document.addEventListener('submit', (e) => {
    if (e.target.id !== 'geomform') return;
    e.preventDefault();
    const f = new FormData(e.target);
    store.setSetting('balconyGeometry', {
      projection: Number(f.get('projection')) || 1.2,
      openingHeight: Number(f.get('openingHeight')) || 2.1,
      sillHeight: Number(f.get('sillHeight')) || 0.9
    });
    toast('Geometry saved. Every sun figure in the app now uses your measurements.');
  });
}

/* ------------------------------------------------------ acclimation ------- */
/* Four steps, roughly a week each. A shade-held plant moved straight into
   45 °C sun scalds in two to four hours and the bleached patches never
   recover — which is why nothing here is ever shuttled between zones. */

function acclimationLadder() {
  return stepper(DB.zones.ACCLIM.map((a) => ({
    title: `${a.n} · ${a.t}`,
    body: a.d,
    why: ''
  })));
}

/** Wrap a lifted v9 block in v10's own section furniture. */
function proseSection(slug, mounts = {}, view = VIEW) {
  const block = prose(view, slug);
  if (!block) return '';
  return section(block.heading, proseHtml(view, slug, mounts), {
    eyebrow: block.sub || block.eyebrow || ''
  });
}
