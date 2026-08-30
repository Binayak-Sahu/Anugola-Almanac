/* ============================================================================
   views/pots.js — the indoor ledger: what is in a pot, when it was last
   watered, and what it actually is.

   Three of the seven indoor plants are still unidentified — almost certainly
   Zingiberaceae, on pseudostem and leaf arrangement. That matters: if they are
   ginger they want double the water and much more light, and they die back
   completely around December. Throwing away a "dead" pot in January would be
   the expensive mistake. The card carries the open question until it is closed.
   ========================================================================== */

import { esc, mount, on } from '../core/dom.js';
import { iso, relDays, daysSince } from '../core/util.js';
import * as store from '../core/store.js';
import { catalogue, PLACE_LBL, SITE_LBL, DB, proseHtml, prose } from '../core/data.js';
import { schedule, seasonOf } from '../engine/water.js';
import { zoneMonth } from '../engine/heat.js';
import { section, chip, meter, facts, empty } from '../ui/components.js';
import { toast, toastUndo } from '../ui/toast.js';

const VIEW = 'pots';

export function renderPots(target = '') {
  const state = store.get();
  const month = new Date().getMonth();
  const roomHigh = zoneMonth('indoor', month, DB.climate.ANGUL).high;

  const rows = state.specimens.map((s) => {
    const outdoors = s.site && s.site !== 'indoor';
    const zoneHigh = outdoors ? zoneMonth(s.site, month, DB.climate.ANGUL).high : roomHigh;
    const cat = s.key ? catalogue(state).find((p) => p.key === s.key) : null;
    return {
      spec: s,
      cat,
      sched: schedule({
        base: { text: s.water || cat?.water || '' },
        zone: outdoors ? s.site : 'indoor',
        dayHighC: zoneHigh,
        lastWatered: s.watered
      })
    };
  });

  const due = rows.filter((r) => r.sched.due);
  const unknown = rows.filter((r) => !r.spec.key && !r.spec.idd);

  mount('v-pots', `
    <div class="sec">
      <div class="eyebrow">${rows.length} tracked · ${due.length} due</div>
      <h1 style="margin:4px 0 6px">Pots</h1>
      <p class="lede">
        Watering intervals are derived from the plant's stated rule, then adjusted for the zone
        it stands in, its container and today's heat. Where the rule is prose — "Rarely",
        "Change water weekly" — no countdown is invented; the rule is shown instead.
      </p>
    </div>

    ${unknown.length ? section('Unresolved', unknownPanel(unknown), {
      eyebrow: 'Two seconds each, and still not done'
    }) : ''}

    ${section('Due now', due.length
      ? due.map((r) => potCard(r, target)).join('')
      : empty('Nothing due. Check again this evening.'), { eyebrow: `${due.length}` })}

    ${section('Everything else', rows.filter((r) => !r.sched.due).length
      ? `<div class="grid g2">${rows.filter((r) => !r.sched.due).map((r) => potCard(r, target)).join('')}</div>`
      : empty('No pots tracked. Press "I own this" on anything in the catalogue.'))}

    ${section('Add a pot', addForm())}

    ${proseSection('the-tall-ones-almost-certainly-ginger-family')}
    ${proseSection('photographing-for-identification')}
  `);

  if (target) document.getElementById(`pot-${target}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

/* ------------------------------------------------------------------------- */

function unknownPanel(rows) {
  return `<div class="card hot">
    <p style="font-size:13.5px">
      <b>Do the crush-and-smell test on ${rows.length === 1 ? 'this one' : 'these ' + rows.length}.</b>
      Tear a piece of leaf, crush it, smell it. Ginger, turmeric and mango-ginger are unmistakable.
      If they are Zingiberaceae they want double the water and much more light, and they die back
      completely around December — do not throw the pots out when the leaves go.
    </p>
    <div class="row" style="margin-top:10px">
      ${rows.map((r) => `<button class="btn sm" data-act="idd" data-sid="${esc(r.spec.sid)}">${esc(r.spec.name)} — identified</button>`).join('')}
    </div>
  </div>`;
}

function potCard(r, target) {
  const s = r.spec;
  const sc = r.sched;
  const outdoors = s.site && s.site !== 'indoor';
  const since = s.watered ? daysSince(s.watered) : null;

  return `
  <article class="card" id="pot-${esc(s.sid)}" data-zone="${esc(outdoors ? s.site : 'indoor')}"
           ${!r.sched.due ? '' : 'style="margin-bottom:10px"'}>
    <div class="spread" style="align-items:flex-start">
      <div style="min-width:0">
        <h3>${esc(s.name || 'Unnamed pot')}</h3>
        <div class="subtle" style="font-style:italic">${esc(s.lat || r.cat?.lat || '')}</div>
      </div>
      ${chip(outdoors ? SITE_LBL[s.site] : (PLACE_LBL[s.zone] || 'Indoors'), { tone: 'zone' })}
    </div>

    <div class="row" style="margin:10px 0">
      ${sc.scheduled
        ? chip(sc.due ? (sc.overdueDays ? `${sc.overdueDays} days overdue` : 'Due today') : relDays(sc.dueInDays),
            { tone: sc.due ? 'no' : 'ok', dot: true })
        : chip(sc.rule || 'No fixed interval', { tone: 'watch' })}
      ${sc.scheduled ? chip(`every ${sc.intervalDays} d`, { mono: true, title: `base ${sc.baseDays} d, adjusted for zone, container and heat` }) : ''}
      ${since !== null ? chip(`watered ${relDays(-since)}`, { mono: true }) : chip('never watered', { tone: 'watch' })}
    </div>

    ${s.notes ? `<p class="subtle">${esc(s.notes)}</p>` : ''}

    <div class="row" style="margin-top:12px">
      <button class="btn pri" data-act="water" data-sid="${esc(s.sid)}">Watered</button>
      <button class="btn ghost danger" data-act="rmpot" data-sid="${esc(s.sid)}">Remove</button>
    </div>
  </article>`;
}

function addForm() {
  return `<form class="card" id="potform">
    <div class="grid g3" style="align-items:end">
      <label class="fld" style="grid-column:span 2"><span>Name</span>
        <input class="input" name="name" placeholder="Peperomia" required></label>
      <label class="fld"><span>Where</span>
        <select class="input" name="site">
          <option value="indoor">Indoors</option>
          ${['A', 'B', 'C', 'D', 'E'].map((z) => `<option value="${z}">Zone ${z}</option>`).join('')}
        </select></label>
      <label class="fld"><span>Light band (indoors)</span>
        <select class="input" name="zone">
          ${Object.entries(PLACE_LBL).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}
        </select></label>
      <label class="fld"><span>Watering rule</span>
        <input class="input" name="water" placeholder="8–12 days"></label>
      <button class="btn pri" type="submit">Add pot</button>
    </div>
  </form>`;
}

/* ------------------------------------------------------------------ wire -- */

export function wirePots() {
  on('water', (el, e, ds) => {
    store.waterSpecimen(ds.sid);
    toastUndo('Watering logged', () => store.undoWater(ds.sid));
  });

  on('idd', (el, e, ds) => {
    store.updateSpecimen(ds.sid, { idd: true });
    toast('Marked identified. Update the name and Latin name when you have them.');
  });

  on('rmpot', (el, e, ds) => {
    const gone = store.removeSpecimen(ds.sid);
    if (gone) toastUndo(`${gone.name || 'Pot'} removed`, () => store.addSpecimen(gone));
  });

  document.addEventListener('submit', (e) => {
    if (e.target.id !== 'potform') return;
    e.preventDefault();
    const f = new FormData(e.target);
    const name = String(f.get('name') || '').trim();
    if (!name) return;
    store.addSpecimen({
      name,
      site: f.get('site'),
      zone: f.get('zone'),
      water: String(f.get('water') || '')
    });
    e.target.reset();
    toast(`${name} added`);
  });
}

/** Wrap a lifted v9 block in v10's own section furniture. */
function proseSection(slug, mounts = {}, view = VIEW) {
  const block = prose(view, slug);
  if (!block) return '';
  return section(block.heading, proseHtml(view, slug, mounts), {
    eyebrow: block.sub || block.eyebrow || ''
  });
}
