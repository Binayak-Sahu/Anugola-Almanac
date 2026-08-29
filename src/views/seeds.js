/* ============================================================================
   views/seeds.js — the Smart Seed & Germination Tracker.

   One record per SOWING, not per variety. Succession sowing — the same radish
   every fortnight from October to January — is the technique that makes a
   small balcony productive, and it is impossible to track if the app only
   knows about "radish".
   ========================================================================== */

import { esc, mount, on } from '../core/dom.js';
import { iso, slugOf, relDays, daysBetween, pct } from '../core/util.js';
import * as store from '../core/store.js';
import { DB, SOW_STATUS_LBL } from '../core/data.js';
import { seedProgramme, sowingStatus, thermalFor, expectedDays, HARDENING_LADDER } from '../engine/germination.js';
import { zoneMonth } from '../engine/heat.js';
import { section, chip, meter, facts, empty, stepper } from '../ui/components.js';
import { toast, toastUndo } from '../ui/toast.js';

const ZONES = ['A', 'B', 'C', 'D', 'E'];

/** Mean soil temperature per zone this month — trays run a touch under air. */
function soilByZone(date = new Date()) {
  const out = {};
  for (const z of ZONES) {
    const m = zoneMonth(z, date.getMonth(), DB.climate.ANGUL);
    out[z] = Math.round(((m.high + m.low) / 2 - 1) * 10) / 10;
  }
  return out;
}

export function renderSeeds() {
  const state = store.get();
  const soil = soilByZone();
  const prog = seedProgramme(state.sowings, soil);

  mount('v-seeds', `
    <div class="sec">
      <div class="eyebrow">Zone C winter programme · Zone D nursery bench</div>
      <h1 style="margin:4px 0 6px">Seeds and germination</h1>
      <p class="lede">
        Germination is a temperature budget, not a number of days. A chilli seed needs the
        same accumulated warmth whether it gets it in six days at 30 °C or eighteen at 18 °C.
        Every estimate below is thermal time against the modelled soil temperature of the
        zone the tray is sitting in.
      </p>
    </div>

    ${summary(prog, soil)}
    ${sowForm(soil)}
    ${section('Active sowings', prog.rows.length
      ? prog.rows.map((r) => sowingCard(r, soil)).join('')
      : empty('Nothing sown yet. The Zone C winter window opens in October — that is the one that matters.'),
      { eyebrow: `${prog.live.length} live · ${prog.rows.length} total` })}

    ${section('Hardening off', hardeningReference(), {
      eyebrow: 'The step that kills more seedlings here than any pest'
    })}

    ${section('Seed catalogue', seedTable(), { eyebrow: `${DB.seeds.SEEDS2.length} varieties audited` })}
  `);
}

/* ------------------------------------------------------------------------- */

function summary(prog, soil) {
  const t = prog.totals;
  return section('The programme', `
    <div class="grid g4">
      <div class="card"><div class="eyebrow">Sowings</div><div class="num" style="font-size:24px">${t.sowings}</div></div>
      <div class="card"><div class="eyebrow">Seeds sown</div><div class="num" style="font-size:24px">${t.seedsSown}</div></div>
      <div class="card"><div class="eyebrow">Seedlings up</div><div class="num" style="font-size:24px">${t.seedlings}</div></div>
      <div class="card"><div class="eyebrow">Germination</div>
        <div class="num" style="font-size:24px">${t.rate === null ? '—' : pct(t.rate)}</div>
        ${t.rate === null ? '' : meter(t.rate)}
      </div>
    </div>
    <div class="row" style="margin-top:12px">
      ${ZONES.map((z) => `<span class="chip tone-zone" data-zone="${z}" title="Modelled mean soil temperature">Zone ${z} soil ≈ ${soil[z]} °C</span>`).join('')}
    </div>`, { eyebrow: 'This season' });
}

function sowForm(soil) {
  const options = DB.seeds.SEEDS2
    .filter((s) => !s.skip)
    .map((s) => `<option value="${esc(s.n)}">${esc(s.n)}</option>`).join('');

  return section('Sow something', `
    <form class="card" id="sowform">
      <div class="grid g3" style="align-items:end">
        <label class="fld" style="grid-column:span 2"><span>Variety</span>
          <input class="input" name="name" list="seedlist" placeholder="Radish Pusa Chetki" required>
          <datalist id="seedlist">${options}</datalist>
        </label>
        <label class="fld"><span>Seeds sown</span>
          <input class="input" name="qtySown" type="number" min="1" inputmode="numeric" value="12" required></label>
        <label class="fld"><span>Zone</span>
          <select class="input" name="zone">${ZONES.map((z) => `<option value="${z}"${z === 'D' ? ' selected' : ''}>Zone ${z} · soil ≈ ${soil[z]} °C</option>`).join('')}</select></label>
        <label class="fld"><span>Tray / location</span>
          <input class="input" name="tray" placeholder="tray 2, cells A1–A6"></label>
        <label class="fld"><span>Sown on</span>
          <input class="input" name="sownOn" type="date" value="${iso()}"></label>
      </div>
      <div class="row" style="margin-top:12px">
        <button class="btn pri" type="submit">Start tracking</button>
        <span class="subtle" id="sowhint"></span>
      </div>
    </form>`);
}

