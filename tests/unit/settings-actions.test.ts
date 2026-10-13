/**
 * Server-action gates in lib/actions/settings.ts (FR-55 R3): which permission
 * each write asks requireCaller for, and what reaches the database. The
 * database (RLS + work_settings_enforce_scope + the RPC) is the boundary; these
 * pin the fast refusals and the shape of the writes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { can, type Level, type PermKey, type Perms } from '@/lib/permissions/catalog';

const calls: { kind: string; table?: string; fn?: string; payload?: unknown }[] = [];
let callerPerms: Perms = {};

function fakeSupabase() {
  const chain = (table: string) => {
    const q = {
      upsert: (payload: unknown) => {
        calls.push({ kind: 'upsert', table, payload });
        return q;
      },
      select: async () => ({ data: [{ id: 'row' }], error: null }),
    };
    return q;
  };
  return {
    from: chain,
    rpc: async (fn: string, payload: unknown) => {
      calls.push({ kind: 'rpc', fn, payload });
      return { data: null, error: null };
    },
  };
}

vi.mock('@/lib/auth/context', () => ({
  requireCaller: async ({ perm }: { perm?: [PermKey, Level] } = {}) => {
    if (perm && !can(callerPerms, perm[0], perm[1])) return { ok: false, error: 'notAllowed' };
    return { ok: true, supabase: fakeSupabase(), user: { id: 'me' }, roles: [], perms: callerPerms, companyId: 'co' };
  },
}));
vi.mock('@/lib/cache/invalidate-app', () => ({ invalidateAppCache: vi.fn() }));
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}));

const { setApprovalOrderEnforced, updateWorkSettings } = await import('@/lib/actions/settings');

const WORK = {
  weekendDays: [5],
  workStart: '07:00',
  workEnd: '15:00',
  maxHourlyMinutesPerDay: 240,
};

beforeEach(() => {
  calls.length = 0;
  callerPerms = {};
});

describe('setApprovalOrderEnforced (FR-66)', () => {
  it('approval_steps edit flips it through the RPC, never a work_settings write', async () => {
    callerPerms = { people: 'read', approval_steps: 'edit' };
    expect(await setApprovalOrderEnforced(true)).toEqual({ ok: true });
    expect(calls).toEqual([{ kind: 'rpc', fn: 'app_set_approval_order_enforced', payload: { p_enforced: true } }]);
  });
  it('work_settings edit alone is refused before the database', async () => {
    callerPerms = { work_settings: 'edit', holidays: 'edit' };
    expect((await setApprovalOrderEnforced(true)).ok).toBe(false);
    expect(calls).toEqual([]);
  });
  it('approval_steps read is refused', async () => {
    callerPerms = { people: 'read', approval_steps: 'read' };
    expect((await setApprovalOrderEnforced(false)).ok).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe('updateWorkSettings', () => {
  it('work_settings edit saves, and the upsert never carries the order switch or hours per day', async () => {
    callerPerms = { work_settings: 'edit' };
    expect(await updateWorkSettings(WORK)).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    const payload = calls[0].payload as Record<string, unknown>;
    expect(calls[0]).toMatchObject({ kind: 'upsert', table: 'work_settings' });
    expect(payload).not.toHaveProperty('approval_order_enforced');
    expect(payload).not.toHaveProperty('hours_per_day');
  });
  it('work_settings read is refused', async () => {
    callerPerms = { work_settings: 'read', approval_steps: 'edit' };
    expect((await updateWorkSettings(WORK)).ok).toBe(false);
    expect(calls).toEqual([]);
  });
});
