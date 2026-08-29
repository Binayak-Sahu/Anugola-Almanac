/* The Angul Almanac — service worker.
   Shell is cache-first so the app opens instantly with no signal.
   The sync endpoint is network-first, because stale data is worse than none. */
var CACHE = 'almanac-v9';
var SHELL = ['./', './index.html', './manifest.webmanifest',
             './icon-192.png', './icon-512.png', './icon-maskable.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(SHELL.map(function (u) {
      return c.add(u).catch(function () { /* a missing icon must not fail install */ });
    }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);

  /* never cache the sync function */
  if (url.pathname.indexOf('/.netlify/functions/') === 0) {
    e.respondWith(fetch(req).catch(function () {
      return new Response(JSON.stringify({ error: 'offline' }),
        { status: 503, headers: { 'content-type': 'application/json' } });
    }));
    return;
  }

  /* fonts and other cross-origin: cache what succeeds, serve what we have */
  if (url.origin !== location.origin) {
    e.respondWith(caches.match(req).then(function (hit) {
      return hit || fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () { return hit; });
    }));
    return;
  }

  /* app shell: cache first, refresh in the background */
  e.respondWith(caches.match(req).then(function (hit) {
    var net = fetch(req).then(function (res) {
      if (res && res.status === 200) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () { return hit; });
    return hit || net;
  }));
});
