/* ============================================================================
   main.js — bootstrap.

   Order matters:
     1. Load the knowledge base (needed to migrate a v9 ledger, because that
        migration resolves catalogue INDEX references into slugs).
     2. Hydrate and migrate state.
     3. Apply the theme (already roughly applied by theme-boot.js pre-paint).
     4. Build the chrome, wire delegated events, start the router.
     5. Everything optional — sync, service worker — last, so a failure there
        never stops the app opening.
   ========================================================================== */

import { byId, mount, on, startDelegation, icon, esc } from './core/dom.js';
import * as store from './core/store.js';
import { loadAll, DB, catalogue } from './core/data.js';
import { loadRaw, save, saveImmediately, installFlush, setPersistErrorHandler } from './core/persist.js';
import { defineRoute, startRouter, go, setFallback, onRouteChange, currentRoute } from './core/router.js';
import { startTheme, cycleMode, toggleSkin, current as currentTheme } from './ui/theme.js';
import { startPalette, registerProvider, openPalette } from './ui/palette.js';
import { toast } from './ui/toast.js';

import { renderToday, wireToday } from './views/today.js';
import { renderPots, wirePots } from './views/pots.js';
import { renderOrchard, wireOrchard } from './views/orchard.js';
import { renderSeeds, wireSeeds } from './views/seeds.js';
import { renderCatalogue, wireCatalogue, cataloguePaletteItems } from './views/catalogue.js';
import { renderZones, wireZones } from './views/zones.js';
import { renderFeed, wireFeed } from './views/feed.js';
import { renderBags, wireBags } from './views/bags.js';
import { renderShrooms, wireShrooms } from './views/shrooms.js';
import { renderClimate, wireClimate } from './views/climate.js';
import { renderBuy, wireBuy } from './views/buy.js';
import { renderCare, wireCare } from './views/care.js';
import { renderSettings, wireSettings } from './views/settings.js';
import { startSync } from './core/sync.js';
import { SCHEMA_VERSION } from './core/schema.js';

/* ==========================================================================
   Views
   ========================================================================== */
const VIEWS = [
  { k: 'today', label: 'Today', group: 'Daily', icon: 'sun', render: renderToday, wire: wireToday, primary: true },
  { k: 'orchard', label: 'Orchard', group: 'Growing', icon: 'tree', render: renderOrchard, wire: wireOrchard, primary: true },
  { k: 'seeds', label: 'Seeds', group: 'Growing', icon: 'seed', render: renderSeeds, wire: wireSeeds, primary: true },
  { k: 'pots', label: 'Pots', group: 'Growing', icon: 'pot', render: renderPots, wire: wirePots, primary: true },
  { k: 'shrooms', label: 'Mushrooms', group: 'Growing', icon: 'mushroom', render: renderShrooms, wire: wireShrooms },
  { k: 'catalogue', label: 'Catalogue', group: 'Reference', icon: 'book', render: renderCatalogue, wire: wireCatalogue, primary: true },
  { k: 'zones', label: 'Zones', group: 'Reference', icon: 'grid', render: renderZones, wire: wireZones },
  { k: 'feed', label: 'Feed', group: 'Reference', icon: 'flask', render: renderFeed, wire: wireFeed },
  { k: 'bags', label: 'Bags & mix', group: 'Reference', icon: 'bag', render: renderBags, wire: wireBags },
  { k: 'climate', label: 'Climate', group: 'Reference', icon: 'chart', render: renderClimate, wire: wireClimate },
  { k: 'care', label: 'Care', group: 'Reference', icon: 'heart', render: renderCare, wire: wireCare },
  { k: 'buy', label: 'Buying', group: 'Reference', icon: 'cart', render: renderBuy, wire: wireBuy },
  { k: 'settings', label: 'Settings', group: 'Data', icon: 'chip', render: renderSettings, wire: wireSettings }
];

const byKey = Object.fromEntries(VIEWS.map((v) => [v.k, v]));

/* ==========================================================================
   Chrome
   ========================================================================== */

