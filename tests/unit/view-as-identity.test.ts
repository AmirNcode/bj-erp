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
  session: null as unknown as RpcResult,
  probe: null as unknown as RpcResult,
  // Every rpc / from call, with the view-as header the client carried.
  rpcCalls: [] as { fn: string; viewAs: string | undefined }[],
  fromCalls: [] as { table: string; viewAs: string | undefined }[],
  authSignOut: vi.fn(async () => ({ error: null })),
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
  headers: async () => ({ get: () => null }),
}));

vi.mock('next/navigation', () => ({ redirect: state.redirect }));

vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: (_url: string, _key: string, options: { global?: { headers?: Record<string, string> } }) => {
    const viewAs = options.global?.headers?.['x-view-as'];
    return {
      auth: {
        // The admin's own token, carrying the admin's claims.
        getClaims: async () => ({
          data: { claims: { sub: ADMIN, email: 'admin@bj.test', app_roles: ['admin', 'employee'], app_perms: { people: 'edit' } } },
          error: null,
        }),
        signOut: state.authSignOut,
      },
      rpc: vi.fn(async (fn: string) => {
        state.rpcCalls.push({ fn, viewAs });
        if (fn === 'app_view_as_session') return state.session;
        if (fn === 'app_view_as_probe') return state.probe;
        if (fn === 'app_my_permissions') return { data: { calendar: 'read' }, error: null };
        return { data: null, error: null };
      }),
      from: (table: string) => {
        state.fromCalls.push({ table, viewAs });
        return {
          select: () => ({
            eq: async () => ({ data: [{ role: 'employee' }], error: null }),
          }),
        };
      },
    };
  },
}));

import { VIEW_AS_COOKIE } from '@/lib/supabase/constants';
import { createClient } from '@/lib/supabase/server';
import { getCachedPermissions, getCachedRoles, getCachedUser } from '@/lib/auth/context';
import { signOut } from '@/lib/actions/profile';
import { accrueBeforeRead } from '@/lib/actions/leave/shared';
import { GET as clearRoute } from '@/app/api/view-as/clear/route';
import { NextRequest } from 'next/server';

const liveSession: RpcResult = {
  data: [{ target_id: TARGET, target_name: 'Sara Ahmadi', personnel_no: '124', expires_at: '2026-11-07T10:30:00Z' }],
  error: null,
};
const liveProbe: RpcResult = { data: [{ uid: TARGET, read_only: 'on' }], error: null };
const deadSession: RpcResult = { data: [], error: null };

beforeEach(() => {
  state.cookies.clear();
  state.session = liveSession;
  state.probe = liveProbe;
  state.rpcCalls.length = 0;
  state.fromCalls.length = 0;
  state.authSignOut.mockClear();
  state.redirect.mockClear();
});

describe('identity while viewing', () => {
  it('getCachedUser returns the target while live', async () => {
    state.cookies.set(VIEW_AS_COOKIE, SESSION);
    expect(await getCachedUser()).toEqual({ id: TARGET });
  });

  it('getCachedUser returns the real user when dead', async () => {
    state.cookies.set(VIEW_AS_COOKIE, SESSION);
    state.session = deadSession;
    expect(await getCachedUser()).toEqual({ id: ADMIN, email: 'admin@bj.test' });
  });

  it('getCachedUser returns the real user without the cookie', async () => {
    expect(await getCachedUser()).toEqual({ id: ADMIN, email: 'admin@bj.test' });
    expect(state.rpcCalls).toEqual([]);
  });

  it('getCachedRoles reads user_roles, not the admin claim, while live', async () => {
    state.cookies.set(VIEW_AS_COOKIE, SESSION);
    const user = (await getCachedUser())!;
    expect(await getCachedRoles(user.id)).toEqual(['employee']);
    expect(state.fromCalls).toEqual([{ table: 'user_roles', viewAs: SESSION }]);
  });

  it('getCachedPermissions calls app_my_permissions while live', async () => {
    state.cookies.set(VIEW_AS_COOKIE, SESSION);
    const user = (await getCachedUser())!;
    expect(await getCachedPermissions(user.id)).toEqual({ calendar: 'read' });
    expect(state.rpcCalls).toContainEqual({ fn: 'app_my_permissions', viewAs: SESSION });
  });
});

describe('write guards', () => {
  it('signOut does not call auth.signOut with the cookie present', async () => {
    state.cookies.set(VIEW_AS_COOKIE, SESSION);
    await expect(signOut('en')).resolves.toBeUndefined();
    expect(state.authSignOut).not.toHaveBeenCalled();
    expect(state.redirect).not.toHaveBeenCalled();
  });

  it('signOut still signs out without the cookie', async () => {
    await expect(signOut('en')).rejects.toThrow('NEXT_REDIRECT /en/login');
    expect(state.authSignOut).toHaveBeenCalledTimes(1);
  });

  it('accrueBeforeRead makes no rpc call with the cookie present', async () => {
    state.cookies.set(VIEW_AS_COOKIE, SESSION);
    const supabase = await createClient();
    expect(await accrueBeforeRead(supabase)).toBeNull();
    expect(await accrueBeforeRead(supabase, TARGET)).toBeNull();
    expect(state.rpcCalls).toEqual([]);
  });

  it('accrueBeforeRead still accrues without the cookie', async () => {
    const supabase = await createClient();
    expect(await accrueBeforeRead(supabase)).toBeNull();
    expect(state.rpcCalls).toEqual([{ fn: 'accrue_my_leave', viewAs: undefined }]);
  });
});

function clearRequest(query: string) {
  // The standalone server's own address, as seen behind the gateway.
  return new NextRequest(`http://0.0.0.0:3000/api/view-as/clear${query}`);
}

function deletedCookie(res: Response) {
  return res.headers
    .getSetCookie()
    .find((c) => c.startsWith(`${VIEW_AS_COOKIE}=`));
}

describe('GET /api/view-as/clear', () => {
  it('clear route: dead deletes the cookie, redirects to /en/admin/view-as?ended=1', async () => {
    state.cookies.set(VIEW_AS_COOKIE, SESSION);
    state.session = deadSession;
    const res = await clearRoute(clearRequest('?locale=en'));
    expect(res.status).toBe(307);
    // Relative: behind the gateway the server's own host is 0.0.0.0:3000, which the browser cannot reach.
    expect(res.headers.get('location')).toBe('/en/admin/view-as?ended=1');
    const cookie = deletedCookie(res);
    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/);
  });

  it('clear route: live keeps the cookie, redirects to /en/home', async () => {
    state.cookies.set(VIEW_AS_COOKIE, SESSION);
    const res = await clearRoute(clearRequest('?locale=en'));
    expect(res.headers.get('location')).toBe('/en/home');
    expect(deletedCookie(res)).toBeUndefined();
  });

  it('clear route: bad locale falls back to the default locale', async () => {
    state.cookies.set(VIEW_AS_COOKIE, SESSION);
    state.session = deadSession;
    const res = await clearRoute(clearRequest('?locale=..%2Fevil'));
    expect(res.headers.get('location')).toBe('/fa/admin/view-as?ended=1');
  });
});
