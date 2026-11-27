/* Gym Companion public web app: offline cache. (The private server build uses sw.js, which caches
 * nothing on purpose.) All data lives in IndexedDB, so the app shell is all that needs caching.
 * Strategy: serve from cache, refresh in the background; a new CACHE name drops old copies.
 * Bump CACHE whenever any shipped file changes (tools/build.sh does this from a content hash).
 */
var CACHE = 'gym-public-945b16106889';
var SHELL = ['./', 'index.html', 'config.js', 'body.js', 'character.js', 'gymcore.js', 'gymstore.js',
  'backup.js', 'pwa.js', 'manifest.json', 'icon-180.png', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('gym-public-') === 0 && k !== CACHE; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(function (c) {
    return c.match(req, {ignoreSearch: true}).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res && res.ok) c.put(req, res.clone());
        return res;
      }).catch(function () { return hit || c.match('index.html'); });
      return hit || net;
    });
  }));
});
