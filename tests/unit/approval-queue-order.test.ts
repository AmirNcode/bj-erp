import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getPendingApprovals } from '@/lib/actions/leave/approvals';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), perms: {} as Record<string,string>, boxes: [] as { id: string; box_label: string | null }[] }));
vi.mock('@/lib/auth/context', () => ({ requireCaller: async () => ({ ok: true, perms: mocks.perms, supabase: {
  rpc: mocks.rpc,
  from: () => ({ select: () => ({ in: async () => ({ data: mocks.boxes, error: null }) }) }),
} }) }));
vi.mock('@/lib/cache/invalidate-app', () => ({ invalidateAppCache: vi.fn() }));
vi.mock('@/lib/errors/db-error', () => ({ dbErr: async (error: string) => ({ ok: false, error }) }));

const step = (over: Record<string, unknown>) => ({
  step_id: 'ceo-step', step_role: 'manager', step_order: 2, manager_scope: 'direct', evidence_kind: 'pending',
  can_approve: false, can_reject: false, decision: null, ...over,
});
const row = (id: string, progress: unknown[], over: Record<string, unknown> = {}) => ({
  id, kind: 'leave', employee_name: 'Employee', progress, can_override: false, can_approve: false, can_reject: false, ...over,
});

beforeEach(() => { mocks.rpc.mockReset(); mocks.perms = {}; mocks.boxes = []; });

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

  it("attaches each offered step's signature-box title for the dialogs", async () => {
    mocks.boxes = [{ id: 'ceo-step', box_label: ' اداری و منابع انسانی ' }];
    mocks.rpc.mockResolvedValue({ data: [row('ready', [step({ can_approve: true, can_reject: true })], { can_approve: true, can_reject: true })], error: null });
    const result = await getPendingApprovals();
    const r = result.ok ? result.requests[0] : null;
    expect(r?.decision_steps?.[0].boxLabel).toBe('اداری و منابع انسانی');
    expect(r?.rejection_steps?.[0].boxLabel).toBe('اداری و منابع انسانی');
  });
});

it('includes non-actionable rows only for authorized archive review, not badges', async () => {
 mocks.perms = { leave_requests: 'read' };
 mocks.rpc.mockResolvedValue({ data: [row('review-only', [step({})])], error: null });
 const reviewed = await getPendingApprovals(true);
 expect(reviewed.ok && reviewed.requests.map(r=>r.id)).toEqual(['review-only']);
 const badge = await getPendingApprovals();
 expect(badge.ok && badge.requests).toEqual([]);
 mocks.perms = {};
 const forbidden = await getPendingApprovals(true);
 expect(forbidden.ok && forbidden.requests).toEqual([]);
});
