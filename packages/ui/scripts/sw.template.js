// FamilyWise service worker (generated into apps/web/public/sw.js by packages/ui/scripts/brand.mjs).
// Precaches the self-hosted fonts so the board renders offline (06 §5, NFR-13). [NFR-01][DEV-06]
// Keeps the board's page and the build files it loaded, so a board that reloads with no network
// still opens on its last day (WP-13, D-54); its data and outbox live in IndexedDB. Other pages, the
// API and Supabase always go to the network.
// [CHR-15] Shows reminders pushed to the admin app and opens the item when one is tapped (WP-40,
// D-58).
const CACHE = '__CACHE__';
const PRECACHE = __PRECACHE__;
// The board's page (network first) and the build's content-hashed files (cache first).
const PAGES = 'familywise-pages-v1';
const STATIC = 'familywise-static-v1';
const KEEP = [CACHE, PAGES, STATIC];
const BOARD_PAGES = ['/board', '/dev/board'];
// Enough for several deploys' files; the oldest go first.
const STATIC_LIMIT = 400;

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
            .filter((k) => k.startsWith('familywise-') && !KEEP.includes(k))
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (PRECACHE.includes(url.pathname)) {
    event.respondWith(
      caches
        .open(CACHE)
        .then((cache) => cache.match(url.pathname).then((hit) => hit || fetch(request))),
    );
  } else if (request.mode === 'navigate' && BOARD_PAGES.includes(url.pathname)) {
    event.respondWith(boardPage(request, url.pathname));
  } else if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request));
  } else if (
    url.pathname.startsWith('/brand/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/board.webmanifest'
  ) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

// [CHR-15][CHR-16] A reminder from the reminders job: {title, body, url, tag}. One per tag: a
// reminder sent again (it never should be) replaces the first rather than stacking.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'FamilyWise', {
      body: data.body || '',
      tag: data.tag || undefined,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-maskable-192.png',
      data: {
        url: typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/admin/my',
      },
    }),
  );
});

// Tapping a reminder opens its item in My tasks, in an open window of the app if there is one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/admin/my', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) return open.navigate(url).then((w) => (w || open).focus());
      return self.clients.openWindow(url);
    }),
  );
});

/**
 * The board's page from the network, kept for next time; from the cache only when there is no
 * network. Whatever the server answers (a redirect to pairing, or to sign in again) is followed, and
 * only a page is kept.
 */
async function boardPage(request, path) {
  const cache = await caches.open(PAGES);
  try {
    const res = await fetch(request);
    if (res.ok && res.type === 'basic') await cache.put(path, res.clone());
    return res;
  } catch (offline) {
    const hit = await cache.match(path, { ignoreSearch: true, ignoreVary: true });
    if (hit) return hit;
    throw offline;
  }
}

/** A build file never changes under its name: the cache answers, the network fills it. */
async function cacheFirst(request) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && res.type === 'basic') {
    await cache.put(request, res.clone());
    const keys = await cache.keys();
    await Promise.all(
      keys.slice(0, Math.max(0, keys.length - STATIC_LIMIT)).map((k) => cache.delete(k)),
    );
  }
  return res;
}

/** Brand files and icons: the cached copy at once, refreshed from the network for next time. */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(request);
  const network = fetch(request)
    .then(async (res) => {
      if (res.ok && res.type === 'basic') await cache.put(request, res.clone());
      return res;
    })
    .catch(() => undefined);
  return hit || (await network) || Response.error();
}
