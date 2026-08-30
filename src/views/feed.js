/* ============================================================================
   views/feed.js — fertiliser: dose calculator, pH, coal-ash compensation and
   the deficiency guide.

   The deficiency guide's trick, and the reason it is worth a screen: look at
   WHICH leaves are affected before you look at the colour. Nitrogen, potassium
   and magnesium are mobile — the plant strips them out of old leaves to feed
   new growth, so the damage starts at the bottom. Iron, calcium, sulphur and
   zinc are not — the damage starts at the top. Same yellow, opposite cause,
   opposite fix.
   ========================================================================== */

import { esc, mount, on, byId } from '../core/dom.js';
import { MONFULL, round } from '../core/util.js';
import * as store from '../core/store.js';
import { DB, proseHtml, prose } from '../core/data.js';
import { dose, doseVerdict, phBand, PH_BANDS, sulphurDose, acidifyWater, ashDrift,
  ironChelate, saltLoad, feedGate, PRODUCTS } from '../engine/feed.js';
import { zoneMonth, heatIndexC } from '../engine/heat.js';
import { section, chip, facts, meter, empty } from '../ui/components.js';
import { toast } from '../ui/toast.js';

let DOSE = { product: 0, bagLitres: 43, strength: 1 };
let PH = { current: 7.8, target: 6.2, bagLitres: 43, buffering: 'coco', zone: 'A' };
let MOBILITY = 'all';
const VIEW = 'feed';

export function renderFeed() {
  const m = new Date().getMonth();
  const zoneA = zoneMonth('A', m, DB.climate.ANGUL);
  const gate = feedGate(m, { heatIndexC: heatIndexC(zoneA.high, zoneA.rh) });

  mount('v-feed', `
    <div class="sec">
      <div class="eyebrow">Fertiliser · pH · deficiencies</div>
      <h1 style="margin:4px 0 6px">Feed</h1>
      <p class="lede">
        Coal ash makes this site alkaline, and above pH 7.5 iron, manganese and zinc go
        chemically unavailable. A plant can be standing in nutrients and starving. Feeding
        harder makes it worse — more salt, same lock-out. The fix is acidification and a
        chelate the high pH cannot break.
      </p>
    </div>

    ${gatePanel(gate, m)}
    ${section('Dose calculator', dosePanel(), { eyebrow: 'Per bag, not per hectare' })}
    ${section('pH and coal-ash compensation', phPanel(), { eyebrow: 'The local problem' })}
    ${section('Reading a yellow leaf', deficiencyPanel(), { eyebrow: 'Position first, colour second' })}
    ${section('Salt', saltPanel(), { eyebrow: 'Why the leaf margins scorch' })}
    ${proseSection('the-rule-that-solves-most-of-it')}
    ${proseSection('what-the-numbers-mean', { npktable: npkTable() })}
    ${proseSection('organic-inputs', { orgtable: organicTable() })}
    ${proseSection('ph-decides-whether-any-of-it-works', { phbands: '' })}
    ${proseSection('salt-buildup-and-how-to-flush-it', { saltsym: '', saltfix: '' })}
    ${section('The feeding year', calendarPanel(), { eyebrow: 'Including the month you feed nothing' })}
    ${proseSection('six-things-not-to-do', { feeddont: dontList() })}
  `);
}

/* ------------------------------------------------------------------------- */

function gatePanel(gate, m) {
  const tone = gate.feed === false ? 'no' : gate.feed === 'light' ? 'watch' : 'ok';
  const label = gate.feed === false ? 'Do not feed' : gate.feed === 'light' ? 'Half strength' : 'Feed normally';
  return `<div class="sec"><div class="card ${gate.feed === false ? 'hot' : ''}">
    <div class="spread"><div class="eyebrow">${esc(MONFULL[m])}</div>${chip(label, { tone, dot: true })}</div>
    <p style="font-size:14px;margin-top:8px">${esc(gate.why)}</p>
  </div></div>`;
}

/* --------------------------------------------------------------- dosing --- */

