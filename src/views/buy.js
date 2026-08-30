/* ============================================================================
   views/buy.js — the buy list, the gear checklist and the sellers.

   The one piece of advice this screen exists to deliver: buy the rack and the
   grow light BEFORE buying another plant. Half the catalogue cannot survive
   that room on window light alone, and a plant bought into inadequate light
   does not fail quickly — it declines for four months and then dies, which
   teaches the owner nothing except that they are bad at this.

   Gear is therefore listed first and plants second, which is the opposite of
   the order anyone wants to shop in.
   ========================================================================== */

import { esc, mount, on } from '../core/dom.js';
import { money, sum } from '../core/util.js';
import * as store from '../core/store.js';
import { DB, catalogue, sources, proseHtml, prose } from '../core/data.js';
import { section, chip, facts, empty } from '../ui/components.js';
import { toast } from '../ui/toast.js';

const VIEW = 'buy';
const BUDGET = 5000;   // stated monthly ceiling

export function renderBuy() {
  const state = store.get();
  const cat = catalogue(state);
  const picked = state.picks.map((k) => cat.find((p) => p.key === k)).filter(Boolean);

  mount('v-buy', `
    <div class="sec">
      <div class="eyebrow">Budget ${money(BUDGET)} a month</div>
      <h1 style="margin:4px 0 6px">Buying</h1>
      <p class="lede">
        Gear before plants. Half the catalogue cannot survive that room on window light alone,
        and a plant bought into light it cannot use declines quietly for four months before it
        dies — which teaches you nothing except that you are bad at this. You are not; the light
        was.
      </p>
    </div>

    ${section('The buy list', buyList(picked, state), {
      eyebrow: `${picked.length} ${picked.length === 1 ? 'item' : 'items'}`,
      aside: picked.length ? `<button class="btn sm" data-act="copylist">Copy as text</button>` : ''
    })}

    ${section('Gear checklist', gearList(state), { eyebrow: 'Bought before plants, not after' })}
    ${proseSection('four-months-at-5-000')}
    ${section('Staged against what you already own', budgetPlan(), { eyebrow: 'Recomputed from the gear list' })}
    ${proseSection('where-to-buy', { srctable: sellerTable(state) })}
  `);
}

/* ------------------------------------------------------------------------- */

function buyList(picked, state) {
  if (!picked.length) {
    return empty('Nothing on the list. Press "Buy" on anything in the catalogue.');
  }
  const total = sum(picked, (p) => (p.price || 0) * (state.qty[p.key] || 1));

  return `
    <div class="scrollx"><table class="data stack">
      <thead><tr><th>Plant</th><th>Where</th><th>Qty</th><th>Each</th><th>Total</th><th></th></tr></thead>
      <tbody>${picked.map((p) => {
        const qty = state.qty[p.key] || 1;
        return `<tr>
          <td data-l="Plant"><b>${esc(p.name)}</b>
            <div class="subtle" style="font-style:italic">${esc(p.lat || '')}</div></td>
          <td data-l="Where">${esc(sources(state)[p.src]?.[0] || p.src || '—')}</td>
          <td data-l="Qty"><input class="input" type="number" min="1" max="99" value="${qty}"
                 data-act="qty" data-key="${esc(p.key)}" style="width:70px"></td>
          <td data-l="Each" class="num">${money(p.price)}</td>
          <td data-l="Total" class="num">${money((p.price || 0) * qty)}</td>
          <td><button class="btn sm ghost danger" data-act="unpick" data-key="${esc(p.key)}">×</button></td>
        </tr>`;
      }).join('')}
      <tr><td data-l="Plant"><b>Total</b></td><td></td><td></td><td></td>
          <td data-l="Total" class="num"><b>${money(total)}</b></td><td></td></tr>
      </tbody>
    </table></div>
    ${total > BUDGET ? `<p class="subtle" style="color:var(--warn);margin-top:10px">
      That is ${money(total - BUDGET)} over one month's budget. Split it across two orders —
      and if you are choosing what to defer, defer plants, not light.
    </p>` : ''}`;
}

