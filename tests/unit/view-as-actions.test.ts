import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  getViewAs: vi.fn(),
  probe: vi.fn(),
  requireCaller: vi.fn(),
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ set: mocks.set, delete: mocks.del }) }));
vi.mock('@/lib/supabase/server', () => ({ createRealClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('@/lib/auth/viewAs', () => ({ getViewAs: mocks.getViewAs, probeViewAs: mocks.probe }));
vi.mock('@/lib/auth/context', () => ({ requireCaller: mocks.requireCaller }));
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }));

import { getViewAsPeople, startViewAs } from '@/lib/actions/view-as';
import { buildViewAsPeople } from '@/lib/admin/viewAs';

const roleName = (r: string) => `role:${r}`;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getViewAs.mockResolvedValue(null);
});

describe('getViewAsPeople', () => {
  it('refuses a non-admin before reaching the database', async () => {
    mocks.requireCaller.mockResolvedValue({ ok: false, error: 'nope' });
    const r = await getViewAsPeople();
    expect(r).toEqual({ ok: false, error: 'nope' });
    expect(mocks.requireCaller).toHaveBeenCalledWith({ anyOf: ['admin'], company: true });
  });
});

describe('startViewAs', () => {
  it('refuses while the cookie is present', async () => {
    mocks.getViewAs.mockResolvedValue({ status: 'dead' });
    const r = await startViewAs('t1');
    expect(r.ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('sets the cookie with the agreed attributes', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ session_id: 's1', expires_at: 'x' }], error: null });
    mocks.probe.mockResolvedValue(true);
    expect(await startViewAs('t1')).toEqual({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledWith('app_view_as_start', { p_target: 't1' });
    expect(mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'bj-view-as', value: 's1', httpOnly: true, sameSite: 'lax', path: '/', maxAge: 86400 })
    );
    expect(mocks.probe).toHaveBeenCalledWith('s1', 't1');
  });

  it('ends the session and deletes the cookie when the probe fails', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ session_id: 's1', expires_at: 'x' }], error: null });
    mocks.probe.mockResolvedValue(false);
    const r = await startViewAs('t1');
    expect(r).toEqual({ ok: false, error: 'viewAsUnavailable' });
    expect(mocks.rpc).toHaveBeenLastCalledWith('app_view_as_end');
    expect(mocks.del).toHaveBeenCalledWith({ name: 'bj-view-as', path: '/' });
  });
});

describe('buildViewAsPeople', () => {
  const profiles = [
    { id: 'a', full_name: 'Ali', personnel_no: '12' },
    { id: 'b', full_name: 'Bita', personnel_no: null },
    { id: 'c', full_name: 'Cyrus', personnel_no: '30' },
  ];
  it('labels a built-in role', () => {
    const out = buildViewAsPeople(profiles, [{ user_id: 'a', role: 'manager', roles: { name: 'Manager' } }], roleName);
    expect(out.find((p) => p.id === 'a')).toEqual({ id: 'a', name: 'Ali', personnelNo: '12', hint: 'role:manager' });
  });
  it('labels a custom-role-only person with the role name', () => {
    const out = buildViewAsPeople(profiles, [{ user_id: 'c', role: null, roles: { name: 'Procurement' } }], roleName);
    expect(out.find((p) => p.id === 'c')?.hint).toBe('Procurement');
  });
  it('keeps a person with no personnel number', () => {
    const out = buildViewAsPeople(profiles, [], roleName);
    expect(out.find((p) => p.id === 'b')).toEqual({ id: 'b', name: 'Bita', personnelNo: null, hint: 'role:employee' });
  });
});