function dosePanel() {
  const p = PRODUCTS[DOSE.product];
  const d = dose(p, DOSE.bagLitres, DOSE.strength);
  const v = doseVerdict(d.ppm.n);

  return `
  <div class="card">
    <div class="grid g3" style="align-items:end">
      <label class="fld" style="grid-column:span 2"><span>Product</span>
        <select class="input" data-act="dose-set" data-k="product">
          ${PRODUCTS.map((x, i) => `<option value="${i}"${i === DOSE.product ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}
        </select></label>
      <label class="fld"><span>Bag volume (L)</span>
        <input class="input" type="number" min="1" step="1" value="${DOSE.bagLitres}" data-act="dose-set" data-k="bagLitres"></label>
      <label class="fld"><span>Strength</span>
        <select class="input" data-act="dose-set" data-k="strength">
          <option value="0.5"${DOSE.strength === 0.5 ? ' selected' : ''}>Half — new plant, winter</option>
          <option value="1"${DOSE.strength === 1 ? ' selected' : ''}>Label rate</option>
          <option value="1.5"${DOSE.strength === 1.5 ? ' selected' : ''}>One and a half — heavy feeder in flush</option>
        </select></label>
    </div>

    <div class="grid g4" style="margin-top:16px">
      <div class="card flat"><div class="eyebrow">Make up</div>
        <div class="num" style="font-size:24px">${d.solutionLitres} L</div>
        <div class="subtle">a quarter of substrate volume</div></div>
      <div class="card flat"><div class="eyebrow">Weigh out</div>
        <div class="num" style="font-size:24px">${d.grams} g</div>
        <div class="subtle">${d.gPerL} g per litre</div></div>
      <div class="card flat"><div class="eyebrow">Nitrogen</div>
        <div class="num" style="font-size:24px">${d.ppm.n} <span style="font-size:12px">ppm</span></div>
        <div class="subtle">${esc(v.label)}</div></div>
      <div class="card flat"><div class="eyebrow">Per bag</div>
        <div class="num" style="font-size:17px;margin-top:4px">${d.mgPerBag.n} / ${d.mgPerBag.p} / ${d.mgPerBag.k}</div>
        <div class="subtle">mg N–P–K delivered</div></div>
    </div>

    <p class="subtle" style="margin-top:12px"><b>${esc(v.label)}.</b> ${esc(v.text)}</p>
    <p class="subtle" style="margin-top:6px">${esc(p.use)}</p>
    <p class="subtle" style="margin-top:6px">
      The feed IS the watering. Give it in place of a watering, not in addition to one, or you
      water twice and leach half of it straight out of the base.
    </p>

    <div class="scrollx" style="margin-top:16px">
      <div class="eyebrow" style="margin-bottom:8px">What to feed what</div>
      <table class="data stack">
        <thead><tr><th>Group</th><th>Strength</th><th>How often</th><th>Note</th></tr></thead>
        <tbody>${DB.feed.FEEDS.map((row) => `<tr>
          ${row.map((cell, i) => `<td data-l="${['Group', 'Strength', 'How often', 'Note'][i] || ''}">${deent(cell)}</td>`).join('')}
        </tr>`).join('')}</tbody>
      </table>
    </div>
  </div>`;
}

/* The shipped reference tables were authored as HTML fragments, so entities
   like &amp; and &ndash; are already encoded. Decode once, then re-escape. */
function deent(s) {
  const t = document.createElement('textarea');
  t.innerHTML = String(s ?? '');
  return esc(t.value);
}

/* ------------------------------------------------------------------- pH --- */

function phPanel() {
  const band = phBand(PH.current);
  const s = sulphurDose(PH.bagLitres, PH.current, PH.target, PH.buffering);
  const acid = acidifyWater(10, PH.current, PH.target);
  const drift = ashDrift({ zone: PH.zone, months: 6 });
  const fe = ironChelate(PH.current);

  return `
  <div class="card">
    <div class="grid g4" style="align-items:end">
      <label class="fld"><span>Measured pH</span>
        <input class="input" type="number" step="0.1" min="3" max="10" value="${PH.current}" data-act="ph-set" data-k="current"></label>
      <label class="fld"><span>Target pH</span>
        <input class="input" type="number" step="0.1" min="4" max="8" value="${PH.target}" data-act="ph-set" data-k="target"></label>
      <label class="fld"><span>Bag volume (L)</span>
        <input class="input" type="number" min="1" value="${PH.bagLitres}" data-act="ph-set" data-k="bagLitres"></label>
      <label class="fld"><span>Mix</span>
        <select class="input" data-act="ph-set" data-k="buffering">
          ${['sand', 'coco', 'loam', 'ash'].map((b) => `<option value="${b}"${PH.buffering === b ? ' selected' : ''}>${b}</option>`).join('')}
        </select></label>
    </div>

    <div class="card ${band.key === 'ideal' ? '' : 'hot'} flat" style="margin-top:14px">
      <div class="spread"><div class="eyebrow">${esc(band.label)}</div>${chip('pH ' + PH.current, { mono: true })}</div>
      <p style="font-size:13.5px;margin-top:6px">${esc(band.note)}</p>
    </div>

    <div class="grid g2" style="margin-top:14px">
      <div class="card sunk">
        <div class="eyebrow">Slow fix · elemental sulphur</div>
        <div class="num" style="font-size:24px;margin-top:4px">${s.grams} g</div>
        <div class="subtle">per ${PH.bagLitres} L bag · works in ${s.weeks} weeks</div>
        <p class="subtle" style="margin-top:6px">${esc(s.note)}</p>
      </div>
      <div class="card sunk">
        <div class="eyebrow">Same-week fix · acidify the water</div>
        <div class="num" style="font-size:24px;margin-top:4px">${acid ? acid.vinegarMl + ' ml' : '—'}</div>
        <div class="subtle">${acid ? `5% vinegar per 10 L · or ${acid.citricG} g citric acid` : 'already at target'}</div>
        <p class="subtle" style="margin-top:6px">${acid ? esc(acid.warn) : ''}</p>
      </div>
      <div class="card sunk">
        <div class="eyebrow">Iron chelate that will actually work</div>
        <div class="num" style="font-size:20px;margin-top:4px">${esc(fe.form)}</div>
        <p class="subtle" style="margin-top:6px">${esc(fe.note)}</p>
      </div>
      <div class="card sunk">
        <div class="eyebrow">Coal-ash drift</div>
        <div class="row" style="margin:6px 0">
          <select class="input" data-act="ph-set" data-k="zone" style="width:auto">
            ${['A', 'B', 'C', 'D', 'E'].map((z) => `<option value="${z}"${PH.zone === z ? ' selected' : ''}>Zone ${z}</option>`).join('')}
          </select>
        </div>
        <div class="num" style="font-size:20px">+${drift.drift} pH / 6 months</div>
        <p class="subtle" style="margin-top:6px">${esc(drift.fix)}</p>
      </div>
    </div>

    <div class="scrollx" style="margin-top:14px">
      <table class="data stack">
        <thead><tr><th>Band</th><th>Up to pH</th><th>What happens</th></tr></thead>
        <tbody>${PH_BANDS.map((b) => `<tr class="${b.key === band.key ? 'on' : ''}">
          <td data-l="Band"><b>${esc(b.label)}</b></td>
          <td data-l="Up to pH">${b.max === 14 ? '—' : b.max}</td>
          <td data-l="What happens">${esc(b.note)}</td></tr>`).join('')}</tbody>
      </table>
    </div>
  </div>`;
}

/* ----------------------------------------------------------- deficiency --- */

function deficiencyPanel() {
  const rows = DB.feed.DEFIC || [];
  const filtered = MOBILITY === 'all' ? rows : rows.filter((d) => mobilityOf(d) === MOBILITY);

  return `
    <div class="row" style="margin-bottom:12px">
      ${[['all', 'All'], ['mobile', 'Old leaves first · mobile'], ['immobile', 'New leaves first · immobile']]
        .map(([k, l]) => `<button class="chip ${MOBILITY === k ? 'on' : ''}" data-act="mob" data-k="${k}">${l}</button>`).join('')}
    </div>
    <div class="grid g2">
      ${filtered.map((d) => `
        <article class="card">
          <div class="spread">
            <h3>${deent(d.n)}</h3>
            ${chip(d.mob === 'mobile' ? 'Old leaves first' : 'New leaves first',
              { tone: d.mob === 'mobile' ? 'watch' : 'no' })}
          </div>
          <div class="row" style="margin:8px 0">${chip(deent(d.where), { mono: true })}</div>
          <p style="font-size:13.5px">${deent(d.sym)}</p>
          ${facts([['Fix', deent(d.fix)], ['Here', deent(d.here)]])}
        </article>`).join('')}
    </div>
    <p class="subtle" style="margin-top:12px">
      On this site, interveinal yellowing on NEW growth is iron nine times out of ten, and it is
      almost never a shortage of iron — it is pH. Add EDDHA and acidify; adding more of a
      general-purpose feed will not touch it.
    </p>`;
}

const mobilityOf = (d) => (d.mob === 'mobile' ? 'mobile' : 'immobile');

/* ----------------------------------------------------------------- salt --- */

function saltPanel() {
  const s = saltLoad({ feedsSinceFlush: 8, gPerFeed: 3, bagLitres: 43 });
  return `<div class="card">
    <p class="lede" style="font-size:13.5px">
      Eight fortnightly feeds into a 43 L bag with no leaching gets you to roughly
      ${s.ecEstimate} dS/m — ${esc(s.label.toLowerCase())}. Leaf-margin scorch that looks like
      sunburn is usually this, not the sun.
    </p>
    <div class="grid g3" style="margin-top:12px">
      <div class="card flat"><div class="eyebrow">Estimated EC</div><div class="num" style="font-size:22px">${s.ecEstimate}</div></div>
      <div class="card flat"><div class="eyebrow">Flush with</div><div class="num" style="font-size:22px">${s.flushLitres} L</div></div>
      <div class="card flat"><div class="eyebrow">Status</div><div class="num" style="font-size:22px">${esc(s.label)}</div></div>
    </div>
    <p class="subtle" style="margin-top:10px">${esc(s.note)}</p>

    <div class="grid g2" style="margin-top:14px">
      <div class="card sunk">
        <div class="eyebrow">How you know</div>
        <ul style="margin:8px 0 0 16px;font-size:13px">
          ${(DB.feed.SALT.sym || []).map((x) => `<li>${deent(x)}</li>`).join('')}
        </ul>
      </div>
      <div class="card sunk">
        <div class="eyebrow">How to flush it</div>
        <ol style="margin:8px 0 0 16px;font-size:13px">
          ${(DB.feed.SALT.fix || []).map((x) => `<li>${deent(x)}</li>`).join('')}
        </ol>
      </div>
    </div>
  </div>`;
}

/* ---------------------------------------------------------- NPK reference -- */

function npkTable() {
  return `<div class="scrollx"><table class="data stack">
    <thead><tr><th>Analysis</th><th>Use</th><th>When</th><th>Rate</th><th>Why</th></tr></thead>
    <tbody>${DB.feed.NPKS.map((n) => `<tr>
      <td data-l="Analysis"><b class="num">${deent(n.n)}</b></td>
      <td data-l="Use">${deent(n.use)}</td>
      <td data-l="When">${deent(n.when)}</td>
      <td data-l="Rate" class="num">${deent(n.rate)}</td>
      <td data-l="Why">${deent(n.why)}</td>
    </tr>`).join('')}</tbody>
  </table></div>
  <p class="subtle" style="margin-top:10px">
    The three numbers are percentages by weight of nitrogen, phosphorus (as P₂O₅) and
    potassium (as K₂O). They never add to 100 — the rest is carrier and filler.
  </p>`;
}

/* -------------------------------------------------------- organic inputs --- */

function organicTable() {
  return `<div class="grid g2">${DB.feed.ORGIN.map((o) => `
    <article class="card">
      <div class="spread">
        <h3>${deent(o.n)}</h3>
        ${chip(deent(o.npk), { mono: true, title: 'Approximate analysis' })}
      </div>
      <p class="subtle" style="margin-top:6px"><b>Rate:</b> ${deent(o.rate)}</p>
      <p style="font-size:13.5px;margin-top:8px">${deent(o.d)}</p>
    </article>`).join('')}</div>`;
}

/* ------------------------------------------------------------ six do-nots -- */

function dontList() {
  return DB.feed.FEEDDONT.map(([title, why], i) => `
    <div class="task" data-pri="hi" style="margin-bottom:8px">
      <div class="num" style="color:var(--danger);font-weight:700">${i + 1}</div>
      <div>
        <div class="tt">${deent(title)}</div>
        <div class="td">${deent(why)}</div>
      </div>
      <div></div>
    </div>`).join('');
}

/* ------------------------------------------------------------- calendar --- */

function calendarPanel() {
  const cal = DB.feed.FEEDCAL || [];
  if (!cal.length) return empty('No feeding calendar in the data bundle.');
  return `<div class="grid g3">${cal.map((c, i) => `
    <div class="card ${i === new Date().getMonth() ? 'hot' : 'flat'}">
      <div class="spread">
        <span class="eyebrow">${MONFULL[i]}</span>
        ${chip(deent(c.hp), { tone: /hold|none|nothing/i.test(c.hp || '') ? 'no' : /light/i.test(c.hp || '') ? 'watch' : 'ok' })}
      </div>
      <div style="font-size:13.5px;font-weight:600;margin-top:6px">${deent(c.w)}</div>
      <p class="subtle" style="margin-top:4px">${deent(c.d)}</p>
    </div>`).join('')}</div>`;
}

/* ------------------------------------------------------------------ wire -- */

export function wireFeed() {
  on('dose-set', (el, e, ds) => {
    DOSE[ds.k] = ds.k === 'product' ? Number(el.value) : Number(el.value) || DOSE[ds.k];
    renderFeed();
  });
  on('ph-set', (el, e, ds) => {
    PH[ds.k] = ds.k === 'buffering' || ds.k === 'zone' ? el.value : Number(el.value) || PH[ds.k];
    renderFeed();
  });
  on('mob', (el, e, ds) => { MOBILITY = ds.k; renderFeed(); });
}

/** Wrap a lifted v9 block in v10's own section furniture. */
function proseSection(slug, mounts = {}, view = VIEW) {
  const block = prose(view, slug);
  if (!block) return '';
  return section(block.heading, proseHtml(view, slug, mounts), {
    eyebrow: block.sub || block.eyebrow || ''
  });
}
