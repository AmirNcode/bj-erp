'use server';

/**
 * A request's approval progress (FR-64): every step in order, who signed it and
 * when, and who it still waits on — so the requester can follow up. Read through
 * `public.request_approval_progress`, which answers only for a request the
 * caller may already read and returns names and times, never signatures.
 */

import { requireCaller } from '@/lib/auth/context';
import { dbErr } from '@/lib/errors/db-error';
import type { StepLabel } from '@/lib/leave/approvals';
import { progressLabel, type ApprovalContextRow, type ApprovalEvidenceKind } from '@/lib/leave/approval-context';

export type ProgressStep = {
  order: number;
  stepId: string | null;
  evidenceKind: ApprovalEvidenceKind;
  principalName: string | null;
  authorityRef: string | null;
  historicalHrExemption?: boolean;
  /** Role label, or `departmentManager`; a named step is labelled by its person. */
  label: StepLabel;
  named: boolean;
  /** Who the step waits on, when that is one person (manager, named approver). */
  expectedName: string | null;
  decision: 'approved' | 'rejected' | null;
  signerName: string | null;
  signedAt: string | null;
};

export async function getRequestProgress(
  requestId: string
): Promise<{ ok: true; steps: ProgressStep[]; automatic?: ApprovalContextRow['automatic_approval']; configurationChanged?: boolean; legacyReconciliationRequired?: boolean } | { ok: false; error: string }> {
  const c = await requireCaller();
  if (!c.ok) return c;

  const { data, error } = await c.supabase.rpc('app_request_approval_context', { p_id: requestId });
  if (error) return dbErr(error.message);

  const context = data as unknown as ApprovalContextRow;
  return {
    ok: true,
    automatic: context.automatic_approval,
    configurationChanged: context.configuration_changed,
    legacyReconciliationRequired: context.legacy_reconciliation_required,
    steps: context.progress.map((r) => ({
      stepId: r.step_id,
      evidenceKind: r.evidence_kind,
      principalName: r.principal_name,
      authorityRef: r.authority_ref ?? null,
      historicalHrExemption: !!r.historical_hr_exemption,
      order: r.step_order,
      label: progressLabel(r),
      named: r.named,
      expectedName: r.expected_name,
      decision: r.decision === 'approved' || r.decision === 'rejected' ? r.decision : null,
      signerName: r.signer_name,
      signedAt: r.signed_at,
    })),
  };
}
