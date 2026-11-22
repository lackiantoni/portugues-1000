// Offline cache for Português 1000. VERSION is rewritten by build_app_data.py from file contents.
const PREFIX = 'pt1000|' + new URL(self.registration.scope).pathname + '|';
const VERSION = 'f48cef32e4';
const CACHE = PREFIX + VERSION;
const FILES = ['./', 'index.html', 'styles.css', 'app.js', 'words.js', 'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', e => {
  // cache: 'reload' skips the HTTP cache so a new VERSION always gets fresh files
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE && (k.startsWith(PREFIX) || k.startsWith('pt1000-'))).map(k => caches.delete(k)))) // pt1000- = caches of the first sample builds
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(cache =>
    cache.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(res => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    }).catch(err => {
      if (req.mode === 'navigate') return cache.match('index.html');
      throw err;
    }))
  ));
});
