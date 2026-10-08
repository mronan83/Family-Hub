// FamilyWise service worker (generated into apps/web/public/sw.js by packages/ui/scripts/brand.mjs).
// Precaches the self-hosted fonts so the board renders offline (06 §5, NFR-13). Offline data
// caching arrives with the board's offline work; this worker only serves what it precached.
const CACHE = '__CACHE__';
const PRECACHE = __PRECACHE__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('familywise-brand-') && k !== CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    !PRECACHE.includes(url.pathname)
  ) {
    return;
  }
  event.respondWith(
    caches
      .open(CACHE)
      .then((cache) => cache.match(url.pathname).then((hit) => hit || fetch(event.request))),
  );
});
