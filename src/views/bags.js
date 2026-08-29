/* ============================================================================
   views/bags.js — bags, mixes and the soil calculator.

   Two calculators, because the site has two problems:

     OUTDOOR   a recipe by volume percentage, scaled to a grow-bag size, with
               amendments scaled alongside it. Amendments are where beginners
               come unstuck: a neem-cake rate that is right for a 75 L bag will
               burn the roots off a 12 L one.

     INDOOR    a parts-based recipe scaled to a set of pot diameters, because
               indoor pots are bought by diameter and mixed by the handful.

   Both carry the curing rule, which is the step people skip: coco must be
   charged with calcium nitrate or it locks up calcium invisibly, neem cake
   must mellow or it burns, and Trichoderma needs a week to colonise. Five to
   seven days, moist, covered, in shade. There is no shortcut.
   ========================================================================== */

import { esc, mount, on } from '../core/dom.js';
import { round } from '../core/util.js';
import { DB } from '../core/data.js';
import { section, chip, facts, empty, stepper } from '../ui/components.js';

let OUT = { recipe: 'woody', bag: '18×18' };
let IN = { mix: 'open', rows: [{ d: 6, n: 3 }] };

/** Volume of a round pot, litres, from diameter in inches. */
const potVolume = (d) => 0.00759 * d * d * d;

export function renderBags() {
  mount('v-bags', `
    <div class="sec">
      <div class="eyebrow">Containers · substrate · curing</div>
      <h1 style="margin:4px 0 6px">Bags and mix</h1>
      <p class="lede">
        A grow bag is not a pot with soft sides. Fabric air-prunes — roots stop at the wall and
        branch instead of circling — which is what makes a permanent container tree possible at
        all. Woven HDPE does not, and puts you on a mandatory two-year root-prune schedule.
      </p>
    </div>

    ${section('Outdoor mix calculator', outdoorCalc(), { eyebrow: 'By volume, scaled to the bag' })}
    ${section('Indoor mix calculator', indoorCalc(), { eyebrow: 'By parts, scaled to the pots' })}
    ${section('Curing', curing(), { eyebrow: 'Five to seven days. Not optional.' })}
    ${section('Bag types', bagTypes(), { eyebrow: 'What to buy and what to refuse' })}
    ${section('Bag sizes', sizeTable(), { eyebrow: 'Diameter × height, in litres' })}
  `);
}

/* --------------------------------------------------------------- outdoor -- */

function outdoorCalc() {
  const recipes = DB.soil.OMIX;
  const r = recipes[OUT.recipe];
  const size = DB.soil.BAGSIZES.find((b) => b.s === OUT.bag) || DB.soil.BAGSIZES[0];
  const litres = size.l;

  const rows = r.parts.map(([label, pct, colorVar]) => ({
    label, pct, colorVar, litres: round((litres * pct) / 100, 1)
  }));

  /* Amendments in the data are quoted per 100 L of finished mix. */
  const amendments = (r.am || []).map(([name, qty, why]) => {
    const m = /([\d.]+)\s*(g|kg|ml|l)\b/i.exec(qty);
    let scaled = qty;
    if (m) {
      const value = Number(m[1]) * (litres / 100);
      const unit = m[2].toLowerCase();
      scaled = unit === 'g' && value >= 1000
        ? round(value / 1000, 2) + ' kg'
        : round(value, value < 10 ? 1 : 0) + ' ' + unit;
    }
    return { name, qty: scaled, original: qty, why };
  });

  const bar = rows.map((x) =>
    `<span style="flex:${x.pct};background:var(${x.colorVar});height:100%" title="${esc(x.label)} ${x.pct}%"></span>`).join('');

  return `
  <div class="card">
    <div class="row" style="margin-bottom:12px">
      ${Object.entries(recipes).map(([k, v]) =>
        `<button class="chip ${OUT.recipe === k ? 'on' : ''}" data-act="omix" data-k="${k}">${esc(v.name)}</button>`).join('')}
    </div>
    <p class="subtle">For: ${esc(r.for)}</p>

    <label class="fld" style="max-width:280px;margin-top:12px"><span>Bag size</span>
      <select class="input" data-act="obag">
        ${DB.soil.BAGSIZES.map((b) => `<option value="${esc(b.s)}"${b.s === OUT.bag ? ' selected' : ''}>${esc(b.s)} · ${b.l} L</option>`).join('')}
      </select></label>

    <div style="display:flex;height:26px;border-radius:var(--r-xs);overflow:hidden;margin:16px 0 10px;border:1px solid var(--line)">${bar}</div>

    <div class="scrollx">
      <table class="data stack">
        <thead><tr><th>Component</th><th>Share</th><th>Volume</th></tr></thead>
        <tbody>${rows.map((x) => `<tr>
          <td data-l="Component">${esc(x.label)}</td>
          <td data-l="Share">${x.pct}%</td>
          <td data-l="Volume"><b class="num">${x.litres} L</b></td>
        </tr>`).join('')}
        <tr><td data-l="Component"><b>Total</b></td><td data-l="Share">100%</td><td data-l="Volume"><b class="num">${litres} L</b></td></tr>
        </tbody>
      </table>
    </div>

    ${amendments.length ? `
      <div class="eyebrow" style="margin:18px 0 8px">Amendments, scaled to ${litres} L</div>
      <div class="scrollx"><table class="data stack">
        <thead><tr><th>Amendment</th><th>For this bag</th><th>Per 100 L</th><th>What it does</th></tr></thead>
        <tbody>${amendments.map((a) => `<tr>
          <td data-l="Amendment">${esc(a.name)}</td>
          <td data-l="For this bag"><b class="num">${esc(a.qty)}</b></td>
          <td data-l="Per 100 L">${esc(a.original)}</td>
          <td data-l="What it does">${esc(a.why)}</td>
        </tr>`).join('')}</tbody>
      </table></div>` : ''}

    <p class="subtle" style="margin-top:12px">
      Skip the wood ash or dolomite if your pH is already above 7.5 — on this site it usually is,
      and adding lime to fly-ash-loaded substrate is how you build a bag nothing can feed in.
    </p>
  </div>`;
}

