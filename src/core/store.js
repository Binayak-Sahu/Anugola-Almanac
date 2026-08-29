/* ============================================================================
   store.js — one mutable state object, one way to change it, one way to hear
   about it.

   Views never write to state directly. They call an action; the action mutates
   and calls commit(); commit persists and notifies. That single choke point is
   what makes "save on every change" and "sync on every change" possible
   without sprinkling save() calls through 4,000 lines of render code, which is
   what v9 had to do.
   ========================================================================== */

import { freshState, normalise, migrate, newSpecimen, newOrchardRecord,
  newOrchardEvent, newSowing, newReading, newExperiment } from './schema.js';
import { iso, deepClone, uid } from './util.js';

let state = freshState();
const listeners = new Set();
let saver = null;                 // injected by persist.js
let suspended = 0;
let dirtyWhileSuspended = false;

/* ------------------------------------------------------------------ read -- */
export const get = () => state;
export const settings = () => state.settings;

/* --------------------------------------------------------------- notify --- */
/** Subscribe to every commit. Returns an unsubscribe function. */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(reason) {
  for (const fn of listeners) {
    try { fn(state, reason); } catch (err) { console.error('[store] listener failed', err); }
  }
}

/** Mark the state changed: persist, then tell everyone.
    `reason` is a free string used by views to skip needless re-renders. */
export function commit(reason = 'change') {
  state.savedAt = new Date().toISOString();
  if (suspended > 0) { dirtyWhileSuspended = true; return; }
  saver?.(state);
  notify(reason);
}

/** Batch several mutations into one commit — one save, one render. */
export function transact(fn, reason = 'change') {
  suspended++;
  try { fn(); } finally {
    suspended--;
    if (suspended === 0 && dirtyWhileSuspended) {
      dirtyWhileSuspended = false;
      saver?.(state);
      notify(reason);
    }
  }
}

/* ------------------------------------------------------------------ init -- */
export function hydrate(raw, ctx) {
  state = migrate(raw, ctx);
  return state;
}

export function replaceAll(next, reason = 'replace') {
  state = normalise(next);
  commit(reason);
}

export function setSaver(fn) { saver = fn; }

/* ==========================================================================
   ACTIONS
   Everything the UI is allowed to do. Grouped by the screen that uses them.
   ========================================================================== */

/* ---------------------------------------------------------- settings ----- */
export function setSetting(key, value) {
  state.settings[key] = value;
  commit('settings');
}

/* ---------------------------------------------------------- specimens ---- */
export function addSpecimen(patch) {
  const rec = newSpecimen(patch);
  state.specimens.push(rec);
  commit('specimens');
  return rec;
}

export function updateSpecimen(sid, patch) {
  const rec = state.specimens.find((x) => x.sid === sid);
  if (!rec) return null;
  Object.assign(rec, patch);
  commit('specimens');
  return rec;
}

export function removeSpecimen(sid) {
  const i = state.specimens.findIndex((x) => x.sid === sid);
  if (i < 0) return null;
  const [gone] = state.specimens.splice(i, 1);
  commit('specimens');
  return gone;
}

/** Log a watering. Idempotent for the same day, so a double tap in the yard
    does not create two entries. */
export function waterSpecimen(sid, on = iso()) {
  const rec = state.specimens.find((x) => x.sid === sid);
  if (!rec) return null;
  rec.hist = rec.hist || [];
  if (rec.hist[rec.hist.length - 1] !== on) rec.hist.push(on);
  rec.watered = on;
  commit('water');
  return rec;
}

export function undoWater(sid) {
  const rec = state.specimens.find((x) => x.sid === sid);
  if (!rec?.hist?.length) return null;
  rec.hist.pop();
  rec.watered = rec.hist[rec.hist.length - 1] || '';
  commit('water');
  return rec;
}

/* ------------------------------------------------------------ orchard ---- */
export function trackOrchard(id, patch) {
  if (!state.orchard[id]) state.orchard[id] = newOrchardRecord(id, patch);
  else Object.assign(state.orchard[id], patch || {});
  commit('orchard');
  return state.orchard[id];
}

export function untrackOrchard(id) {
  delete state.orchard[id];
  commit('orchard');
}