/* ---------------------------------------------------------- sowing card --- */

function sowingCard(row, soil) {
  const s = row.sowing;
  const st = row.status;
  const phaseIdx = ['sown', 'germinating', 'growing', 'hardening', 'planted'].indexOf(st.phase);

  return `
  <article class="card" data-zone="${esc(s.zone)}" style="margin-bottom:12px">
    <div class="spread" style="align-items:flex-start">
      <div style="min-width:0">
        <h3>${esc(s.name)}</h3>
        <div class="subtle">sown ${esc(s.sownOn)} · day ${st.age} · ${esc(s.tray || 'no tray noted')}</div>
      </div>
      <div class="row">
        ${chip(SOW_STATUS_LBL[st.phase] || st.phase, { tone: st.phase === 'failed' ? 'no' : 'ok' })}
        ${chip('Zone ' + s.zone, { tone: 'zone' })}
      </div>
    </div>

    <div class="grid g3" style="margin-top:14px">
      <div class="card flat">
        <div class="eyebrow">Germination</div>
        <div class="num" style="font-size:22px">${st.rate === null ? '—' : pct(st.rate)}</div>
        <div class="subtle">${st.upNow} of ${s.qtySown} up</div>
        ${st.rate === null ? '' : `<div style="margin-top:6px">${meter(st.rate, st.rate < 0.4 ? 3 : st.rate < 0.7 ? 1 : 0)}</div>`}
      </div>
      <div class="card flat">
        <div class="eyebrow">Expected</div>
        <div class="num" style="font-size:22px">${st.expected ? `day ${st.expected}` : '—'}</div>
        <div class="subtle">${st.firstUp ? `first up day ${st.daysToFirst}` : (st.dueISO ? `around ${st.dueISO}` : 'no estimate')}</div>
      </div>
      <div class="card flat">
        <div class="eyebrow">Thermal model</div>
        <div class="num" style="font-size:15px;margin-top:4px">${esc(st.thermal.key)}</div>
        <div class="subtle">base ${st.thermal.base} °C · ${st.thermal.tt} °C·d · soil ≈ ${soil[s.zone]} °C</div>
      </div>
    </div>

    ${st.warning ? `<p class="subtle" style="color:var(--warn);margin-top:10px">${esc(st.warning)}</p>` : ''}
    ${st.thermal.note ? `<p class="subtle" style="margin-top:6px">${esc(st.thermal.note)}</p>` : ''}

    <div style="margin-top:14px">
      ${pipeline(phaseIdx)}
    </div>

    ${st.hardening.active ? `
      <div class="card sunk" style="margin-top:12px">
        <div class="eyebrow">Hardening off · day ${st.hardening.dayIndex + 1} of ${st.hardening.days}</div>
        <p style="font-size:13.5px;margin-top:4px"><b>${esc(st.hardening.todayStep)}</b></p>
      </div>` : ''}

    <form class="row" data-sow-count="${esc(s.id)}" style="margin-top:14px">
      <label class="fld" style="flex:1;min-width:130px"><span>Seedlings up today</span>
        <input class="input" name="up" type="number" min="0" max="${s.qtySown}" inputmode="numeric" value="${st.upNow}"></label>
      <button class="btn" type="submit" style="align-self:flex-end">Count</button>
      ${!s.hardenFrom ? `<button class="btn" type="button" data-act="harden" data-id="${esc(s.id)}" style="align-self:flex-end">Start hardening off</button>` : ''}
      ${!s.plantedOn ? `<button class="btn" type="button" data-act="planted" data-id="${esc(s.id)}" style="align-self:flex-end">Planted out</button>` : ''}
      <button class="btn ghost danger" type="button" data-act="rmsow" data-id="${esc(s.id)}" style="align-self:flex-end">Delete</button>
    </form>
  </article>`;
}