/* ---------------------------------------------------------------- indoor -- */

function indoorCalc() {
  const mix = DB.soil.MIXES.find((m) => m.k === IN.mix) || DB.soil.MIXES[0];
  const totalLitres = IN.rows.reduce((a, r) => a + potVolume(r.d) * r.n, 0);
  const totalParts = Object.values(mix.parts).reduce((a, b) => a + b, 0);

  const components = Object.entries(mix.parts).map(([k, parts]) => {
    const [label, costPerLitre] = DB.soil.COMP[k] || [k, 0];
    const litres = (totalLitres * parts) / totalParts;
    return { label, litres: round(litres, 2), cost: Math.round(litres * costPerLitre * 100) / 100 };
  });

  const cost = components.reduce((a, c) => a + c.cost, 0);

  return `
  <div class="card">
    <div class="row" style="margin-bottom:12px">
      ${DB.soil.MIXES.map((m) =>
        `<button class="chip ${IN.mix === m.k ? 'on' : ''}" data-act="imix" data-k="${esc(m.k)}">${esc(m.n)}</button>`).join('')}
    </div>
    <p class="subtle">${esc(mix.who)}</p>
    <p class="subtle" style="margin-top:4px;font-style:italic">${esc(mix.nt)}</p>

    <div class="eyebrow" style="margin:16px 0 8px">Pots to fill</div>
    ${IN.rows.map((r, i) => `
      <div class="row" style="margin-bottom:8px">
        <label class="fld"><span>Diameter (in)</span>
          <input class="input" type="number" min="2" max="24" value="${r.d}" data-act="irow" data-i="${i}" data-k="d" style="width:110px"></label>
        <label class="fld"><span>How many</span>
          <input class="input" type="number" min="1" max="50" value="${r.n}" data-act="irow" data-i="${i}" data-k="n" style="width:110px"></label>
        <span class="chip tone-mono" style="align-self:flex-end;margin-bottom:9px">${round(potVolume(r.d), 2)} L each</span>
        ${IN.rows.length > 1 ? `<button class="btn sm ghost danger" data-act="irm" data-i="${i}" style="align-self:flex-end;margin-bottom:5px">×</button>` : ''}
      </div>`).join('')}
    <button class="btn sm" data-act="iadd">Add another size</button>

    <div class="scrollx" style="margin-top:16px">
      <table class="data stack">
        <thead><tr><th>Component</th><th>Volume</th><th>Cost</th></tr></thead>
        <tbody>${components.map((c) => `<tr>
          <td data-l="Component">${esc(c.label)}</td>
          <td data-l="Volume"><b class="num">${c.litres} L</b></td>
          <td data-l="Cost">₹${c.cost.toFixed(2)}</td>
        </tr>`).join('')}
        <tr><td data-l="Component"><b>Total</b></td>
            <td data-l="Volume"><b class="num">${round(totalLitres, 2)} L</b></td>
            <td data-l="Cost"><b>₹${cost.toFixed(2)}</b></td></tr>
        </tbody>
      </table>
    </div>
    <p class="subtle" style="margin-top:10px">
      Mix 15–20% more than the arithmetic says. Substrate settles, and running out halfway
      through repotting a root-bare plant is how plants get left sitting in a bucket.
    </p>
  </div>`;
}

