/**
 * FR-55 R3 action gates: each server action below asks requireCaller for one
 * permission. Allowed with it (the database is reached), refused without it
 * (nothing reaches the database). The database stays the boundary.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { can, type Level, type PermKey, type Perms } from '@/lib/permissions/catalog';

let callerPerms: Perms = {};
const touched: string[] = [];

/** Any query chain; awaiting it yields one row. Records the table or RPC it starts from. */
function chain(): unknown {
  const result = { data: [{ id: 'row' }], error: null };
  const p: unknown = new Proxy(() => {}, {
    get: (_t, prop) => (prop === 'then' ? (ok: (v: unknown) => void) => ok(result) : () => p),
  });
  return p;
}
const fakeSupabase = {
  from: (table: string) => {
    touched.push(table);
    return chain();
  },
  rpc: (fn: string) => {
    touched.push(fn);
    return chain();
  },
};

vi.mock('@/lib/auth/context', () => ({
  requireCaller: async ({ perm }: { perm?: [PermKey, Level] } = {}) => {
    if (perm && !can(callerPerms, perm[0], perm[1])) return { ok: false, error: 'notAllowed' };
    return { ok: true, supabase: fakeSupabase, user: { id: 'me' }, roles: [], perms: callerPerms, companyId: 'co' };
  },
}));
vi.mock('@/lib/cache/invalidate-app', () => ({ invalidateAppCache: vi.fn() }));
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }));

const { grantSpecialLeave, revokeSpecialLeave } = await import('@/lib/actions/specialLeave');
const { getApprovedAbsences } = await import('@/lib/actions/absences');
const { getFinanceApprovals } = await import('@/lib/actions/finance');
const { upsertHoliday, bulkUpsertHolidays, deleteHoliday } = await import('@/lib/actions/settings');

beforeEach(() => {
  callerPerms = {};
  touched.length = 0;
});

type Case = { name: string; run: () => Promise<{ ok: boolean }>; allowed: Perms; refused: Perms };

const CASES: Case[] = [
  {
    name: 'grantSpecialLeave: special_leave edit',
    run: () => grantSpecialLeave('emp', 'bereavement', 'father'),
    allowed: { people: 'read', leave_balances: 'read', special_leave: 'edit' },
    refused: { people: 'edit', leave_balances: 'edit' },
  },
  {
    name: 'revokeSpecialLeave: special_leave edit',
    run: () => revokeSpecialLeave('grant'),
    allowed: { people: 'read', leave_balances: 'read', special_leave: 'edit' },
    refused: { people: 'edit', leave_balances: 'edit' },
  },
  {
    name: 'getApprovedAbsences: absences read',
    run: () => getApprovedAbsences('2026-10-13'),
    allowed: { people: 'read', leave_requests: 'read', absences: 'read' },
    refused: { people: 'read', leave_requests: 'read' },
  },
  {
    name: 'getFinanceApprovals: finance read',
    run: () => getFinanceApprovals('2026-09-23', '2026-10-22'),
    allowed: { finance: 'read' },
    refused: { clearance: 'read' },
  },
  {
    name: 'upsertHoliday: holidays edit',
    run: () => upsertHoliday({ date: '2026-10-13', nameFa: 'تعطیل' }),
    allowed: { holidays: 'edit' },
    refused: { holidays: 'read', work_settings: 'edit' },
  },
  {
    name: 'bulkUpsertHolidays: holidays edit',
    run: () => bulkUpsertHolidays([{ date: '2026-10-13', nameFa: 'تعطیل' }]),
    allowed: { holidays: 'edit' },
    refused: { holidays: 'read', work_settings: 'edit' },
  },
  {
    name: 'deleteHoliday: holidays edit',
    run: () => deleteHoliday('h'),
    allowed: { holidays: 'edit' },
    refused: { holidays: 'read', work_settings: 'edit' },
  },
];

describe.each(CASES)('$name', ({ run, allowed, refused }) => {
  it('allowed with the permission', async () => {
    callerPerms = allowed;
    expect((await run()).ok).toBe(true);
    expect(touched.length).toBeGreaterThan(0);
  });
  it('refused without it, before the database', async () => {
    callerPerms = refused;
    expect((await run()).ok).toBe(false);
    expect(touched).toEqual([]);
  });
});
