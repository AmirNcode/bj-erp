import { describe, it, expect } from 'vitest';
import { approvalBundle, type ApprovalProgressRow } from '@/lib/leave/approval-context';

const step = (id: string, order: number, extra: Partial<ApprovalProgressRow> = {}): ApprovalProgressRow => ({
  step_id: id, step_role: 'manager', step_order: order, manager_scope: 'direct', named: false,
  expected_name: null, signer_name: null, principal_name: null, signed_at: null, decision: null,
  evidence_kind: 'pending', grant_id: null, can_approve: false, can_reject: false, is_mine: false, ...extra,
});
const ids = (rows: ApprovalProgressRow[]) => approvalBundle(rows).map((c) => c.stepId);

describe('approvalBundle (FR-71)', () => {
  it('order not enforced: every step the caller can sign', () => {
    expect(ids([
      step('mgr', 1, { can_approve: true, is_mine: true }),
      step('named', 2),
      step('hr', 3, { can_approve: true, is_mine: true, step_role: 'hr' }),
    ])).toEqual(['mgr', 'hr']);
  });

  it('order enforced: own later step joins when only own steps come before it', () => {
    expect(ids([
      step('mgr', 1, { can_approve: true, is_mine: true }),
      step('hr', 2, { is_mine: true, step_role: 'hr' }),
      step('named', 3),
    ])).toEqual(['mgr', 'hr']);
  });

  it('order enforced: someone else in between stops the group', () => {
    expect(ids([
      step('mgr', 1, { can_approve: true, is_mine: true }),
      step('named', 2),
      step('hr', 3, { is_mine: true, step_role: 'hr' }),
    ])).toEqual(['mgr']);
  });

  it('skips decided and HR-exempt steps', () => {
    expect(ids([
      step('mgr', 1, { decision: 'approved' }),
      step('hr', 2, { evidence_kind: 'hr_exempt' }),
      step('ceo', 3, { can_approve: true, is_mine: true }),
      step('named', 4, { is_mine: true, is_delegated: true, principal_name: 'Pat' }),
    ])).toEqual(['ceo', 'named']);
  });

  it('nothing to sign now: empty, even with own steps later', () => {
    expect(ids([step('named', 1), step('hr', 2, { is_mine: true })])).toEqual([]);
  });

  it('keeps the step order whatever order the rows arrive in', () => {
    expect(ids([
      step('hr', 2, { is_mine: true }),
      step('mgr', 1, { can_approve: true, is_mine: true }),
    ])).toEqual(['mgr', 'hr']);
  });
});
