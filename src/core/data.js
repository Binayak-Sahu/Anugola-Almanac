/* ============================================================================
   data.js — the knowledge base loader.

   All horticultural reference data is static JSON under /data. It is fetched
   once, cached by the service worker, and never mutated. User edits live in
   store state (`over`, `custom`) and are merged on top here, so the shipped
   knowledge and the user's corrections never contaminate each other — you can
   always tell what the app claimed and what the user changed it to.
   ========================================================================== */

import { slugOf } from './util.js';

const BUNDLES = ['catalogue', 'orchard', 'zones', 'seeds', 'mushrooms',
  'feed', 'soil', 'climate', 'sources', 'care'];

/** Everything from /data, keyed by bundle name. Populated by loadAll(). */
export const DB = Object.create(null);

let loaded = false;

export async function loadAll(base = 'data/') {
  if (loaded) return DB;

  /* A baked build (tools/bake.mjs) embeds the knowledge base in the page, so
     the file opens from file:// where fetch() is blocked. Prefer it. */
  const embedded = document.getElementById('baked-data');
  if (embedded) {
    Object.assign(DB, JSON.parse(embedded.textContent));
  } else {
    const results = await Promise.all(BUNDLES.map(async (name) => {
      const res = await fetch(`${base}${name}.json`, { cache: 'force-cache' });
      if (!res.ok) throw new Error(`${name}.json — HTTP ${res.status}`);
      return [name, await res.json()];
    }));
    for (const [name, payload] of results) DB[name] = payload;
  }

  /* COMFORT_X ships as [source, flags, value] because JSON cannot hold a
     RegExp. Rebuild it once, here, so nothing downstream has to know. */
  if (DB.care?.COMFORT_X) {
    DB.care.COMFORT_X = DB.care.COMFORT_X.map(([src, flags, val]) => [new RegExp(src, flags), val]);
  }

  buildIndexes();
  loaded = true;
  return DB;
}

/* ==========================================================================
   Indexes — built once at load, rebuilt when the user edits the catalogue
   ========================================================================== */

export const INDEX = {
  byKey: new Map(),      // slug -> catalogue entry
  byName: new Map(),
  orchardById: new Map(),
  zoneByKey: new Map(),
  seedByKey: new Map()
};

function buildIndexes() {
  INDEX.byKey.clear(); INDEX.byName.clear();
  for (const p of DB.catalogue.catalogue) {
    INDEX.byKey.set(p.key, p);
    INDEX.byName.set(p.name, p);
  }
  INDEX.orchardById.clear();
  for (const t of DB.orchard.ORCHARD) INDEX.orchardById.set(t.id, t);
  INDEX.zoneByKey.clear();
  for (const z of DB.zones.ZONES) INDEX.zoneByKey.set(z.k, z);
  INDEX.seedByKey.clear();
  for (const s of DB.seeds.SEEDS2) INDEX.seedByKey.set(slugOf(s.n), s);
}

/* ==========================================================================
   Merged catalogue view
   ========================================================================== */

const EDITABLE = ['name', 'lat', 'cat', 'place', 'when', 'price', 'src', 'diff',
  'water', 'size', 'tox', 'note'];

/**
 * The catalogue as the user sees it: shipped rows, plus their own additions,
 * with per-row overrides applied on top.
 * @param {object} state store state
 */
export function catalogue(state) {
  const out = DB.catalogue.catalogue.slice();

  for (const c of state.custom || []) {
    out.push({ ...c, key: c.key || slugOf(c.name), custom: true, kind: c.kind || 'house' });
  }

  const over = state.over || {};
  return out.map((p) => {
    const o = over[p.key];
    if (!o) return p;
    const merged = { ...p, edited: true };
    for (const f of EDITABLE) {
      if (o[f] !== undefined && o[f] !== null && o[f] !== '') merged[f] = o[f];
    }
    merged.price = Number(merged.price) || 0;
    merged.diff = Number(merged.diff) || 1;
    merged.tox = Number(merged.tox) || 0;
    return merged;
  });
}

export const plantByKey = (key) => INDEX.byKey.get(key) || null;
export const orchardSpec = (id) => INDEX.orchardById.get(id) || null;
export const zoneSpec = (k) => INDEX.zoneByKey.get(k) || null;
export const seedSpec = (key) => INDEX.seedByKey.get(key) || null;

/** Sellers, with the user's edits and additions folded in. */
export function sources(state) {
  return { ...DB.sources.SRC, ...(state.srcx || {}) };
}
export const sourceRow = (state, k) => sources(state)[k] || ['Seller not set', '', '', ''];

/* ==========================================================================
   Label maps — presentation strings that belong with the data, not the views
   ========================================================================== */

export const PLACE_LBL = { desk: 'Desk', low: 'Metre back', bright: 'Half metre back', sun: 'At the glass' };
export const WHEN_LBL = { now: 'Ship now', oct: 'Wait → Oct' };
export const DIFF_LBL = { 1: 'Beginner', 2: 'Moderate', 3: 'Expert' };
export const TOX_LBL = { 0: 'Pet-safe', 1: 'Toxic if eaten', 2: 'Irritant sap' };
export const VERDICT_LBL = {
  yes: ['ok', 'Works here'],
  watch: ['watch', 'Works, with a catch'],
  no: ['no', 'Ruled out — and why']
};
export const KIND_LBL = { house: 'Houseplant', fruit: 'Fruit', veg: 'Vegetable', seed: 'Seed packet' };
export const SITE_LBL = {
  A: 'Zone A · open parking', B: 'Zone B · terrace', C: 'Zone C · south balcony',
  D: 'Zone D · first-floor shade', E: 'Zone E · closed parking', indoor: 'Indoors'
};
export const STAGE_LBL = {
  acclim: 'Acclimating', potted: 'Potted up', establishing: 'Establishing',
  growing: 'Growing on', fruiting: 'Fruiting', lost: 'Lost'
};
export const SOW_STATUS_LBL = {
  sown: 'Sown', germinating: 'Germinating', growing: 'Growing on',
  hardening: 'Hardening off', planted: 'Planted out', failed: 'Failed'
};
