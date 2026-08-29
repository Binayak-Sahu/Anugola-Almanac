/* ============================================================================
   persist.js — where the data actually lives.

   Two stores, on purpose:
     localStorage   the ledger. Small, synchronous, survives everything.
     IndexedDB      photos. Base64 images blow the ~5 MB localStorage quota
                    after about a dozen shots, so they never go in there.

   Writes are debounced and quota failures are surfaced rather than swallowed —
   silently failing to save is the worst thing a tracker can do.
   ========================================================================== */

import { STORAGE_KEY, LEGACY_KEYS } from './schema.js';
import { debounce } from './util.js';

/* ==========================================================================
   Ledger
   ========================================================================== */

let onError = () => {};
export const setPersistErrorHandler = (fn) => { onError = fn; };

export function loadRaw() {
  /* A baked build can carry a state snapshot. It only wins when this browser
     has nothing of its own, so opening a backup never silently overwrites
     newer work. */
  const baked = readBakedState();

  /* Current key first; then the v7/v8/v9 family, so an existing user's data
     is picked up on their first visit to v10 and never touched again. */
  for (const key of [STORAGE_KEY, ...LEGACY_KEYS]) {
    try {
      const txt = localStorage.getItem(key);
      if (!txt) continue;
      const parsed = JSON.parse(txt);
      /* v9 wrapped state as { savedAt, state }. v10 stores it flat. */
      const inner = parsed && parsed.state && !parsed.v ? parsed.state : parsed;
      if (inner && typeof inner === 'object') {
        if (key !== STORAGE_KEY) console.info(`[persist] migrating from ${key}`);
        return inner;
      }
    } catch (err) {
      console.warn(`[persist] ${key} unreadable`, err);
    }
  }
  return baked;
}

function readBakedState() {
  const node = document.getElementById('baked-state');
  if (!node) return null;
  try { return JSON.parse(node.textContent); }
  catch { return null; }
}

let lastWriteOk = true;

function writeNow(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (!lastWriteOk) { lastWriteOk = true; onError(null); }
  } catch (err) {
    lastWriteOk = false;
    const quota = err && (err.name === 'QuotaExceededError' || err.code === 22);
    onError(quota
      ? 'Storage is full. Delete some photos, or export a backup and reset.'
      : 'Could not save to this browser. Private browsing blocks storage.');
    console.error('[persist] write failed', err);
  }
}

/* 400 ms means a burst of edits costs one write, and the yard case — tap
   "watered", lock the phone — still lands well inside the pagehide window. */
export const save = debounce(writeNow, 400);
export const saveImmediately = writeNow;

/** Flush pending writes when the page goes away. */
export function installFlush(getState) {
  const flush = () => writeNow(getState());
  addEventListener('pagehide', flush);
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
}

export function clearLedger() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

/** Rough byte size of the stored ledger, for the Memory screen. */
export function ledgerBytes() {
  try { return (localStorage.getItem(STORAGE_KEY) || '').length; } catch { return 0; }
}

/* ==========================================================================
   Photos — IndexedDB, keyed by an arbitrary string the caller owns
   ("pot:s3", "orchard:mango:2026-09-04")
   ========================================================================== */

const DB_NAME = 'balcony-ledger';   /* unchanged from v9 — renaming it would
                                       orphan every photo already stored. */
const DB_STORE = 'photos';
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) { reject(new Error('no indexeddb')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

const tx = (mode, fn) => openDB().then((db) => new Promise((resolve, reject) => {
  const t = db.transaction(DB_STORE, mode);
  const req = fn(t.objectStore(DB_STORE));
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
}));

export const photoPut = (key, dataUrl) => tx('readwrite', (s) => s.put(dataUrl, key));
export const photoGet = (key) => tx('readonly', (s) => s.get(key));
export const photoDel = (key) => tx('readwrite', (s) => s.delete(key));
export const photoKeys = () => tx('readonly', (s) => s.getAllKeys());

/** Load every photo into a plain object. Used by export and by first paint. */
export async function photoAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const out = {};
    const t = db.transaction(DB_STORE, 'readonly');
    const req = t.objectStore(DB_STORE).openCursor();
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) { resolve(out); return; }
      out[cur.key] = cur.value;
      cur.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

/* ==========================================================================
   Image capture — downscale before storing, never after
   ==========================================================================
   A modern phone camera produces a 4 MB JPEG. Stored raw as base64 that is
   5.3 MB for one leaf. Everything gets resized to fit a 1200 px box and
   re-encoded at q0.82, which lands around 120–200 KB.
   ========================================================================== */

export function fileToDataURL(file, maxEdge = 1200, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('not an image'));
      img.onload = () => {
        const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(cv.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
