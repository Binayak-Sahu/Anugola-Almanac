/* ============================================================================
   views/settings.js — theme, data, sync, storage.

   Also the home of the one thing that must never regress: the export. v9's
   "bake into this file" produced a single HTML file with the user's data
   inside it, openable by double-click with no server. The v10 architecture is
   ES modules, which browsers refuse to load over file://, so the export now
   produces a JSON backup here, and `npm run bake` produces the equivalent
   self-contained HTML. Both paths are documented on this screen rather than
   quietly dropped.
   ========================================================================== */

import { esc, mount, on } from '../core/dom.js';
import { iso, money } from '../core/util.js';
import * as store from '../core/store.js';
import { SKINS, MODES, current as currentTheme, setSkin, setMode } from '../ui/theme.js';
import { ledgerBytes, photoAll, clearLedger } from '../core/persist.js';
import { section, chip, facts, empty } from '../ui/components.js';
import { toast } from '../ui/toast.js';
import { SCHEMA_VERSION } from '../core/schema.js';
import * as sync from '../core/sync.js';

export function renderSettings() {
  const state = store.get();
  const t = currentTheme();

  mount('v-settings', `
    <div class="sec">
      <div class="eyebrow">Schema v${SCHEMA_VERSION}</div>
      <h1 style="margin:4px 0 6px">Settings and memory</h1>
    </div>

    ${section('Theme', themePanel(t), { eyebrow: 'Two skins, three modes' })}
    ${section('Alerts', alertPanel(state))}
    ${section('Your data', dataPanel(state), { eyebrow: 'Where it lives' })}
    ${section('Sync between devices', syncPanel(state), { eyebrow: 'Optional' })}
    ${section('Journal', journalPanel(state))}
  `);
}

/* ------------------------------------------------------------------------- */

function themePanel(t) {
  const preview = (skin, mode) => `
    <button class="card themeprev" data-act="settheme" data-skin="${skin}" data-mode="${mode}"
            data-preview-skin="${skin}" data-preview-mode="${mode}"
            aria-pressed="${t.skin === skin && t.mode === mode}">
      <div class="spread">
        <span class="eyebrow">${SKINS.find((s) => s.k === skin).label}</span>
        <span class="chip tone-mono">${mode}</span>
      </div>
      <div class="swatchset" style="margin-top:10px">
        <span class="swatch" style="background:var(--bg)"></span>
        <span class="swatch" style="background:var(--surface)"></span>
        <span class="swatch" style="background:var(--accent)"></span>
        <span class="swatch" style="background:var(--ink)"></span>
      </div>
    </button>`;

  return `
    <div class="grid g2">
      <div class="card">
        <div class="eyebrow">Skin</div>
        <div class="row" style="margin-top:8px">
          ${SKINS.map((s) => `<button class="chip ${t.skin === s.k ? 'on' : ''}" data-act="skin" data-skin="${s.k}"
              aria-pressed="${t.skin === s.k}">${esc(s.label)}</button>`).join('')}
        </div>
        <p class="subtle" style="margin-top:8px">${esc(SKINS.find((s) => s.k === t.skin).hint)}</p>
      </div>
      <div class="card">
        <div class="eyebrow">Light or dark</div>
        <div class="row" style="margin-top:8px">
          ${MODES.map((m) => `<button class="chip ${t.mode === m.k ? 'on' : ''}" data-act="mode" data-mode="${m.k}"
              aria-pressed="${t.mode === m.k}">${esc(m.label)}</button>`).join('')}
        </div>
        <p class="subtle" style="margin-top:8px">
          Currently rendering <b>${t.resolved}</b>${t.mode === 'auto' ? ', following the phone' : ''}.
          Press <code>t</code> anywhere to cycle, <code>y</code> to swap skin.
        </p>
      </div>
    </div>`;
}

function alertPanel(state) {
  const s = state.settings;
  return `<form class="card" id="alertform">
    <div class="grid g3" style="align-items:end">
      <label class="fld"><span>Heat alert above (°C)</span>
        <input class="input" name="heatAlertC" type="number" min="30" max="50" value="${s.heatAlertC}"></label>
      <label class="fld"><span>Root-prune interval (months)</span>
        <input class="input" name="remindRootPruneMo" type="number" min="6" max="60" value="${s.remindRootPruneMo}"></label>
      <label class="fld"><span>Open on</span>
        <select class="input" name="startView">
          ${['today', 'orchard', 'seeds', 'pots'].map((v) => `<option value="${v}"${s.startView === v ? ' selected' : ''}>${v}</option>`).join('')}
        </select></label>
      <button class="btn pri" type="submit">Save</button>
    </div>
  </form>`;
}

