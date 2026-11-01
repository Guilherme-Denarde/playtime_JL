// Offline support. Tries the network first so new deployments show up right away,
// and falls back to the last saved copy. Database calls are never cached.
const CACHE = 'playtime-v1';
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/styles.css', 'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-192.png',
  'js/account.js', 'js/app.js', 'js/cloud.js', 'js/crypto.js', 'js/history.js', 'js/home.js',
  'js/kid.js', 'js/logic.js', 'js/reports.js', 'js/settings.js', 'js/store.js', 'js/ui.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
    }
    return res;
  }).catch(async () => (await caches.match(e.request, { ignoreSearch: true }))
    || (e.request.mode === 'navigate' ? caches.match('index.html') : Response.error())));
});
