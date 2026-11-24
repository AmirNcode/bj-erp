/*
 * bj service worker — static files only (spec docs/specs/2026-11-24-perceived-speed-design.md §7).
 *
 * ALLOWLIST: it stores build files, icons, the logo and the offline page, nothing else.
 * Every other request is left to the browser (no respondWith): page data, RSC fetches,
 * /api (uploads and downloads, even as navigations), /rest, /auth, /print. Page navigations pass
 * straight to the network and are never stored; only a network failure shows the
 * offline page. Never add a data path here: it would keep personal data on devices.
 *
 * Kill switch: docs/DEPLOY-LIARA.md › "Service worker kill switch".
 */
const CACHE = 'bj-static-v1'; // build files + icons, trimmed to MAX_ENTRIES
const SHELL = 'bj-static-shell-v1'; // offline page + its logo, never trimmed
const MAX_ENTRIES = 300;
const OFFLINE = '/offline.html';
// The offline page and the logo it shows, stored on install. Bump SHELL (and CACHE
// for /icons) when the logo or icons change: they are not content-hashed.
const PRECACHE = [OFFLINE, '/bj-logo.png'];
// Never handled by the worker, even as a navigation (file downloads, printouts, data).
const BYPASS = ['/api/', '/rest/', '/auth/'];

function isStatic(pathname) {
  return (
    pathname.startsWith('/_next/static/') ||
    pathname.startsWith('/icons/') ||
    pathname === '/bj-logo.png' ||
    pathname === OFFLINE
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names.filter((n) => n.startsWith('bj-static-') && n !== CACHE && n !== SHELL).map((n) => caches.delete(n))
        )
      )
      .then(() => self.registration.navigationPreload && self.registration.navigationPreload.enable())
      .then(() => self.clients.claim())
  );
});

async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_ENTRIES; i++) await cache.delete(keys[i]);
}

async function cacheFirst(event) {
  const request = event.request;
  const hit = await caches.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.status === 200 && response.type === 'basic') {
    // Answer at once; store in the background. A failed write (full disk) never fails the load.
    const copy = response.clone();
    event.waitUntil(
      caches
        .open(CACHE)
        .then((cache) => cache.put(request, copy).then(() => trim(cache)))
        .catch(() => {})
    );
  }
  return response;
}

async function offlineFallback() {
  const page = await caches.match(OFFLINE);
  return page || new Response('', { status: 503, statusText: 'Offline' });
}

async function navigate(event) {
  const preloaded = await event.preloadResponse;
  return preloaded || fetch(event.request);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (BYPASS.some((p) => url.pathname.startsWith(p)) || /^\/[a-z]{2}\/print\/|^\/print\//.test(url.pathname)) return;

  if (request.mode === 'navigate') {
    event.respondWith(navigate(event).catch(offlineFallback));
    return;
  }
  if (isStatic(url.pathname)) event.respondWith(cacheFirst(event));
});
