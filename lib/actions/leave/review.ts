'use server';

/**
 * HR review and the printable paper form (FR-38). RLS is the authority for both:
 * `leave_requests_select` returns the full row to the requester, their direct
 * manager, security, admin and hr (migration 20260818140001), so neither
 * function re-implements visibility.
 */

import { requireCaller } from '@/lib/auth/context';
import { dbErr, type DbErrorResult } from '@/lib/errors/db-error';
import type { Database } from '@/lib/supabase/types';
import type { StepRole } from '@/lib/leave/approvals';
import type { ApprovalContextRow, ApprovalSignatures, ApprovalEvidenceKind } from '@/lib/leave/approval-context';
import type { DayPart } from './shared';

export type ReviewRequestRow = {
  id: string;
  kind: Database['public']['Enums']['request_kind'];
  unit: Database['public']['Enums']['leave_unit'];
  status: Database['public']['Enums']['leave_status'];
  employee_name: string;
  personnel_no: string | null;
  department_name_fa: string | null;
  department_name_en: string | null;
  leave_type_name_fa: string | null;
  leave_type_name_en: string | null;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  day_part: DayPart;
  requested_minutes: number;
  serial_year: number;
  serial_seq: number;
  /** Timestamps only — the images stay lazy and are never listed. */
  signature_consent_at: string | null;
  approver_signature_consent_at: string | null;
  created_at: string;
};

/**
 * Every request the caller may read, newest first, for the HR review screen.
 *
 * Deliberately returns pending, approved, rejected AND cancelled: HR asked for
 * the first three, and silently dropping cancelled rows would make the screen
 * disagree with the employee's own list for no stated reason. The UI filters.
 */
export async function getReviewRequests(): Promise<
  { ok: true; requests: ReviewRequestRow[] } | DbErrorResult
> {
  const c = await requireCaller({ perm: ['leave_requests', 'read'] });
  if (!c.ok) return c;

  const { data, error } = await c.supabase
    .from('leave_requests')
    .select(
      `id, kind, unit, status, start_date, end_date, start_time, end_time, day_part,
       requested_minutes, serial_year, serial_seq, signature_consent_at,
       approver_signature_consent_at, created_at,
       profiles!leave_requests_employee_id_fkey(
         full_name, personnel_no,
         departments!profiles_department_id_fkey(name_fa, name_en)
       ),
       leave_types(name_fa, name_en)`
    )
    .order('created_at', { ascending: false });

  if (error) return dbErr(error.message);

  type Row = {
    id: string;
    kind: Database['public']['Enums']['request_kind'];
    unit: Database['public']['Enums']['leave_unit'];
    status: Database['public']['Enums']['leave_status'];
    start_date: string;
    end_date: string;
    start_time: string | null;
    end_time: string | null;
    day_part: DayPart;
    requested_minutes: number;
    serial_year: number;
    serial_seq: number;
    signature_consent_at: string | null;
    approver_signature_consent_at: string | null;
    created_at: string;
    profiles: {
      full_name: string;
      personnel_no: string | null;
      departments: { name_fa: string; name_en: string | null } | null;
    } | null;
    leave_types: { name_fa: string; name_en: string | null } | null;
  };

  return {
    ok: true,
    requests: ((data ?? []) as unknown as Row[]).map((r) => ({
      id: r.id,
      kind: r.kind ?? 'leave',
      unit: r.unit ?? 'day',
      status: r.status,
      employee_name: r.profiles?.full_name ?? '—',
      personnel_no: r.profiles?.personnel_no ?? null,
      department_name_fa: r.profiles?.departments?.name_fa ?? null,
      department_name_en: r.profiles?.departments?.name_en ?? null,
      leave_type_name_fa: r.leave_types?.name_fa ?? null,
      leave_type_name_en: r.leave_types?.name_en ?? null,
      start_date: r.start_date,
      end_date: r.end_date,
      start_time: r.start_time,
      end_time: r.end_time,
      day_part: r.day_part,
      requested_minutes: r.requested_minutes,
      serial_year: r.serial_year,
      serial_seq: r.serial_seq,
      signature_consent_at: r.signature_consent_at ?? null,
      approver_signature_consent_at: r.approver_signature_consent_at ?? null,
      created_at: r.created_at,
    })),
  };
}

