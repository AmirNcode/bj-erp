import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getPendingApprovals } from '@/lib/actions/leave/approvals';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/auth/context', () => ({ requireCaller: async () => ({ ok: true, supabase: { rpc: mocks.rpc } }) }));
vi.mock('@/lib/cache/invalidate-app', () => ({ invalidateAppCache: vi.fn() }));
vi.mock('@/lib/errors/db-error', () => ({ dbErr: async (error: string) => ({ ok: false, error }) }));

const step = (over: Record<string, unknown>) => ({
  step_id: 'ceo-step', step_role: 'manager', step_order: 2, manager_scope: 'direct', evidence_kind: 'pending',
  can_approve: false, can_reject: false, decision: null, ...over,
});
const row = (id: string, progress: unknown[], over: Record<string, unknown> = {}) => ({
  id, kind: 'leave', employee_name: 'Employee', progress, can_override: false, can_approve: false, can_reject: false, ...over,
});

beforeEach(() => mocks.rpc.mockReset());

describe('approval queue order', () => {
  it('hides a later step that is still waiting on an earlier one, even when SQL allows rejecting it', async () => {
    mocks.rpc.mockResolvedValue({ data: [
      row('waiting', [step({ step_id: 'hr-step', step_role: 'hr', step_order: 1 }), step({ can_reject: true })], { can_reject: true }),
      row('ready', [step({ can_approve: true, can_reject: true })], { can_approve: true, can_reject: true }),
    ], error: null });
    const result = await getPendingApprovals();
    expect(result.ok && result.requests.map((r) => r.id)).toEqual(['ready']);
  });

  it('keeps admin override rows that have no step of their own', async () => {
    mocks.rpc.mockResolvedValue({ data: [row('override', [step({})], { can_override: true, can_reject: true })], error: null });
    const result = await getPendingApprovals();
    expect(result.ok && result.requests.map((r) => r.id)).toEqual(['override']);
  });
});