/* GEAR rows: [name, why, price, essential] */
function gearList(state) {
  const owned = new Set(state.gear || []);
  const rows = DB.sources.GEAR;
  const essential = rows.filter((g) => g[3]);
  const outstanding = essential.filter((g) => !owned.has(g[0]));
  const outstandingCost = sum(outstanding, (g) => g[2]);

  return `
    <div class="grid g4" style="margin-bottom:14px">
      <div class="card"><div class="eyebrow">Items</div>
        <div class="num" style="font-size:24px">${rows.length}</div></div>
      <div class="card"><div class="eyebrow">Essential</div>
        <div class="num" style="font-size:24px">${essential.length}</div></div>
      <div class="card"><div class="eyebrow">Still to buy</div>
        <div class="num" style="font-size:24px">${outstanding.length}</div></div>
      <div class="card"><div class="eyebrow">Outstanding cost</div>
        <div class="num" style="font-size:24px">${money(outstandingCost)}</div></div>
    </div>

    <div class="scrollx"><table class="data stack">
      <thead><tr><th>Have it</th><th>Item</th><th>Why</th><th>Price</th></tr></thead>
      <tbody>${rows.map(([name, why, price, must]) => `<tr>
        <td data-l="Have it">
          <button class="box" data-act="gear" data-name="${esc(name)}"
                  aria-pressed="${owned.has(name)}" aria-label="Mark bought"
                  style="${owned.has(name) ? 'background:var(--accent);border-color:var(--accent)' : ''}"></button>
        </td>
        <td data-l="Item"><b>${esc(name)}</b>
          ${must ? ' ' + chip('Essential', { tone: 'no' }) : ''}</td>
        <td data-l="Why">${esc(why)}</td>
        <td data-l="Price" class="num">${money(price)}</td>
      </tr>`).join('')}</tbody>
    </table></div>`;
}

function budgetPlan() {
  const gear = DB.sources.GEAR;
  const essential = gear.filter((g) => g[3]);
  const light = essential.filter((g) => /light|timer|rack|shelf|fan/i.test(g[0]));
  const rest = essential.filter((g) => !light.includes(g));

  const months = [
    { n: 'Month 1', what: 'Light and the rack. Nothing green.', items: light },
    { n: 'Month 2', what: 'The rest of the essential kit, plus the first six plants.', items: rest.slice(0, 6) },
    { n: 'Month 3', what: 'Soil, bags and amendments for the outdoor potting-up.', items: rest.slice(6, 12) },
    { n: 'Month 4', what: 'The seed order and whatever the first three months proved you needed.', items: rest.slice(12) }
  ];

  return `<div class="grid g2">${months.map((m) => {
    const cost = sum(m.items, (g) => g[2]);
    return `<article class="card">
      <div class="spread">
        <h3>${esc(m.n)}</h3>
        <span class="pill ${cost > BUDGET ? 'bad' : 'ok'}">${money(cost)}</span>
      </div>
      <p class="subtle" style="margin-top:6px">${esc(m.what)}</p>
      ${m.items.length ? `<ul style="margin:10px 0 0 16px;font-size:13px;color:var(--ink-2)">
        ${m.items.map((g) => `<li>${esc(g[0])} · ${money(g[2])}</li>`).join('')}
      </ul>` : '<p class="subtle" style="margin-top:8px">Nothing left on the essential list.</p>'}
    </article>`;
  }).join('')}</div>
  <p class="subtle" style="margin-top:12px">
    Staged from the gear list, essentials first. The order matters more than the total:
    everything in month one is what makes months two to four survivable.
  </p>`;
}

/* SRC entries: key -> [name, strength, ships, catch] */
function sellerTable(state) {
  const all = sources(state);
  return `<div class="scrollx"><table class="data stack">
    <thead><tr><th>Seller</th><th>Good for</th><th>Ships</th><th>The catch</th></tr></thead>
    <tbody>${Object.entries(all).map(([key, row]) => `<tr>
      <td data-l="Seller"><b>${esc(row[0])}</b> <span class="subtle">${esc(key)}</span></td>
      <td data-l="Good for">${esc(row[1] || '')}</td>
      <td data-l="Ships">${esc(row[2] || '')}</td>
      <td data-l="The catch" style="color:var(--muted)">${esc(row[3] || '')}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

/** Wrap a lifted v9 block in v10's own section furniture. */
function proseSection(slug, mounts = {}, view = VIEW) {
  const block = prose(view, slug);
  if (!block) return '';
  return section(block.heading, proseHtml(view, slug, mounts), {
    eyebrow: block.sub || block.eyebrow || ''
  });
}

/* ------------------------------------------------------------------ wire -- */

export function wireBuy() {
  on('unpick', (el, e, ds) => { store.togglePick(ds.key); });

  on('qty', (el, e, ds) => { store.setQty(ds.key, el.value); });

  on('gear', (el, e, ds) => {
    const state = store.get();
    const i = state.gear.indexOf(ds.name);
    if (i < 0) state.gear.push(ds.name); else state.gear.splice(i, 1);
    store.commit('gear');
  });

  on('copylist', () => {
    const state = store.get();
    const cat = catalogue(state);
    const lines = state.picks.map((k) => {
      const p = cat.find((x) => x.key === k);
      if (!p) return null;
      const qty = state.qty[k] || 1;
      return `${qty} × ${p.name}${p.lat ? ` (${p.lat})` : ''} — ${money(p.price)}`;
    }).filter(Boolean);
    const text = lines.join('\n');
    navigator.clipboard?.writeText(text)
      .then(() => toast(`${lines.length} lines copied`))
      .catch(() => toast('Could not reach the clipboard on this browser'));
  });
}