function dataPanel(state) {
  const kb = Math.round(ledgerBytes() / 1024);
  return `
  <div class="card">
    ${facts([
      ['Schema', 'v' + SCHEMA_VERSION],
      ['Ledger size', kb + ' KB'],
      ['Pots', state.specimens.length],
      ['Trees tracked', Object.keys(state.orchard).length],
      ['Sowings', state.sowings.length],
      ['Readings', state.readings.length],
      ['Last saved', state.savedAt ? new Date(state.savedAt).toLocaleString('en-IN') : 'never']
    ])}
    <div class="row" style="margin-top:14px">
      <button class="btn pri" data-act="export">Download backup (JSON)</button>
      <label class="btn">Restore from backup
        <input type="file" accept="application/json" hidden data-act="import"></label>
      <button class="btn ghost danger" data-act="wipe">Erase everything</button>
    </div>
    <p class="subtle" style="margin-top:10px">
      Your data lives in this browser, always. The backup includes photos.
      For a self-contained HTML copy you can double-click with no server —
      the v9 "bake into this file" trick — run <code>npm run bake</code> in the project folder;
      ES modules cannot be loaded from a <code>file://</code> page, so that step is now a
      build rather than a button.
    </p>
  </div>`;
}

function syncPanel(state) {
  const st = sync.status();
  return `
  <div class="card">
    <p class="subtle">
      Optional. Set <code>LEDGER_KEY</code> in your Netlify site's environment variables, redeploy,
      then enter the same password on every device. Without it, anyone who guesses the address can
      read and change your ledger.
    </p>
    <form class="row" id="syncform" style="margin-top:12px">
      <label class="fld" style="flex:1;min-width:180px"><span>Password</span>
        <input class="input" name="ckey" type="password" value="${esc(state.ckey || '')}" placeholder="the LEDGER_KEY value"></label>
      <button class="btn pri" type="submit" style="align-self:flex-end">Connect</button>
      <button class="btn" type="button" data-act="pull" style="align-self:flex-end">Pull now</button>
      <button class="btn" type="button" data-act="push" style="align-self:flex-end">Push now</button>
    </form>
    <div class="row" style="margin-top:10px">
      <span class="pill ${st.cls}">${esc(st.text)}</span>
    </div>
  </div>`;
}

function journalPanel(state) {
  return `
    <form class="row" id="journalform">
      <input class="input" name="text" placeholder="What happened today" style="flex:1;min-width:200px">
      <button class="btn" type="submit">Add</button>
    </form>
    <div style="margin-top:12px">
      ${state.journal.length ? state.journal.slice(0, 30).map((j) => `
        <div class="row" style="padding:8px 0;border-bottom:1px solid var(--line-2);gap:10px;align-items:flex-start">
          <span class="chip tone-mono">${esc(j.on)}</span>
          <span style="font-size:13.5px;flex:1;min-width:0">${esc(j.text)}</span>
        </div>`).join('') : empty('Nothing logged yet.')}
    </div>`;
}

/* ------------------------------------------------------------------ wire -- */

export function wireSettings() {
  on('skin', (el, e, ds) => { setSkin(ds.skin); renderSettings(); });
  on('mode', (el, e, ds) => { setMode(ds.mode); renderSettings(); });
  on('settheme', (el, e, ds) => { setSkin(ds.skin); setMode(ds.mode); renderSettings(); });

  on('export', async () => {
    const photos = await photoAll().catch(() => ({}));
    const payload = { app: 'The Anugola Almanac', v: SCHEMA_VERSION, exportedAt: new Date().toISOString(), state: store.snapshot(), photos };
    download(JSON.stringify(payload, null, 1), `anugola-almanac-${iso()}.json`, 'application/json');
    toast('Backup downloaded. Keep one somewhere that is not this phone.');
  });

  on('wipe', () => {
    if (!confirm('Erase every pot, tree, sowing and reading stored in this browser? Export a backup first — this cannot be undone.')) return;
    clearLedger();
    location.reload();
  });

  on('pull', async () => { await sync.pull(); renderSettings(); });
  on('push', async () => { await sync.push(); renderSettings(); });

  document.addEventListener('change', async (e) => {
    if (e.target.dataset?.act !== 'import') return;
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      const next = payload.state || payload;
      if (!confirm('Replace everything currently in this browser with the contents of that backup?')) return;
      store.replaceAll(next, 'import');
      toast('Backup restored');
      renderSettings();
    } catch (err) {
      toast('That file could not be read as an Almanac backup');
    }
  });

  document.addEventListener('submit', (e) => {
    if (e.target.id === 'alertform') {
      e.preventDefault();
      const f = new FormData(e.target);
      store.transact(() => {
        store.setSetting('heatAlertC', Number(f.get('heatAlertC')) || 42);
        store.setSetting('remindRootPruneMo', Number(f.get('remindRootPruneMo')) || 24);
        store.setSetting('startView', f.get('startView'));
      }, 'settings');
      toast('Saved');
    }
    if (e.target.id === 'syncform') {
      e.preventDefault();
      const key = String(new FormData(e.target).get('ckey') || '');
      store.get().ckey = key;
      store.commit('sync');
      sync.pull().then(() => renderSettings());
    }
    if (e.target.id === 'journalform') {
      e.preventDefault();
      const text = String(new FormData(e.target).get('text') || '').trim();
      if (!text) return;
      store.addJournal(text);
      e.target.reset();
      renderSettings();
    }
  });
}

function download(text, name, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}
