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

export type ProgressStep = {
  order: number;
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
): Promise<{ ok: true; steps: ProgressStep[] } | { ok: false; error: string }> {
  const c = await requireCaller();
  if (!c.ok) return c;

  const { data, error } = await c.supabase.rpc('request_approval_progress', { p_id: requestId });
  if (error) return dbErr(error.message);

  return {
    ok: true,
    steps: (data ?? []).map((r) => ({
      order: r.step_order,
      label:
        r.step_role === 'manager' && r.manager_scope === 'department'
          ? 'departmentManager'
          : (r.step_role as StepLabel),
      named: r.named,
      expectedName: r.expected_name,
      decision: r.decision === 'approved' || r.decision === 'rejected' ? r.decision : null,
      signerName: r.signer_name,
      signedAt: r.signed_at,
    })),
  };
}
