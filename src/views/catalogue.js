/* ============================================================================
   views/catalogue.js — 225 entries: houseplants, fruit, vegetables, seed packets.

   The filter that earns its place is VERDICT. "Ruled out — and why" is the most
   valuable list in the app: apple, litchi, peach, mangosteen, durian and
   Alphonso are all sold in Indian nurseries and none of them will fruit here.
   Each carries the reason. That list saves more money than everything else
   combined, so it is a first-class filter rather than a footnote.
   ========================================================================== */

import { esc, mount, on, byId } from '../core/dom.js';
import { debounce, money } from '../core/util.js';
import * as store from '../core/store.js';
import { catalogue, VERDICT_LBL, SITE_LBL, KIND_LBL, PLACE_LBL, DB } from '../core/data.js';
import { chillHours } from '../engine/solar.js';
import { knowledgeCard, section, chip, empty } from '../ui/components.js';
import { rank } from '../ui/search.js';
import { toast } from '../ui/toast.js';

const F = { q: '', kind: '', site: '', verdict: '', owned: false, picked: false, budget: false };
let SITE_CHILL = 0;

export function renderCatalogue(target = '') {
  const state = store.get();
  SITE_CHILL ||= chillHours(DB.climate.ANGUL);

  const all = catalogue(state);
  const filtered = applyFilters(all, state);

  mount('v-catalogue', `
    <div class="sec">
      <div class="eyebrow">One catalogue · ${all.length} entries</div>
      <h1 style="margin:4px 0 6px">Catalogue</h1>
      <p class="lede">
        Houseplants, fruit trees, vegetables and seed packets in one list. Every fruit entry
        says how it is propagated, because that decides everything: a grafted mango fruits in
        three years, a seedling takes eight and will not taste like its parent.
      </p>
    </div>

    ${filterBar(all)}

    <div class="sec">
      <div class="sechead">
        <h2>${filtered.length} ${filtered.length === 1 ? 'entry' : 'entries'}</h2>
        <span class="pill">${money(filtered.reduce((a, p) => a + (p.price || 0), 0))} if you bought all of it</span>
      </div>
      ${filtered.length
        ? `<div class="grid g2">${filtered.slice(0, 120).map((p) => card(p, state)).join('')}</div>
           ${filtered.length > 120 ? `<p class="subtle" style="margin-top:12px">Showing the first 120. Narrow the filters or search.</p>` : ''}`
        : empty('Nothing matches. Clear a filter.')}
    </div>
  `);

  if (target) byId(`plant-${target}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

/* ------------------------------------------------------------------------- */

function applyFilters(all, state) {
  let rows = all.filter((p) => {
    if (F.kind && (p.kind || 'house') !== F.kind) return false;
    if (F.site && (p.site || 'indoor') !== F.site) return false;
    if (F.verdict && p.verdict !== F.verdict) return false;
    if (F.picked && !state.picks.includes(p.key)) return false;
    if (F.owned && !state.specimens.some((s) => s.key === p.key)) return false;
    if (F.budget && (p.price || 0) > 500) return false;
    return true;
  });

  if (F.q.trim()) {
    rows = rank(rows, F.q, {
      fields: [
        { key: 'name', weight: 1 },
        { key: 'lat', weight: 0.8 },
        { key: 'note', weight: 0.25 },
        { key: 'prop', weight: 0.3 }
      ],
      limit: 400
    }).map((r) => r.item);
  }
  return rows;
}

function filterBar(all) {
  const counts = (fn) => all.filter(fn).length;

  const kinds = ['house', 'fruit', 'veg', 'seed']
    .filter((k) => all.some((p) => (p.kind || 'house') === k))
    .map((k) => btn('kind', k, `${KIND_LBL[k]} · ${counts((p) => (p.kind || 'house') === k)}`));

  const sites = ['A', 'B', 'C', 'D', 'E', 'indoor']
    .map((s) => btn('site', s, `${s === 'indoor' ? 'Indoors' : 'Zone ' + s} · ${counts((p) => (p.site || 'indoor') === s)}`));

  const verdicts = ['yes', 'watch', 'no']
    .map((v) => btn('verdict', v, `${VERDICT_LBL[v][1]} · ${counts((p) => p.verdict === v)}`));

  return `
  <div class="sec">
    <div class="card">
      <input class="input" id="catq" type="search" placeholder="Search 225 entries — try “amrapali”, “grafted”, “red dia”…"
             value="${esc(F.q)}" autocomplete="off">
      <div class="row" style="margin-top:12px">${kinds.join('')}</div>
      <div class="row" style="margin-top:6px">${sites.join('')}</div>
      <div class="row" style="margin-top:6px">${verdicts.join('')}</div>
      <div class="row" style="margin-top:10px;border-top:1px solid var(--line-2);padding-top:10px">
        ${toggle('owned', 'I own it')}
        ${toggle('picked', 'On the buy list')}
        ${toggle('budget', 'Under ₹500')}
        <button class="btn sm ghost" data-act="clearfilters" style="margin-left:auto">Clear all</button>
      </div>
    </div>
  </div>`;
}

const btn = (group, value, label) =>
  `<button class="chip ${F[group] === value ? 'on' : ''}" data-act="filter" data-group="${group}" data-value="${esc(value)}"
     aria-pressed="${F[group] === value}">${esc(label)}</button>`;

const toggle = (key, label) =>
  `<button class="chip ${F[key] ? 'on' : ''}" data-act="toggle" data-key="${key}" aria-pressed="${F[key]}">${esc(label)}</button>`;

/* ---------------------------------------------------------------- a card -- */

function card(p, state) {
  const owned = state.specimens.some((s) => s.key === p.key);
  const picked = state.picks.includes(p.key);

  const actions = `
    <div class="row" style="flex-wrap:nowrap">
      <button class="btn sm ${picked ? 'pri' : ''}" data-act="pick" data-key="${esc(p.key)}"
              title="Add to the buy list">${picked ? 'On list' : 'Buy'}</button>
      <button class="btn sm ${owned ? 'pri' : ''}" data-act="own" data-key="${esc(p.key)}"
              title="Start tracking one of these">${owned ? 'Owned' : 'I own this'}</button>
    </div>`;

  return `<div id="plant-${esc(p.key)}">${knowledgeCard(p, { chillSite: SITE_CHILL, actions })}</div>`;
}

/* ------------------------------------------------------------------ wire -- */

export function wireCatalogue() {
  on('filter', (el, e, ds) => {
    F[ds.group] = F[ds.group] === ds.value ? '' : ds.value;
    renderCatalogue();
  });

  on('toggle', (el, e, ds) => { F[ds.key] = !F[ds.key]; renderCatalogue(); });

  on('clearfilters', () => {
    Object.assign(F, { q: '', kind: '', site: '', verdict: '', owned: false, picked: false, budget: false });
    renderCatalogue();
  });

  on('pick', (el, e, ds) => {
    const added = store.togglePick(ds.key);
    toast(added ? 'Added to the buy list' : 'Removed from the buy list');
  });

  on('own', (el, e, ds) => {
    const state = store.get();
    const existing = state.specimens.find((s) => s.key === ds.key);
    if (existing) { store.removeSpecimen(existing.sid); toast('No longer tracking it'); return; }
    const p = catalogue(state).find((x) => x.key === ds.key);
    store.addSpecimen({
      key: p.key, name: p.name, lat: p.lat, habit: p.habit || 'clump',
      site: p.site || 'indoor', zone: p.place || 'bright', idd: true
    });
    toast(`Tracking ${p.name}`);
  });

  const search = debounce(() => { renderCatalogue(); byId('catq')?.focus(); }, 220);
  document.addEventListener('input', (e) => {
    if (e.target.id !== 'catq') return;
    F.q = e.target.value;
    search();
  });
}

/** Palette entries: every catalogue row is reachable from Ctrl+K. */
export function cataloguePaletteItems() {
  const state = store.get();
  return catalogue(state).map((p) => ({
    title: p.name,
    sub: [p.lat, p.prop, SITE_LBL[p.site || 'indoor']].filter(Boolean).join(' · '),
    group: 'Catalogue',
    run: () => { location.hash = `#catalogue/${p.key}`; }
  }));
}
