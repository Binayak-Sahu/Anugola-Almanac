/* ============================================================================
   schema.js — the shape of everything the user owns, and how older shapes
   become this one.

   DESIGN RULES, learned from auditing v9:

   1. NOTHING REFERENCES A CATALOGUE INDEX.
      v9 stored `sp: 16` on a pot — a position in the RAW array. Add one
      houseplant above it and every pot in the ledger silently points at the
      wrong species. v10 stores `key: "peperomia"`, a slug that survives
      reordering, insertion and the catalogue growing from 121 to 225 rows.

   2. EVENTS ARE APPEND-ONLY.
      Watering, potting-up, root-pruning and readings are logs, not fields.
      A field can only tell you the state; a log tells you the trend, which
      is the entire point of a tracker.

   3. EVERY RECORD CARRIES ITS OWN ID.
      Arrays get reordered by sync. Ids do not.

   4. MIGRATIONS ARE FORWARD-ONLY AND IDEMPOTENT.
      Each runs at most once, in order, and re-running the chain on already
      migrated data is a no-op.
   ========================================================================== */

import { iso, uid, deepClone, slugOf } from './util.js';

export const SCHEMA_VERSION = 10;
export const STORAGE_KEY = 'almanac_v10';
/* Read-only legacy keys, newest first. Never written to again. */
export const LEGACY_KEYS = ['bl_v7', 'bl_v6'];

/* ==========================================================================
   Empty state
   ========================================================================== */
export function freshState() {
  return {
    v: SCHEMA_VERSION,
    savedAt: '',
    device: '',

    settings: {
      skin: 'jungle',        // 'jungle' | 'precision'
      mode: 'auto',          // 'auto' | 'light' | 'dark'
      startView: 'today',
      heatAlertC: 42,        // Action Desk raises a heat warning above this
      remindRootPruneMo: 24
    },

    /* Indoor pots and any tracked specimen. */
    specimens: [],

    /* Container orchard, keyed by the id in data/orchard.json. */
    orchard: {},

    /* Seed starting. One record per sowing event, not per variety. */
    sowings: [],

    /* Micro-climate readings, the raw material for every model correction. */
    readings: [],

    /* The continuous-improvement log: things tried on purpose. */
    experiments: [],

    /* Mushroom runs. */
    runs: [],

    /* Shopping and catalogue personalisation. */
    picks: [],
    qty: {},
    gear: [],
    over: {},              // per-plant field overrides, keyed by slug
    custom: [],            // user-authored catalogue entries
    srcx: {},              // extra/edited sellers

    /* Free text carried forward from v9. */
    tasks: {},
    journal: [],
    log: '',
    profile: '',

    /* Sync. */
    cloud: null,
    ckey: ''
  };
}

/* ==========================================================================
   Record factories — the canonical shape of each collection member
   ========================================================================== */

export function newSpecimen(patch = {}) {
  return {
    sid: uid('s'),
    name: '',
    key: null,             // catalogue slug, or null for an unidentified plant
    lat: '',
    habit: 'clump',
    site: 'indoor',        // 'A'..'E' or 'indoor'
    zone: 'bright',        // indoor light band: desk | low | bright | sun
    water: '',             // free text override; blank = inherit from catalogue
    bag: '',
    potted: '',
    notes: '',
    idd: false,
    dead: false,
    photo: '',
    watered: '',           // last watering, ISO date
    hist: [],              // every watering, ISO dates, oldest first
    ...patch
  };
}

/** Per-tree orchard tracking. `id` matches data/orchard.json. */
export function newOrchardRecord(id, patch = {}) {
  return {
    id,
    acquired: iso(),
    zone: 'E',
    stage: 'acclim',       // acclim | potted | establishing | growing | fruiting | lost
    bagIdx: 0,             // which rung of the bag ladder it is standing on
    bags: [],              // [{ size, litres, on }] — the ladder actually climbed
    lastRootPrune: '',
    firstFruitOn: '',      // observed, once it happens
    events: [],            // [{ id, on, kind, text }]
    photos: [],
    notes: '',
    alive: true,
    ...patch
  };
}

export const ORCHARD_EVENT_KINDS = ['pot', 'prune', 'rootprune', 'feed', 'flower',
  'fruit', 'pest', 'disease', 'move', 'note'];

export function newOrchardEvent(kind, text, on = iso()) {
  return { id: uid('e'), on, kind, text };
}

/** One sowing. Re-sowing the same variety a fortnight later is a new record —
    that is how succession sowing gets tracked instead of overwritten. */
export function newSowing(patch = {}) {
  return {
    id: uid('sow'),
    name: '',
    seedKey: '',           // slug of the seed row in data/seeds.json
    sownOn: iso(),
    qtySown: 0,
    medium: 'coco+vermi',
    tray: '',              // "tray 2, cells A1–A6"
    zone: 'D',
    expectDays: null,      // days to expected emergence; null = use variety data
    counts: [],            // [{ on, up }] cumulative seedlings emerged
    thinnedTo: null,
    pottedOn: '',
    hardenFrom: '',        // start of hardening-off
    hardenDays: 7,
    plantedOn: '',
    status: 'sown',        // sown|germinating|growing|hardening|planted|failed
    notes: '',
    ...patch
  };
}

/** A micro-climate reading. Zone-scoped, because the whole site premise is
    that the five zones are not the same place. */
export function newReading(patch = {}) {
  return {
    id: uid('r'),
    at: new Date().toISOString(),
    zone: 'A',
    tempC: null,
    rh: null,              // relative humidity %
    note: '',
    source: 'manual',
    ...patch
  };
}