export type PrintableRequest = ReviewRequestRow & {
  employee_code: string;
  job_title: string | null;
  reason: string | null;
  errand_location: string | null;
  /** FR-61 whole Rials; errands only. */
  per_diem_rials?: number | null;
  /** The Head of HR entered it on their own errand at submission. */
  per_diem_by_requester?: boolean;
  decision_note: string | null;
  replacement_name: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  unpaid_minutes: number;
  /** Both PNGs, eagerly loaded here because a printed page cannot lazy-load. */
  signature_data: string | null;
  approver_signature_data: string | null;
  /**
   * FR-36: one entry per signed step, so the printed sheet can put each
   * signature in its own box (تصویب کننده = manager, HR box = hr, …) instead of
   * assuming a single approver.
   */
  approvals: {
    stepRole: StepRole;
    /**
     * FR-47: the department manager's signature. It carries role `manager` like
     * the direct manager's, so only the step id tells them apart.
     */
    departmentStep: boolean;
    stepId?: string | null;
    stepOrder?: number;
    named?: boolean;
    expectedName?: string | null;
    evidenceKind?: ApprovalEvidenceKind;
    principalName?: string | null;
    authorityRef?: string | null;
    authorityStatement?: string | null;
    delegateName?: string | null;
    submittedAt?: string | null;
    responsibilityConsentAt?: string | null;
    decision: 'approved' | 'rejected' | null;
    approverName: string | null;
    signatureData: string | null;
    signatureConsentAt: string | null;
  }[];
  /**
   * The employee's CURRENT balance for this request's leave type, for BJ-F
   * 50210's "متقاضی دارای مرخصی استحقاقی بمدت … روز و … ساعت می باشد" line.
   * Null for errands, which have no leave type. This is the balance as of
   * printing, not as of the request — the screen says so.
   */
  current_balance_minutes: number | null;
};

/**
 * One request with everything the paper form prints.
 *
 * Unlike the list, this DOES pull both signature images: a print view has no
 * opportunity to fetch them on demand, and whoever can reach this row can
 * already open both images through the existing viewers.
 */
export async function getRequestForPrint(
  requestId: string
): Promise<{ ok: true; request: PrintableRequest } | DbErrorResult> {
  const c = await requireCaller();
  if (!c.ok) return c;

  const [context, signatures] = await Promise.all([
    c.supabase.rpc('app_request_approval_context', { p_id: requestId }),
    c.supabase.rpc('get_leave_request_signatures', { p_id: requestId }),
  ]);
  if (context.error) return dbErr(context.error.message);
  if (signatures.error) return dbErr(signatures.error.message);
  if (!context.data || !signatures.data) return dbErr('request not found');
  const row = context.data as unknown as ApprovalContextRow;
  const evidence = signatures.data as unknown as ApprovalSignatures;

  // Keep ledger visibility unchanged. No visible ledger row is not proof of zero balance.
  let currentBalance: number | null = null;
  if (row.leave_type_id) {
    const { data: ledger } = await c.supabase
      .from('leave_ledger')
      .select('balance_after_minutes, seq')
      .eq('employee_id', row.employee_id)
      .eq('leave_type_id', row.leave_type_id)
      .order('seq', { ascending: false })
      .limit(1);
    currentBalance = ledger?.[0]?.balance_after_minutes ?? null;
  }
  return {
    ok: true,
    request: {
      ...row,
      signature_data: evidence.requester_signature_data,
      approver_signature_data: evidence.approver_signature_data ?? null,
      approvals: evidence.approvals.filter((a) => a.decision || a.evidence_kind === 'hr_exempt').map((a) => ({
        stepId: a.step_id,
        stepOrder: a.step_order,
        named: a.named,
        expectedName: a.expected_name,
        stepRole: a.step_role,
        departmentStep: a.manager_scope === 'department' && !a.named,
        evidenceKind: a.evidence_kind,
        principalName: a.principal_name,
        authorityRef: a.authority_ref ?? a.grant_id,
        authorityStatement: a.statement ?? a.authority_statement
          ?? (typeof a.evidence?.statement === 'string' ? a.evidence.statement : null),
        delegateName: typeof a.evidence?.delegate_name === 'string' ? a.evidence.delegate_name : null,
        submittedAt: typeof a.evidence?.submitted_at === 'string' ? a.evidence.submitted_at : null,
        responsibilityConsentAt: typeof a.evidence?.consent_at === 'string' ? a.evidence.consent_at : null,
        decision: a.decision,
        approverName: a.signer_name,
        // Automatic and exempt steps can never display a person's signature.
        signatureData: ['automatic', 'hr_exempt'].includes(a.evidence_kind) ? null : a.signature_data ?? null,
        signatureConsentAt: a.signed_at,
      })),
      current_balance_minutes: currentBalance,
    },
  };
}
