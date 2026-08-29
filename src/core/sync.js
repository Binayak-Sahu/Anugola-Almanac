/* ============================================================================
   sync.js — optional multi-device sync through the Netlify function.

   Wire protocol is unchanged from v9, so an existing deployment keeps working:

     GET  /.netlify/functions/data?what=state      -> { state }
     POST /.netlify/functions/data?what=state      <- { state }
     GET  /.netlify/functions/data?what=index      -> { keys }
     GET  /.netlify/functions/data?what=photo&key= -> { key, data }
     POST /.netlify/functions/data?what=photo&key= <- { data }

   Authorisation is the x-ledger-key header, matched against LEDGER_KEY.

   CONFLICT POLICY: last-writer-wins on `savedAt`, decided per whole document.
   That is the honest choice for a single-user app with two devices; anything
   finer-grained needs per-field vector clocks, which is a lot of machinery to
   resolve a conflict that in practice means "the phone and the laptop were
   both open". The push is skipped when the payload is byte-identical to the
   last one sent, so an idle tab does not churn the blob store.
   ========================================================================== */

import * as store from './store.js';
import { debounce } from './util.js';

const ENDPOINT = '/.netlify/functions/data';

let state = { phase: 'off', text: 'Not connected', at: '' };
let lastPushed = '';
let listeners = new Set();

export const onSyncChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

function setPhase(phase, text) {
  state = { phase, text, at: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) };
  for (const fn of listeners) fn(state);
}

export function status() {
  const cls = { off: '', ok: 'ok', error: 'bad', busy: 'busy', offline: 'bad' }[state.phase] || '';
  return { ...state, cls };
}

const enabled = () => !!store.get().ckey;

const headers = () => ({
  'Content-Type': 'application/json',
  ...(store.get().ckey ? { 'x-ledger-key': store.get().ckey } : {})
});

/* --------------------------------------------------------------------------
   The payload deliberately omits the sync password and any device-local field.
   -------------------------------------------------------------------------- */
function outbound() {
  const s = store.snapshot();
  delete s.ckey;
  return s;
}

export async function push() {
  if (!enabled()) { setPhase('off', 'No password set'); return false; }
  const body = JSON.stringify({ state: outbound() });
  if (body === lastPushed) { setPhase('ok', 'Already up to date'); return true; }

  setPhase('busy', 'Pushing…');
  try {
    const res = await fetch(`${ENDPOINT}?what=state`, { method: 'POST', headers: headers(), body });
    if (res.status === 401) { setPhase('error', 'Wrong password'); return false; }
    if (!res.ok) { setPhase('error', `Push failed (${res.status})`); return false; }
    lastPushed = body;
    setPhase('ok', `Pushed at ${state.at || ''}`.trim());
    return true;
  } catch {
    setPhase('offline', 'Offline — will retry');
    return false;
  }
}

export async function pull({ silent = false } = {}) {
  if (!enabled()) { setPhase('off', 'No password set'); return false; }
  if (!silent) setPhase('busy', 'Pulling…');
  try {
    const res = await fetch(`${ENDPOINT}?what=state`, { headers: headers() });
    if (res.status === 401) { setPhase('error', 'Wrong password'); return false; }
    if (!res.ok) { setPhase('error', `Pull failed (${res.status})`); return false; }

    const { state: remote } = await res.json();
    if (!remote) { setPhase('ok', 'Nothing stored yet'); return true; }

    const local = store.get();
    if (!local.savedAt || (remote.savedAt && remote.savedAt > local.savedAt)) {
      /* Preserve the local password — it is device-local by design. */
      store.replaceAll({ ...remote, ckey: local.ckey }, 'sync');
      setPhase('ok', 'Pulled newer copy');
    } else {
      setPhase('ok', 'Local copy is newer');
    }
    return true;
  } catch {
    setPhase('offline', 'Offline');
    return false;
  }
}

/* Debounced so a burst of edits costs one round trip. */
const queued = debounce(() => { push(); }, 2500);

export function startSync() {
  store.subscribe((_, reason) => {
    if (reason === 'sync' || !enabled()) return;
    setPhase('busy', 'Changes pending…');
    queued();
  });

  addEventListener('online', () => { if (enabled()) pull({ silent: true }); });
  addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && enabled()) pull({ silent: true });
  });

  if (enabled()) pull({ silent: true });
}

/* ------------------------------------------------------------------ photos - */

export async function pushPhoto(key, dataUrl) {
  if (!enabled()) return false;
  try {
    const res = await fetch(`${ENDPOINT}?what=photo&key=${encodeURIComponent(key)}`,
      { method: 'POST', headers: headers(), body: JSON.stringify({ data: dataUrl }) });
    return res.ok;
  } catch { return false; }
}

export async function pullPhotoIndex() {
  if (!enabled()) return [];
  try {
    const res = await fetch(`${ENDPOINT}?what=index`, { headers: headers() });
    if (!res.ok) return [];
    return (await res.json()).keys || [];
  } catch { return []; }
}

export async function pullPhoto(key) {
  if (!enabled()) return null;
  try {
    const res = await fetch(`${ENDPOINT}?what=photo&key=${encodeURIComponent(key)}`, { headers: headers() });
    if (!res.ok) return null;
    return (await res.json()).data || null;
  } catch { return null; }
}
