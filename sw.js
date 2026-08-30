/* ============================================================================
   The Angul Almanac — service worker.

   Three caching strategies, chosen per resource because the right answer
   differs:

     APP SHELL (html, css, js)   stale-while-revalidate. Opens instantly with
                                 no signal; picks up a new build in the
                                 background and tells the page to offer a reload.
     KNOWLEDGE BASE (/data/*)    cache-first, versioned. It is immutable within
                                 a release, so re-validating it is wasted bytes
                                 on a phone in a garden.
     SYNC FUNCTION               network-only. Stale ledger data is worse than
                                 no ledger data — it would silently overwrite
                                 the newer copy on the other device.

   The cache name carries the build version. Bump VERSION on every deploy and
   activate() clears everything older in one pass.
   ========================================================================== */

const VERSION = 'v10.0.0';
const SHELL_CACHE = `almanac-shell-${VERSION}`;
const DATA_CACHE = `almanac-data-${VERSION}`;
const RUNTIME_CACHE = `almanac-runtime-${VERSION}`;
const CACHES = [SHELL_CACHE, DATA_CACHE, RUNTIME_CACHE];

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable.png',

  './src/main.js',
  './src/core/dom.js',
  './src/core/util.js',
  './src/core/schema.js',
  './src/core/store.js',
  './src/core/persist.js',
  './src/core/data.js',
  './src/core/router.js',
  './src/core/sync.js',
  './src/engine/solar.js',
  './src/engine/heat.js',
  './src/engine/water.js',
  './src/engine/orchard.js',
  './src/engine/germination.js',
  './src/engine/feed.js',
  './src/engine/agenda.js',
  './src/ui/theme-boot.js',
  './src/ui/theme.js',
  './src/ui/palette.js',
  './src/ui/search.js',
  './src/ui/toast.js',
  './src/ui/components.js',
  './src/views/today.js',
  './src/views/orchard.js',
  './src/views/seeds.js',
  './src/views/pots.js',
  './src/views/catalogue.js',
  './src/views/zones.js',
  './src/views/feed.js',
  './src/views/bags.js',
  './src/views/shrooms.js',
  './src/views/climate.js',
  './src/views/care.js',
  './src/views/buy.js',
  './src/views/settings.js',
  './src/styles/tokens.css',
  './src/styles/base.css',
  './src/styles/layout.css',
  './src/styles/components.css',
  './src/styles/views.css',
  './src/styles/legacy-prose.css'
];

const DATA = [
  './data/catalogue.json', './data/orchard.json', './data/zones.json',
  './data/seeds.json', './data/mushrooms.json', './data/feed.json',
  './data/soil.json', './data/climate.json', './data/sources.json',
  './data/care.json', './data/prose.json'
];

/* -------------------------------------------------------------- install -- */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    const data = await caches.open(DATA_CACHE);
    /* One missing icon must never fail the whole install, so each entry is
       added individually and allowed to fail. */
    await Promise.all([
      ...SHELL.map((url) => shell.add(url).catch((e) => console.warn('[sw] skipped', url, e.message))),
      ...DATA.map((url) => data.add(url).catch((e) => console.warn('[sw] skipped', url, e.message)))
    ]);
    await self.skipWaiting();
  })());
});

/* ------------------------------------------------------------- activate -- */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('almanac') && !CACHES.includes(k))
      .map((k) => caches.delete(k)));
    /* Speeds up repeat navigations on a slow connection. */
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
    await self.clients.claim();
  })());
});

/* ---------------------------------------------------------------- fetch -- */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  /* The sync endpoint is never cached. */
  if (url.pathname.startsWith('/.netlify/functions/')) {
    event.respondWith(fetch(req).catch(() => new Response(
      JSON.stringify({ error: 'offline' }),
      { status: 503, headers: { 'content-type': 'application/json' } }
    )));
    return;
  }

  /* Navigations: serve the shell so deep links work offline. */
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const preload = await event.preloadResponse;
        if (preload) return preload;
        return await fetch(req);
      } catch {
        return (await caches.match('./index.html', { cacheName: SHELL_CACHE }))
          || (await caches.match('./index.html'))
          || Response.error();
      }
    })());
    return;
  }

  /* Knowledge base: cache-first. */
  if (url.origin === location.origin && url.pathname.includes('/data/')) {
    event.respondWith(cacheFirst(req, DATA_CACHE));
    return;
  }

  /* Cross-origin (fonts): cache-first, and never fail the page over it. */
  if (url.origin !== location.origin) {
    event.respondWith(cacheFirst(req, RUNTIME_CACHE));
    return;
  }

  /* App shell: stale-while-revalidate. */
  event.respondWith(staleWhileRevalidate(req, SHELL_CACHE));
});

async function cacheFirst(req, cacheName) {
  const hit = await caches.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === 'opaque')) {
      const cache = await caches.open(cacheName);
      cache.put(req, res.clone());
    }
    return res;
  } catch (err) {
    return hit || Response.error();
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const network = fetch(req).then((res) => {
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  }).catch(() => hit);
  return hit || network;
}

/* Allow the page to trigger an immediate update. */
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});