function renderNav() {
  const state = store.get();
  const route = currentRoute();

  /* Badge counts, cheap to compute and worth the glance. */
  const badges = {
    orchard: Object.keys(state.orchard).length || null,
    seeds: state.sowings.filter((s) => !['planted', 'failed'].includes(s.status)).length || null,
    pots: state.specimens.length || null,
    catalogue: catalogue(state).length,
    buy: state.picks.length || null
  };

  let lastGroup = '';
  mount('nav', VIEWS.map((v) => {
    const head = v.group !== lastGroup ? `<div class="navgrp">${esc(v.group)}</div>` : '';
    lastGroup = v.group;
    const badge = badges[v.k] ? `<span class="cnt">${badges[v.k]}</span>` : '';
    return `${head}<button class="navb ${route.view === v.k ? 'on' : ''}" data-act="go" data-view="${v.k}"
      aria-current="${route.view === v.k ? 'page' : 'false'}">${icon(v.icon)}<span>${esc(v.label)}</span>${badge}</button>`;
  }).join(''));

  const primary = VIEWS.filter((v) => v.primary).slice(0, 4);
  mount('tabbar', [
    ...primary.map((v) => `<button class="tabb ${route.view === v.k ? 'on' : ''}" data-act="go" data-view="${v.k}">
        ${icon(v.icon)}<span>${esc(v.label)}</span></button>`),
    `<button class="tabb" data-act="more">${icon('dots')}<span>More</span></button>`
  ].join(''));

  mount('moregrid', VIEWS.map((v) => `
    <button class="moreb" data-act="go" data-view="${v.k}">${icon(v.icon)}<span>${esc(v.label)}</span></button>`).join(''));
}

function renderRailFoot() {
  const t = currentTheme();
  mount('railfoot', `
    <button class="btn ghost sm" data-act="palette">${icon('search')} Search <span class="pill" style="margin-left:auto">Ctrl K</span></button>
    <div class="row">
      <button class="btn sm" data-act="cycleskin" title="Swap skin (y)">${esc(t.skin === 'jungle' ? 'Jungle' : 'Precision')}</button>
      <button class="btn sm icon" data-act="cyclemode" title="Light / dark / auto (t)" aria-label="Theme mode">
        ${icon(t.resolved === 'dark' ? 'moon' : 'sun')}
      </button>
    </div>`);
}

/* ==========================================================================
   Routing
   ========================================================================== */

let mounted = new Set();

function activate(view, target, { changedView }) {
  for (const v of VIEWS) {
    byId(`v-${v.k}`)?.classList.toggle('on', v.k === view);
  }
  const v = byKey[view];
  if (!v) return;

  if (!mounted.has(view)) { v.wire?.(); mounted.add(view); }
  v.render(target);

  if (changedView) window.scrollTo({ top: 0, behavior: 'instant' });
  document.title = `${v.label} — The Angul Almanac`;
  byId('moresheet')?.classList.remove('on');
}

/* ==========================================================================
   Palette providers
   ========================================================================== */

function registerPaletteSources() {
  registerProvider(() => VIEWS.map((v) => ({
    title: v.label, sub: `Go to ${v.label.toLowerCase()}`, group: 'Navigate',
    run: () => go(v.k)
  })));

  registerProvider(() => [
    { title: 'Switch skin', sub: 'Jungle ⇄ Precision', group: 'Theme', keys: 'Y', run: () => { toggleSkin(); refreshChrome(); } },
    { title: 'Light / dark / auto', sub: 'Cycle the mode', group: 'Theme', keys: 'T', run: () => { cycleMode(); refreshChrome(); } },
    { title: 'Download backup', sub: 'Everything, as JSON', group: 'Data', run: () => go('settings') }
  ]);

  registerProvider(() => DB.orchard.ORCHARD.map((t) => ({
    title: t.name, sub: `${t.stock} · first fruit ${t.first}`, group: 'Orchard',
    run: () => go('orchard', t.id)
  })));

  registerProvider(() => store.get().sowings.map((s) => ({
    title: s.name, sub: `sown ${s.sownOn} · zone ${s.zone}`, group: 'Sowings',
    run: () => go('seeds')
  })));

  registerProvider(cataloguePaletteItems);
}

