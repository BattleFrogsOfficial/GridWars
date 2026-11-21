// Service worker: makes the app open with no internet.
// Strategy: serve from cache immediately, refresh the cache in the background (stale-while-revalidate).
// Bump VERSION whenever the file list changes.
const VERSION = 'v1';
const CACHE = `coin-quest-${VERSION}`;
const FILES = [
  './',
  './index.html',
  './style.css',
  './manifest.webmanifest',
  './js/app.js',
  './js/ui.js',
  './js/budget.js',
  './js/dates.js',
  './js/debts.js',
  './js/money.js',
  './js/planner.js',
  './js/player.js',
  './js/sprites.js',
  './js/state.js',
  './js/storage.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('coin-quest-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);
      if (cached) {
        event.waitUntil(network);
        return cached;
      }
      return (await network) || (req.mode === 'navigate' ? cache.match('./index.html') : Response.error());
    }),
  );
});
