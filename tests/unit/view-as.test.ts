import { beforeEach, describe, expect, it, vi } from 'vitest';

// server.ts reads these at import time.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.test';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
});

const ADMIN = '00000000-0000-0000-0000-00000000000a';
const TARGET = '00000000-0000-0000-0000-0000000000b0';
const SESSION = '11111111-1111-1111-1111-111111111111';

type RpcResult = { data: unknown; error: unknown };

const state = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  requestHeaders: new Map<string, string>(),
  // Each created client: the headers it sends, and its rpc mock.
  clients: [] as { headers: Record<string, string>; rpc: ReturnType<typeof vi.fn> }[],
  session: null as unknown as RpcResult,
  probe: null as unknown as RpcResult,
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  }),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      state.cookies.has(name) ? { name, value: state.cookies.get(name)! } : undefined,
    has: (name: string) => state.cookies.has(name),
    getAll: () => [...state.cookies].map(([name, value]) => ({ name, value })),
    set: () => {},
  }),
  headers: async () => ({ get: (name: string) => state.requestHeaders.get(name) ?? null }),
}));

vi.mock('next/navigation', () => ({ redirect: state.redirect }));

vi.mock('@supabase/ssr', () => ({
  createServerClient: (_url: string, _key: string, options: { global?: { headers?: Record<string, string> } }) => {
    const headers = { ...(options.global?.headers ?? {}) };
    const rpc = vi.fn(async (fn: string) => {
      if (fn === 'app_view_as_session') return state.session;
      if (fn === 'app_view_as_probe') return state.probe;
      throw new Error(`unexpected rpc ${fn}`);
    });
    state.clients.push({ headers, rpc });
    return { rpc };
  },
}));

import { createClient, createRealClient, createClientForViewAs } from '@/lib/supabase/server';
import { CLIENT_IP_HEADER, VIEW_AS_COOKIE, VIEW_AS_HEADER } from '@/lib/supabase/constants';
import { getViewAs, probeViewAs, redirectIfViewDead } from '@/lib/auth/viewAs';

const liveSession: RpcResult = {
  data: [{ target_id: TARGET, target_name: 'Sara Ahmadi', personnel_no: '124', expires_at: '2026-11-07T10:30:00Z' }],
  error: null,
};
const liveProbe: RpcResult = { data: [{ uid: TARGET, read_only: 'on' }], error: null };

function allRpcCalls() {
  return state.clients.flatMap((c) => c.rpc.mock.calls);
}

beforeEach(() => {
  state.cookies.clear();
  state.requestHeaders.clear();
  state.clients.length = 0;
  state.session = liveSession;
  state.probe = liveProbe;
  state.redirect.mockClear();
});

describe('getViewAs', () => {
  it('makes no database call without the cookie', async () => {
    expect(await getViewAs()).toBeNull();
    expect(allRpcCalls()).toEqual([]);
  });

  it('is live when the session and probe agree', async () => {
    state.cookies.set(VIEW_AS_COOKIE, SESSION);
    expect(await getViewAs()).toEqual({
      status: 'live',
      sessionId: SESSION,
      targetId: TARGET,
      name: 'Sara Ahmadi',
      personnelNo: '124',
      expiresAt: '2026-11-07T10:30:00Z',
    });
    // Session read through a client without the header, probe through one with it.
    const sessionClient = state.clients.find((c) =>
      c.rpc.mock.calls.some(([fn]) => fn === 'app_view_as_session'),
    )!;
    expect(sessionClient.headers[VIEW_AS_HEADER]).toBeUndefined();
    expect(sessionClient.rpc).toHaveBeenCalledWith('app_view_as_session', { p_id: SESSION });
    const probeClient = state.clients.find((c) =>
      c.rpc.mock.calls.some(([fn]) => fn === 'app_view_as_probe'),
    )!;
    expect(probeClient.headers[VIEW_AS_HEADER]).toBe(SESSION);
  });

  it('is dead when the session is empty', async () => {
    state.cookies.set(VIEW_AS_COOKIE, SESSION);
    state.session = { data: [], error: null };
    expect(await getViewAs()).toEqual({ status: 'dead' });
  });

  it('is dead when app_view_as_session errors', async () => {
    state.cookies.set(VIEW_AS_COOKIE, SESSION);
    state.session = { data: null, error: { message: 'boom' } };
    expect(await getViewAs()).toEqual({ status: 'dead' });
  });

  it('is dead when the probe returns the admin id', async () => {
    state.cookies.set(VIEW_AS_COOKIE, SESSION);
    state.probe = { data: [{ uid: ADMIN, read_only: 'off' }], error: null };
    expect(await getViewAs()).toEqual({ status: 'dead' });
  });

  it('is dead when the probe says read_only off', async () => {
    state.cookies.set(VIEW_AS_COOKIE, SESSION);
    state.probe = { data: [{ uid: TARGET, read_only: 'off' }], error: null };
    expect(await getViewAs()).toEqual({ status: 'dead' });
  });

  it('is dead when the probe errors', async () => {
    state.cookies.set(VIEW_AS_COOKIE, SESSION);
    state.probe = { data: null, error: { code: 'PT403', message: 'view-as refused' } };
    expect(await getViewAs()).toEqual({ status: 'dead' });
  });
});