export function newExperiment(patch = {}) {
  return {
    id: uid('x'),
    opened: iso(),
    title: '',
    hypothesis: '',
    zone: '',
    subjects: [],          // free refs: specimen sids, orchard ids, sowing ids
    metric: '',
    closed: '',
    verdict: '',           // win | loss | neutral
    notes: '',
    ...patch
  };
}

/* ==========================================================================
   Migrations
   Each entry takes a state at version N and returns one at version N+1.
   `ctx` carries anything a migration needs from outside — currently the
   catalogue, so index references can become slugs.
   ========================================================================== */

const migrations = {
  /* v7/v8/v9 all shared one localStorage shape under `bl_v7`. Treat them as
     version 9 and lift the whole family in one step. */
  9: (old, ctx) => {
    const next = freshState();
    const cat = ctx.catalogue || [];
    /* A hand-edited backup or a truncated sync payload can put anything in
       any slot. Coerce first so the mapping below cannot throw — a migration
       that crashes locks the user out of their own ledger. */
    const arr = (v) => (Array.isArray(v) ? v : []);
    const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

    next.settings.skin = 'jungle';
    next.settings.mode = old.theme === 'night' ? 'dark' : old.theme === 'day' ? 'light' : 'auto';

    next.specimens = arr(old.specimens).filter((x) => x && typeof x === 'object').map((x) => {
      /* sp was an index into the old RAW array. Resolve it while the old
         ordering is still the ordering we have. */
      let key = null;
      if (x.sp !== null && x.sp !== undefined && x.sp !== '') {
        const hit = cat[Number(x.sp)];
        if (hit) key = hit.key;
      }
      if (!key && x.name) {
        const byName = cat.find((p) => p.name === x.name);
        if (byName) key = byName.key;
      }
      return newSpecimen({
        sid: x.sid || uid('s'),
        name: x.name || '',
        key,
        lat: x.lat || '',
        habit: x.habit || 'clump',
        site: x.site || 'indoor',
        zone: x.zone || 'bright',
        water: x.water || '',
        bag: x.bag || '',
        potted: x.potted || '',
        notes: x.notes || '',
        idd: x.idd === true,
        dead: !!x.dead,
        photo: x.photo || '',
        watered: x.watered || '',
        hist: Array.isArray(x.hist) ? x.hist.slice() : (x.watered ? [x.watered] : [])
      });
    });

    next.picks = arr(old.picks).slice();
    next.qty = { ...obj(old.qty) };
    next.gear = arr(old.gear).slice();
    next.over = { ...obj(old.over) };
    next.custom = arr(old.custom).slice();
    next.srcx = { ...obj(old.srcx) };
    next.tasks = { ...obj(old.tasks) };
    next.journal = arr(old.journal).slice();
    next.runs = arr(old.runs).slice();
    next.cloud = old.cloud || null;
    next.ckey = old.ckey || '';
    next.log = old.__log ?? old.log ?? '';
    next.profile = old.__profile ?? old.profile ?? '';

    next.v = 10;
    return next;
  }
};

/**
 * Bring any stored state up to SCHEMA_VERSION.
 * @param {object} raw   whatever came out of storage
 * @param {object} ctx   { catalogue }
 */
export function migrate(raw, ctx = {}) {
  if (!raw || typeof raw !== 'object') return freshState();

  let state = deepClone(raw);
  /* Anything without an explicit v is the pre-v10 family. */
  let v = Number(state.v) || 9;
  if (v > SCHEMA_VERSION) return normalise(state);  // newer device wrote it; leave it alone

  while (v < SCHEMA_VERSION) {
    const step = migrations[v];
    if (!step) { v++; continue; }
    state = step(state, ctx);
    v = Number(state.v) || v + 1;
  }
  return normalise(state);
}

/* ==========================================================================
   Normalisation — defends against a half-written sync payload or a hand-edited
   backup. Cheap, runs on every load, and makes every downstream module able to
   assume its collections exist.
   ========================================================================== */
export function normalise(state) {
  const base = freshState();
  const s = { ...base, ...(state || {}) };

  s.settings = { ...base.settings, ...(state?.settings || {}) };
  if (!['jungle', 'precision'].includes(s.settings.skin)) s.settings.skin = 'jungle';
  if (!['auto', 'light', 'dark'].includes(s.settings.mode)) s.settings.mode = 'auto';

  s.specimens = asArray(state?.specimens).map((x) => newSpecimen(x));
  s.sowings = asArray(state?.sowings).map((x) => newSowing(x));
  s.readings = asArray(state?.readings).map((x) => newReading(x));
  s.experiments = asArray(state?.experiments).map((x) => newExperiment(x));
  s.runs = asArray(state?.runs);
  s.picks = asArray(state?.picks);
  s.gear = asArray(state?.gear);
  s.custom = asArray(state?.custom);
  s.journal = asArray(state?.journal);

  s.orchard = {};
  const orch = state?.orchard && typeof state.orchard === 'object' ? state.orchard : {};
  for (const [id, rec] of Object.entries(orch)) {
    s.orchard[id] = newOrchardRecord(id, { ...rec, id });
    s.orchard[id].bags = asArray(rec?.bags);
    s.orchard[id].events = asArray(rec?.events);
    s.orchard[id].photos = asArray(rec?.photos);
  }

  s.qty = asObject(state?.qty);
  s.over = asObject(state?.over);
  s.srcx = asObject(state?.srcx);
  s.tasks = asObject(state?.tasks);

  s.v = SCHEMA_VERSION;
  return s;
}

const asArray = (v) => (Array.isArray(v) ? v : []);
const asObject = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? { ...v } : {});

/* Small helper used by importers: give a free-text plant name a stable key. */
export const keyForName = (name) => slugOf(name);