/* ==========================================================================
   Keyboard
   ========================================================================== */

function installKeys() {
  addEventListener('keydown', (e) => {
    const typing = /^(input|textarea|select)$/i.test(e.target.tagName) || e.target.isContentEditable;
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;

    if (e.key === 't') { cycleMode(); refreshChrome(); return; }
    if (e.key === 'y') { toggleSkin(); refreshChrome(); return; }
    if (e.key === 'Escape') { byId('moresheet')?.classList.remove('on'); return; }

    /* 1–9 and 0 reach the first ten views. */
    if (/^[0-9]$/.test(e.key)) {
      const i = e.key === '0' ? 9 : Number(e.key) - 1;
      if (VIEWS[i]) { e.preventDefault(); go(VIEWS[i].k); }
    }
  });
}

/* ==========================================================================
   Boot
   ========================================================================== */

function refreshChrome() { renderNav(); renderRailFoot(); }

async function boot() {
  const shell = byId('boot');

  try {
    await loadAll();
  } catch (err) {
    shell.innerHTML = `<div class="empty" style="margin:40px">
      Could not load the knowledge base.<br><br>
      <code>${esc(err.message)}</code><br><br>
      This build needs to be served over http, not opened as a file — ES modules and
      <code>fetch()</code> are both blocked on <code>file://</code>.
      Run <code>npx serve .</code> in this folder, or deploy it.
    </div>`;
    return;
  }

  /* State. The catalogue is passed in so the v9 migration can turn numeric
     species indexes into stable slugs while the old ordering still applies. */
  const raw = loadRaw();
  store.hydrate(raw, { catalogue: DB.catalogue.catalogue });
  store.setSaver(save);
  installFlush(store.get);
  setPersistErrorHandler((msg) => { if (msg) toast(msg, { ms: 9000 }); });

  /* Write the migrated shape once, immediately. Without this a v9 user who
     opens v10, reads, and closes leaves nothing under the new key, so the
     migration re-runs on every visit and a storage problem stays invisible
     until their first edit. The old bl_v7 key is deliberately left in place
     as a fallback copy. */
  if (!raw || Number(raw.v) !== SCHEMA_VERSION) saveImmediately(store.get());

  startTheme();
  startDelegation();
  installKeys();
  registerPaletteSources();
  startPalette();

  /* Global actions. */
  on('go', (el, e, ds) => go(ds.view));
  on('more', () => byId('moresheet').classList.toggle('on'));
  on('palette', () => openPalette());
  on('cyclemode', () => { cycleMode(); refreshChrome(); });
  on('cycleskin', () => { toggleSkin(); refreshChrome(); });

  for (const v of VIEWS) defineRoute(v.k, (target, meta) => activate(v.k, target, meta));
  setFallback(store.get().settings.startView || 'today');
  onRouteChange(() => refreshChrome());

  /* Re-render the active view whenever state changes. */
  store.subscribe(() => {
    const route = currentRoute();
    byKey[route.view]?.render(route.target);
    refreshChrome();
  });

  shell.remove();
  startRouter();
  refreshChrome();

  /* Optional extras — never allowed to break the app. */
  try { startSync(); } catch (err) { console.warn('[sync] disabled', err); }
  installOfflineBar();
  registerServiceWorker();
}

function installOfflineBar() {
  const bar = byId('offbar');
  const paint = () => bar.classList.toggle('on', !navigator.onLine);
  addEventListener('online', paint);
  addEventListener('offline', paint);
  paint();
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      sw?.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) {
          toast('A new version is ready', { actionLabel: 'Reload', action: () => location.reload(), ms: 12000 });
        }
      });
    });
  }).catch((err) => console.warn('[sw] registration failed', err));
}

boot();