describe('probeViewAs', () => {
  it('is true only for exactly that pair', async () => {
    expect(await probeViewAs(SESSION, TARGET)).toBe(true);
    expect(await probeViewAs(SESSION, ADMIN)).toBe(false);
  });

  it('is false when the rpc throws', async () => {
    state.probe = Promise.reject(new Error('network')) as unknown as RpcResult;
    (state.probe as unknown as Promise<unknown>).catch(() => {});
    expect(await probeViewAs(SESSION, TARGET)).toBe(false);
  });
});

describe('clients', () => {
  it('createClient sends the header for a dead session', async () => {
    state.cookies.set(VIEW_AS_COOKIE, SESSION);
    state.session = { data: [], error: null };
    state.requestHeaders.set(CLIENT_IP_HEADER, '10.0.0.7');
    await createClient();
    const c = state.clients.at(-1)!;
    expect(c.headers[VIEW_AS_HEADER]).toBe(SESSION);
    expect(c.headers[CLIENT_IP_HEADER]).toBe('10.0.0.7');
    // The cookie alone decides: no session lookup happened.
    expect(allRpcCalls()).toEqual([]);
  });

  it('createClient sends no header without the cookie', async () => {
    await createClient();
    expect(state.clients.at(-1)!.headers[VIEW_AS_HEADER]).toBeUndefined();
  });

  it('createRealClient never sends the header', async () => {
    state.cookies.set(VIEW_AS_COOKIE, SESSION);
    state.requestHeaders.set(CLIENT_IP_HEADER, '10.0.0.7');
    await createRealClient();
    const c = state.clients.at(-1)!;
    expect(c.headers[VIEW_AS_HEADER]).toBeUndefined();
    expect(c.headers[CLIENT_IP_HEADER]).toBe('10.0.0.7');
  });

  it('createClientForViewAs always sends the given id', async () => {
    await createClientForViewAs('22222222-2222-2222-2222-222222222222');
    expect(state.clients.at(-1)!.headers[VIEW_AS_HEADER]).toBe('22222222-2222-2222-2222-222222222222');
  });
});

describe('redirectIfViewDead', () => {
  it('redirects to /api/view-as/clear?locale=fa on dead', async () => {
    state.cookies.set(VIEW_AS_COOKIE, SESSION);
    state.session = { data: [], error: null };
    await expect(redirectIfViewDead('fa')).rejects.toThrow('NEXT_REDIRECT');
    expect(state.redirect).toHaveBeenCalledWith('/api/view-as/clear?locale=fa');
  });

  it('returns the live view', async () => {
    state.cookies.set(VIEW_AS_COOKIE, SESSION);
    expect(await redirectIfViewDead('en')).toMatchObject({ status: 'live', targetId: TARGET });
    expect(state.redirect).not.toHaveBeenCalled();
  });

  it('returns null without the cookie', async () => {
    expect(await redirectIfViewDead('en')).toBeNull();
    expect(state.redirect).not.toHaveBeenCalled();
  });
});
