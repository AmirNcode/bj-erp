'use server';

/**
 * HR review and the printable paper form (FR-38). RLS is the authority for both:
 * `leave_requests_select` returns the full row to the requester, their direct
 * manager, security, admin and hr (migration 20260818140001), so neither
 * function re-implements visibility.
 */

import { requireCaller } from '@/lib/auth/context';
import { dbErr } from '@/lib/errors/db-error';
import type { Database } from '@/lib/supabase/types';
import type { StepRole } from '@/lib/leave/approvals';
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
  { ok: true; requests: ReviewRequestRow[] } | { ok: false; error: string }
> {
  const c = await requireCaller();
  if (!c.ok) return c;
  if (!c.roles.includes('hr') && !c.roles.includes('admin')) {
    return dbErr('not allowed to review requests');
  }

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
    decision: 'approved' | 'rejected';
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
): Promise<{ ok: true; request: PrintableRequest } | { ok: false; error: string }> {
  const c = await requireCaller();
  if (!c.ok) return c;

  const { data, error } = await c.supabase
    .from('leave_requests')
    .select(
      `id, kind, unit, status, start_date, end_date, start_time, end_time, day_part,
       requested_minutes, unpaid_minutes, serial_year, serial_seq, reason, errand_location,
       decision_note, decided_at, signature_data, signature_consent_at,
       approver_signature_data, approver_signature_consent_at, created_at, leave_type_id,
       employee_id,
       profiles!leave_requests_employee_id_fkey(
         full_name, personnel_no, employee_code, job_title,
         departments!profiles_department_id_fkey(name_fa, name_en)
       ),
       replacement:profiles!leave_requests_replacement_id_fkey(full_name),
       decider:profiles!leave_requests_decided_by_fkey(full_name),
       leave_types(name_fa, name_en)`
    )
    .eq('id', requestId)
    .maybeSingle();

  if (error) return dbErr(error.message);
  // RLS turns "not allowed" into "no row", which is the behaviour we want: the
  // caller learns nothing about a request they may not read.
  if (!data) return dbErr('request not found');

  const row = data as unknown as {
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
    unpaid_minutes: number;
    serial_year: number;
    serial_seq: number;
    reason: string | null;
    errand_location: string | null;
    decision_note: string | null;
    decided_at: string | null;
    signature_data: string | null;
    signature_consent_at: string | null;
    approver_signature_data: string | null;
    approver_signature_consent_at: string | null;
    created_at: string;
    leave_type_id: string | null;
    employee_id: string;
    profiles: {
      full_name: string;
      personnel_no: string | null;
      employee_code: string;
      job_title: string | null;
      departments: { name_fa: string; name_en: string | null } | null;
    } | null;
    replacement: { full_name: string } | null;
    decider: { full_name: string } | null;
    leave_types: { name_fa: string; name_en: string | null } | null;
  };

  // Per-step signatures for the form's boxes. Same RLS as the request row.
  const { data: approvalRows } = await c.supabase
    .from('leave_request_approvals')
    .select(
      'step_role, decision, signature_data, signature_consent_at, approver:profiles!leave_request_approvals_approver_id_fkey(full_name)'
    )
    .eq('request_id', requestId);

  const approvals = ((approvalRows ?? []) as unknown as {
    step_role: string;
    decision: string;
    signature_data: string | null;
    signature_consent_at: string | null;
    approver: { full_name: string } | null;
  }[]).map((a) => ({
    stepRole: a.step_role as StepRole,
    decision: a.decision as 'approved' | 'rejected',
    approverName: a.approver?.full_name ?? null,
    signatureData: a.signature_data,
    signatureConsentAt: a.signature_consent_at,
  }));

  // The 50210 balance line. Read through the ledger's own RLS, so an HR user
  // gets it (can_read_all) and nobody else gains anything new.
  let currentBalance: number | null = null;
  if (row.leave_type_id) {
    const { data: ledger } = await c.supabase
      .from('leave_ledger')
      .select('balance_after_minutes, seq')
      .eq('employee_id', row.employee_id)
      .eq('leave_type_id', row.leave_type_id)
      .order('seq', { ascending: false })
      .limit(1);
    currentBalance = ledger?.[0]?.balance_after_minutes ?? 0;
  }

  return {
    ok: true,
    request: {
      id: row.id,
      kind: row.kind ?? 'leave',
      unit: row.unit ?? 'day',
      status: row.status,
      employee_name: row.profiles?.full_name ?? '—',
      personnel_no: row.profiles?.personnel_no ?? null,
      employee_code: row.profiles?.employee_code ?? '—',
      job_title: row.profiles?.job_title ?? null,
      department_name_fa: row.profiles?.departments?.name_fa ?? null,
      department_name_en: row.profiles?.departments?.name_en ?? null,
      leave_type_name_fa: row.leave_types?.name_fa ?? null,
      leave_type_name_en: row.leave_types?.name_en ?? null,
      start_date: row.start_date,
      end_date: row.end_date,
      start_time: row.start_time,
      end_time: row.end_time,
      day_part: row.day_part,
      requested_minutes: row.requested_minutes,
      unpaid_minutes: row.unpaid_minutes ?? 0,
      serial_year: row.serial_year,
      serial_seq: row.serial_seq,
      reason: row.reason ?? null,
      errand_location: row.errand_location ?? null,
      decision_note: row.decision_note ?? null,
      replacement_name: row.replacement?.full_name ?? null,
      decided_by_name: row.decider?.full_name ?? null,
      decided_at: row.decided_at ?? null,
      signature_data: row.signature_data ?? null,
      signature_consent_at: row.signature_consent_at ?? null,
      approver_signature_data: row.approver_signature_data ?? null,
      approver_signature_consent_at: row.approver_signature_consent_at ?? null,
      created_at: row.created_at,
      approvals,
      current_balance_minutes: currentBalance,
    },
  };
}