/* ---------------------------------------------------------------- curing -- */

function curing() {
  return stepper([
    { title: 'Charge the coco', body: 'Soak coco peat in calcium nitrate solution at 1 g/L for 12 hours, then rinse once.', why: 'Raw coco holds sodium and potassium on its exchange sites and swaps them for the calcium your plant needs. Untreated, it starves the plant of calcium invisibly — blossom-end rot on the tomatoes, tip burn on everything else.' },
    { title: 'Mix everything dry', body: 'Components first, then amendments, on a tarpaulin. Turn it three times.', why: 'Pockets of neat neem cake burn roots. Even distribution is the whole job.' },
    { title: 'Wet to field capacity', body: 'Damp enough to hold a shape when squeezed, not so wet that it drips.', why: 'Trichoderma and the soil biology need moisture to colonise. Bone dry mix cures nothing.' },
    { title: 'Cover and wait 5–7 days', body: 'A sack or tarp, in shade. Turn it once on day three.', why: 'Neem cake mellows, the mycorrhiza establishes, and the Trichoderma colonises before any root meets it. Plant into fresh mix and you get the burn without the protection.' },
    { title: 'Then pot up', body: 'After 4 pm or on an overcast day. Drench with Trichoderma and Pseudomonas at 5 g/L, one litre per bag.', why: 'Midday potting adds transplant shock to heat shock. Feeding a freshly cut root system burns it — nothing but water for 21 days.' }
  ]);
}

/* ------------------------------------------------------------- reference -- */

function bagTypes() {
  const tone = { y: 'ok', m: 'watch', n: 'no' };
  return `<div class="grid g2">${DB.soil.BAGTYPES.map((b) => `
    <article class="card">
      <div class="spread" style="align-items:flex-start">
        <div><h3>${esc(b.n)}</h3><div class="subtle">${esc(b.sub)}</div></div>
        ${chip(b.v === 'y' ? 'Use this' : b.v === 'm' ? 'Sometimes' : 'Never', { tone: tone[b.v], dot: true })}
      </div>
      ${facts([['Life in sun', b.life], ['Roots', b.root]])}
      <p style="font-size:13.5px;margin-top:10px"><b>${esc(b.verdict)}</b></p>
    </article>`).join('')}</div>`;
}

function sizeTable() {
  return `<div class="scrollx"><table class="data stack">
    <thead><tr><th>Size</th><th>Litres</th><th>Water per soak</th><th>Mix needed</th></tr></thead>
    <tbody>${DB.soil.BAGSIZES.map((b) => `<tr>
      <td data-l="Size"><b>${esc(b.s)}</b></td>
      <td data-l="Litres" class="num">${b.l} L</td>
      <td data-l="Water per soak" class="num">${round(b.l * 0.25, 1)} L</td>
      <td data-l="Mix needed" class="num">${round(b.l * 1.15, 0)} L</td>
    </tr>`).join('')}</tbody>
  </table></div>
  <p class="subtle" style="margin-top:10px">
    Water per soak is a quarter of substrate volume — enough to wet through and run 10–15% from
    the base. Little and often is what builds the salt crust.
  </p>`;
}

/* ------------------------------------------------------------------ wire -- */

export function wireBags() {
  on('omix', (el, e, ds) => { OUT.recipe = ds.k; renderBags(); });
  on('obag', (el) => { OUT.bag = el.value; renderBags(); });
  on('imix', (el, e, ds) => { IN.mix = ds.k; renderBags(); });
  on('iadd', () => { IN.rows.push({ d: 8, n: 1 }); renderBags(); });
  on('irm', (el, e, ds) => { IN.rows.splice(Number(ds.i), 1); renderBags(); });
  on('irow', (el, e, ds) => {
    IN.rows[Number(ds.i)][ds.k] = Math.max(1, Number(el.value) || 1);
    renderBags();
  });
}
