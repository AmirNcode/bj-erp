// public/sw.js runs in a fake service-worker global (node:vm). It must cache only
// static files + the offline page and leave every data / upload request alone.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const SRC = readFileSync(path.resolve(__dirname, '../../public/sw.js'), 'utf8');
const ORIGIN = 'https://bjeng.app';

type Res = { status: number; type: string; body?: string; clone?: () => Res };
const res = (status = 200, type = 'basic', body = 'x'): Res => {
  const r: Res = { status, type, body };
  r.clone = () => ({ ...r });
  return r;
};

function fakeCaches() {
  const stores = new Map<string, Map<string, Res>>();
  const open = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name)!;
    const key = (r: { url: string } | string) => (typeof r === 'string' ? new URL(r, ORIGIN).href : r.url);
    return {
      match: async (r: { url: string } | string) => m.get(key(r)),
      put: async (r: { url: string } | string, v: Res) => void m.set(key(r), v),
      add: async (u: string) => void m.set(key(u), res(200, 'basic', 'offline')),
      addAll: async (us: string[]) => us.forEach((u) => m.set(key(u), res(200, 'basic', u === '/offline.html' ? 'offline' : 'x'))),
      keys: async () => [...m.keys()].map((url) => ({ url })),
      delete: async (r: { url: string } | string) => m.delete(key(r)),
    };
  };
  return {
    stores,
    api: {
      open,
      keys: async () => [...stores.keys()],
      delete: async (n: string) => stores.delete(n),
      match: async (r: { url: string } | string) => {
        for (const n of stores.keys()) {
          const hit = await (await open(n)).match(r);
          if (hit) return hit;
        }
        return undefined;
      },
    },
  };
}

let handlers: Record<string, (e: unknown) => void>;
let caches: ReturnType<typeof fakeCaches>;
let fetchMock: ReturnType<typeof vi.fn>;

function load() {
  handlers = {};
  caches = fakeCaches();
  fetchMock = vi.fn(async () => res());
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (t: string, fn: (e: unknown) => void) => (handlers[t] = fn),
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn() },
  };
  vm.runInNewContext(SRC, { self, caches: caches.api, fetch: fetchMock, URL, Promise, console });
}

function fire(url: string, init: { method?: string; mode?: string } = {}) {
  const request = { url: new URL(url, ORIGIN).href, method: init.method ?? 'GET', mode: init.mode ?? 'cors', headers: {} };
  const event = {
    request,
    respondWith: vi.fn(),
    waitUntil: vi.fn(),
  };
  handlers.fetch(event);
  const responded = event.respondWith.mock.calls[0]?.[0] as Promise<Res> | undefined;
  return { event, responded };
}

async function lifecycle(type: 'install' | 'activate') {
  const waits: Promise<unknown>[] = [];
  handlers[type]({ waitUntil: (p: Promise<unknown>) => waits.push(p) });
  await Promise.all(waits);
}

const cacheSize = () => caches.stores.get('bj-static-v1')?.size ?? 0;

beforeEach(load);

describe('service worker leaves data and uploads alone', () => {
  it('leaves POST /api/sales/files/x alone', () => {
    expect(fire('/api/sales/files/x', { method: 'POST' }).event.respondWith).not.toHaveBeenCalled();
  });
  it('leaves GET /api/sales/files/x alone', () => {
    expect(fire('/api/sales/files/x').event.respondWith).not.toHaveBeenCalled();
  });
  it('leaves GET /rest/v1/profiles alone', () => {
    expect(fire('/rest/v1/profiles').event.respondWith).not.toHaveBeenCalled();
  });
  it('leaves an RSC fetch alone', () => {
    expect(fire('/fa/sales?_rsc=abc').event.respondWith).not.toHaveBeenCalled();
  });
  it('leaves cross-origin GET alone', () => {
    expect(fire('https://other.example/_next/static/a.js').event.respondWith).not.toHaveBeenCalled();
  });
});

describe('navigations', () => {
  it('returns the network response and stores nothing', async () => {
    const page = res(200, 'basic', 'page');
    fetchMock.mockResolvedValueOnce(page);
    const { responded } = fire('/fa/home', { mode: 'navigate' });
    expect(await responded).toBe(page);
    expect(cacheSize()).toBe(0);
  });
  it('passes a redirect through unchanged', async () => {
    const redirect = res(0, 'opaqueredirect', '');
    fetchMock.mockResolvedValueOnce(redirect);
    const { responded } = fire('/fa/home', { mode: 'navigate' });
    expect(await responded).toBe(redirect);
  });
  it('offline returns /offline.html', async () => {
    await lifecycle('install');
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const { responded } = fire('/fa/home', { mode: 'navigate' });
    expect((await responded)?.body).toBe('offline');
  });
});

describe('static files', () => {
  it('are cache-first', async () => {
    await fire('/_next/static/chunks/a.js').responded;
    const second = await fire('/_next/static/chunks/a.js').responded;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second?.status).toBe(200);
  });
  it('a non-200 response is not stored', async () => {
    fetchMock.mockResolvedValueOnce(res(404));
    await fire('/_next/static/chunks/gone.js').responded;
    expect(cacheSize()).toBe(0);
  });
  it('the cache trims to 300 entries', async () => {
    for (let i = 0; i <= 300; i++) await fire(`/_next/static/chunks/c${i}.js`).responded;
    expect(cacheSize()).toBe(300);
    expect(caches.stores.get('bj-static-v1')!.has(`${ORIGIN}/_next/static/chunks/c0.js`)).toBe(false);
  });
  it('icons and the logo are cached', async () => {
    await fire('/icons/icon-192.png').responded;
    await fire('/bj-logo.png').responded;
    expect(cacheSize()).toBe(2);
  });
});

describe('lifecycle', () => {
  it('install precaches the offline page and the logo it shows', async () => {
    await lifecycle('install');
    expect(caches.stores.get('bj-static-v1')!.has(`${ORIGIN}/offline.html`)).toBe(true);
    expect(caches.stores.get('bj-static-v1')!.has(`${ORIGIN}/bj-logo.png`)).toBe(true);
  });
  it('activate deletes old bj-static caches only', async () => {
    await caches.api.open('bj-static-v0');
    await caches.api.open('other');
    await lifecycle('activate');
    const names = await caches.api.keys();
    expect(names).not.toContain('bj-static-v0');
    expect(names).toContain('other');
  });
});