function pipeline(activeIdx) {
  const phases = ['Sown', 'Germinating', 'Growing on', 'Hardening', 'Planted out'];
  return `<div class="ladder">${phases.map((p, i) => `
    <div class="rung ${i < activeIdx ? 'done' : i === activeIdx ? 'now' : ''}">
      <div class="bar"></div><div class="sz" style="font-size:11px">${p}</div>
    </div>`).join('')}</div>`;
}

/* ------------------------------------------------------------- reference -- */

function hardeningReference() {
  return `
    ${stepper(HARDENING_LADDER.map((text, i) => ({ title: `Day ${i + 1}`, body: text })))}
    <p class="subtle" style="margin-top:10px">
      Exposure is added in the MORNING only, never the afternoon. A tray raised in Zone D shade
      and moved straight into Zone A sun scorches in about two hours at these temperatures, and
      the bleached patches never recover.
    </p>`;
}

function seedTable() {
  const groups = DB.seeds.SEEDGRP;
  return groups.map((g) => {
    const rows = DB.seeds.SEEDS2.filter((s) => s.g === g.k);
    if (!rows.length) return '';
    return `
    <div style="margin-bottom:20px">
      <div class="eyebrow" style="margin-bottom:8px">${esc(g.lbl)} · ${rows.length}</div>
      <div class="scrollx"><table class="data stack">
        <thead><tr><th>Variety</th><th>Pack</th><th>Bag</th><th>To harvest</th><th>Window</th><th>Why</th></tr></thead>
        <tbody>${rows.map((s) => {
          const t = thermalFor(s.n);
          return `<tr>
            <td data-l="Variety"><b>${esc(s.n)}</b>${s.star ? ' ★' : ''}
              <div class="subtle">germ. base ${t.base} °C · ${t.opt[0]}–${t.opt[1]} °C ideal</div></td>
            <td data-l="Pack">${esc(s.pk || '—')}<div class="subtle">₹${s.p}</div></td>
            <td data-l="Bag">${esc(s.bag || '—')}</td>
            <td data-l="To harvest">${esc(s.days || '—')}</td>
            <td data-l="Window">${esc(s.win || '—')}</td>
            <td data-l="Why">${esc(s.why || '')}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
    </div>`;
  }).join('');
}

/* ------------------------------------------------------------------ wire -- */

export function wireSeeds() {
  on('harden', (el, e, ds) => {
    store.updateSowing(ds.id, { hardenFrom: iso(), status: 'hardening' });
    toast('Hardening off started. Morning sun only — one hour tomorrow.');
  });

  on('planted', (el, e, ds) => {
    store.updateSowing(ds.id, { plantedOn: iso(), status: 'planted' });
    toast('Planted out. Water it in at dusk, not at noon.');
  });

  on('rmsow', (el, e, ds) => {
    const rec = store.get().sowings.find((x) => x.id === ds.id);
    const backup = JSON.parse(JSON.stringify(rec));
    store.removeSowing(ds.id);
    toastUndo('Sowing deleted', () => store.addSowing(backup));
  });

  document.addEventListener('submit', (e) => {
    if (e.target.id === 'sowform') {
      e.preventDefault();
      const f = new FormData(e.target);
      const name = String(f.get('name') || '').trim();
      if (!name) return;
      const rec = store.addSowing({
        name,
        seedKey: slugOf(name),
        qtySown: Number(f.get('qtySown')) || 0,
        zone: f.get('zone'),
        tray: String(f.get('tray') || ''),
        sownOn: String(f.get('sownOn') || iso())
      });
      const soil = soilByZone()[rec.zone];
      const est = expectedDays(name, soil);
      toast(est.days
        ? `Sown. Expect emergence around day ${est.days} at ${soil} °C.`
        : `Sown. ${est.warning || 'No thermal profile for this one — count it yourself.'}`);
      e.target.reset();
      return;
    }

    const sowId = e.target.dataset?.sowCount;
    if (sowId) {
      e.preventDefault();
      const up = Number(new FormData(e.target).get('up')) || 0;
      store.countGermination(sowId, up);
      toast(`${up} up`);
    }
  });

  /* Live estimate as the user picks a variety and a zone. */
  document.addEventListener('input', (e) => {
    if (!e.target.closest('#sowform')) return;
    const form = document.getElementById('sowform');
    const hint = document.getElementById('sowhint');
    if (!form || !hint) return;
    const f = new FormData(form);
    const name = String(f.get('name') || '');
    if (!name) { hint.textContent = ''; return; }
    const soil = soilByZone()[f.get('zone')] ?? null;
    const est = expectedDays(name, soil);
    hint.textContent = est.days
      ? `≈ ${est.days} days to emergence at ${soil} °C. ${est.warning}`
      : (est.warning || 'No thermal profile — it will still be tracked.');
  });
}
