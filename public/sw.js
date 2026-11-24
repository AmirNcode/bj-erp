/*
 * bj service worker — static files only (spec docs/specs/2026-11-24-perceived-speed-design.md §7).
 *
 * ALLOWLIST: it stores build files, icons, the logo and the offline page, nothing else.
 * Every other request is left to the browser (no respondWith): page data, RSC fetches,
 * /api (file uploads stream through untouched), /rest, /auth. Page navigations pass
 * straight to the network and are never stored; only a network failure shows the
 * offline page. Never add a data path here: it would keep personal data on devices.
 *
 * Kill switch: docs/DEPLOY-LIARA.md › "Service worker kill switch".
 */
const CACHE = 'bj-static-v1';
const MAX_ENTRIES = 300;
const OFFLINE = '/offline.html';
// The offline page and the logo it shows, stored on install.
const PRECACHE = [OFFLINE, '/bj-logo.png'];

function isStatic(pathname) {
  return (
    pathname.startsWith('/_next/static/') ||
    pathname.startsWith('/icons/') ||
    pathname === '/bj-logo.png' ||
    pathname === OFFLINE
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names.filter((n) => n.startsWith('bj-static-') && n !== CACHE).map((n) => caches.delete(n))
        )
      )
      .then(() => self.clients.claim())
  );
});

async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_ENTRIES; i++) await cache.delete(keys[i]);
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.status === 200 && response.type === 'basic') {
    await cache.put(request, response.clone());
    await trim(cache);
  }
  return response;
}

async function offlineFallback() {
  const page = await caches.match(OFFLINE);
  return page || Response.error();
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(offlineFallback));
    return;
  }
  if (isStatic(url.pathname)) event.respondWith(cacheFirst(request));
});