export function updateOrchard(id, patch) {
  const rec = state.orchard[id];
  if (!rec) return null;
  Object.assign(rec, patch);
  commit('orchard');
  return rec;
}

export function logOrchardEvent(id, kind, text, on = iso()) {
  const rec = state.orchard[id];
  if (!rec) return null;
  rec.events.unshift(newOrchardEvent(kind, text, on));
  commit('orchard');
  return rec;
}

/** Step a tree up its bag ladder and write the move into its own history. */
export function potUp(id, size, litres, on = iso()) {
  const rec = state.orchard[id];
  if (!rec) return null;
  rec.bags.push({ size, litres, on });
  rec.bagIdx = rec.bags.length - 1;
  if (rec.stage === 'acclim') rec.stage = 'potted';
  rec.events.unshift(newOrchardEvent('pot', `Potted up to ${size} · ${litres}`, on));
  commit('orchard');
  return rec;
}

export function logRootPrune(id, on = iso(), text = 'Root-pruned and back-filled') {
  const rec = state.orchard[id];
  if (!rec) return null;
  rec.lastRootPrune = on;
  rec.events.unshift(newOrchardEvent('rootprune', text, on));
  commit('orchard');
  return rec;
}

/* ------------------------------------------------------------ sowings ---- */
export function addSowing(patch) {
  const rec = newSowing(patch);
  state.sowings.unshift(rec);
  commit('sowings');
  return rec;
}

export function updateSowing(id, patch) {
  const rec = state.sowings.find((x) => x.id === id);
  if (!rec) return null;
  Object.assign(rec, patch);
  commit('sowings');
  return rec;
}

export function removeSowing(id) {
  const i = state.sowings.findIndex((x) => x.id === id);
  if (i < 0) return null;
  state.sowings.splice(i, 1);
  commit('sowings');
}

/** Record how many seedlings are up today. Cumulative, one entry per date. */
export function countGermination(id, up, on = iso()) {
  const rec = state.sowings.find((x) => x.id === id);
  if (!rec) return null;
  const existing = rec.counts.find((c) => c.on === on);
  if (existing) existing.up = up;
  else rec.counts.push({ on, up });
  rec.counts.sort((a, b) => (a.on < b.on ? -1 : 1));
  if (up > 0 && rec.status === 'sown') rec.status = 'germinating';
  commit('sowings');
  return rec;
}

/* ----------------------------------------------------------- readings ---- */
export function addReading(patch) {
  const rec = newReading(patch);
  state.readings.unshift(rec);
  /* Keep the log bounded — 4,000 readings is roughly three years of hourly
     logging and comfortably inside the localStorage budget. */
  if (state.readings.length > 4000) state.readings.length = 4000;
  commit('readings');
  return rec;
}

export function removeReading(id) {
  const i = state.readings.findIndex((x) => x.id === id);
  if (i < 0) return;
  state.readings.splice(i, 1);
  commit('readings');
}

/* -------------------------------------------------------- experiments ---- */
export function addExperiment(patch) {
  const rec = newExperiment(patch);
  state.experiments.unshift(rec);
  commit('experiments');
  return rec;
}

export function updateExperiment(id, patch) {
  const rec = state.experiments.find((x) => x.id === id);
  if (!rec) return null;
  Object.assign(rec, patch);
  commit('experiments');
  return rec;
}

/* ---------------------------------------------------------------- tasks -- */
export function toggleTask(id, done) {
  const now = done ?? !state.tasks[id];
  if (now) state.tasks[id] = iso();
  else delete state.tasks[id];
  commit('tasks');
  return now;
}

export const taskDone = (id) => !!state.tasks[id];

/* ------------------------------------------------------------ shopping --- */
export function togglePick(key) {
  const i = state.picks.indexOf(key);
  if (i < 0) state.picks.push(key); else state.picks.splice(i, 1);
  commit('picks');
  return i < 0;
}

export function setQty(key, n) {
  const v = Math.max(1, Number(n) || 1);
  state.qty[key] = v;
  commit('picks');
}

/* -------------------------------------------------------------- journal -- */
export function addJournal(text, on = iso()) {
  state.journal.unshift({ id: uid('j'), on, text });
  commit('journal');
}

/* ---------------------------------------------------------------- misc --- */
export function snapshot() { return deepClone(state); }
