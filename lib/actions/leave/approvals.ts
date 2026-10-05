'use server';

/**
 * Approving and rejecting requests through the approval chain (FR-14, FR-36),
 * and the queue of requests the caller can sign right now.
 */

import { requireCaller } from '@/lib/auth/context';
import { dbErr } from '@/lib/errors/db-error';
import { invalidateAppCache } from '@/lib/cache/invalidate-app';
import type { Database } from '@/lib/supabase/types';
import {
  filterApprovable,
  outstandingSteps,
  type ApprovalStep,
  type SignedStep,
  type StepRole,
} from '@/lib/leave/approvals';
import { leavePeriodsOverlap } from '@/lib/leave/hourly';
import { isValidSignatureData } from '@/lib/leave/signature';
import type { DayPart } from './shared';

export type DecisionResult = { ok: true } | { ok: false; error: string };

export type ApproveRequestInput = {
  signatureData: string;
  signatureAuthorized: boolean;
};

/**
 * Approve a pending request. The SQL fn enforces is_manager_of(employee)||admin,
 * flips the status atomically, and debits the ledger for balance-affecting types.
 */
export async function approveRequest(
  requestId: string,
  input: ApproveRequestInput
): Promise<DecisionResult> {
  const c = await requireCaller();
  if (!c.ok) return c;
  if (!input.signatureAuthorized) return dbErr('signature authorization is required');
  if (!input.signatureData) return dbErr('signature is required');
  if (!isValidSignatureData(input.signatureData)) return dbErr('signature data is invalid');

  const { error } = await c.supabase.rpc('approve_leave_request', {
    p_id: requestId,
    p_signature_data: input.signatureData,
    p_signature_authorized: input.signatureAuthorized,
  });
  if (error) return dbErr(error.message);
  invalidateAppCache();
  return { ok: true };
}

/**
 * Reject a pending request. Same guard as approve; writes no ledger row.
 * The optional note is stored on the request (visible to the employee) and in
 * the audit row. Blank input is sent as no note at all.
 */
export async function rejectRequest(
  requestId: string,
  reason?: string
): Promise<DecisionResult> {
  const c = await requireCaller();
  if (!c.ok) return c;

  const note = reason?.trim() ? reason.trim().slice(0, 500) : undefined;

  const { error } = await c.supabase.rpc('reject_leave_request', {
    p_id: requestId,
    p_reason: note,
  });
  if (error) return dbErr(error.message);
  invalidateAppCache();
  return { ok: true };
}

export type PendingApproval = {
  id: string;
  /** 'errand' rows are work trips (BJ-F 50207) — no type, no balance effect. */
  kind: Database['public']['Enums']['request_kind'];
  /** محل ماموریت — the manager deciding an errand needs to see where. */
  errand_location: string | null;
  employee_name: string;
  employee_manager_id: string | null;
  /** Requester's department — the home dashboard's short-staffed warning. */
  department_id: string | null;
  department_name_fa: string | null;
  department_name_en: string | null;
  /** When it was submitted (the home dashboard's "oldest: n days ago"). */
  submitted_at: string;
  leave_type_id: string | null;
  /** False for unpaid types and errands: approving moves no balance. */
  affects_balance: boolean;
  leave_type_name_fa: string;
  leave_type_name_en: string | null;
  start_date: string;
  end_date: string;
  day_part: DayPart;
  unit: Database['public']['Enums']['leave_unit'];
  start_time: string | null;
  end_time: string | null;
  requested_minutes: number;
  reason: string | null;
  replacement_name: string | null;
  /** True when the named cover has leave overlapping this request (spec §2.1). */
  replacement_conflict: boolean;
  serial_year: number;
  serial_seq: number;
  signature_consent_at: string | null;
  /** FR-36: who has signed so far, and who is still needed. */
  employee_id: string;
  signed: SignedStep[];
  outstanding: StepRole[];
};

/**
 * The company's approval chain and whether its order binds (FR-36).
 *
 * Read through `approval_steps`' own SELECT policy, which admits any active
 * user — the requester is shown the chain's progress too, so this is not
 * privileged data.
 */
export async function getApprovalConfig(): Promise<{
  steps: ApprovalStep[];
  orderEnforced: boolean;
}> {
  const c = await requireCaller({ company: true });
  if (!c.ok) return { steps: [], orderEnforced: false };

  const [{ data: steps }, { data: ws }] = await Promise.all([
    c.supabase
      .from('approval_steps')
      .select('id, role, step_order, applies_to, active, approver_id')
      .eq('company_id', c.companyId)
      .order('step_order'),
    c.supabase
      .from('work_settings')
      .select('approval_order_enforced')
      .eq('company_id', c.companyId)
      .maybeSingle(),
  ]);

  return {
    steps: (steps ?? []).map((r) => ({
      id: r.id,
      role: r.role as StepRole,
      stepOrder: r.step_order,
      appliesTo: (r.applies_to ?? []) as ('leave' | 'errand')[],
      active: r.active,
      approverId: r.approver_id ?? null,
    })),
    orderEnforced: ws?.approval_order_enforced ?? false,
  };
}

/**
 * Pending requests the caller may act on **right now** (FR-36).
 *
 * Since the chain, this is no longer "admin → all, manager → own reports": an
 * HR user has no reports at all, and a manager who has already signed should
 * stop seeing the request. `fillableStep` decides, mirroring the SQL, which
 * re-checks on write.
 */
export async function getPendingApprovals(): Promise<
  { ok: true; requests: PendingApproval[] } | { ok: false; error: string }
> {
  const c = await requireCaller();
  if (!c.ok) return c;

  const { data, error } = await c.supabase
    .from('leave_requests')
    .select(
      `id, employee_id, kind, errand_location, created_at, leave_type_id, start_date, end_date, day_part, unit, start_time, end_time, requested_minutes, serial_year, serial_seq, reason, replacement_id, signature_consent_at,
       replacement:profiles!leave_requests_replacement_id_fkey(full_name),
       profiles!leave_requests_employee_id_fkey(full_name, manager_id, department_id, departments!profiles_department_id_fkey(name_fa, name_en)),
       leave_types(name_fa, name_en, affects_balance)`
    )
    .eq('status', 'pending')
    .order('start_date', { ascending: true });

  if (error) return dbErr(error.message);

  type Row = {
    id: string;
    employee_id: string;
    kind: Database['public']['Enums']['request_kind'];
    errand_location: string | null;
    created_at: string;
    leave_type_id: string | null;
    start_date: string;
    end_date: string;
    day_part: DayPart;
    unit: Database['public']['Enums']['leave_unit'];
    start_time: string | null;
    end_time: string | null;
    requested_minutes: number;
    reason: string | null;
    replacement_id: string | null;
    replacement: { full_name: string } | null;
    serial_year: number;
    serial_seq: number;
    signature_consent_at: string | null;
    profiles: {
      full_name: string;
      manager_id: string | null;
      department_id: string | null;
      departments: { name_fa: string; name_en: string | null } | null;
    } | null;
    leave_types: { name_fa: string; name_en: string | null; affects_balance: boolean } | null;
  };

  const mapped: PendingApproval[] = ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    kind: r.kind ?? 'leave',
    errand_location: r.errand_location ?? null,
    employee_name: r.profiles?.full_name ?? '—',
    employee_manager_id: r.profiles?.manager_id ?? null,
    department_id: r.profiles?.department_id ?? null,
    department_name_fa: r.profiles?.departments?.name_fa ?? null,
    department_name_en: r.profiles?.departments?.name_en ?? null,
    submitted_at: r.created_at,
    leave_type_id: r.leave_type_id ?? null,
    affects_balance: r.kind !== 'errand' && (r.leave_types?.affects_balance ?? false),
    leave_type_name_fa: r.leave_types?.name_fa ?? '—',
    leave_type_name_en: r.leave_types?.name_en ?? null,
    start_date: r.start_date,
    end_date: r.end_date,
    day_part: r.day_part,
    unit: r.unit,
    start_time: r.start_time,
    end_time: r.end_time,
    requested_minutes: r.requested_minutes,
    reason: r.reason ?? null,
    replacement_name: r.replacement?.full_name ?? null,
    serial_year: r.serial_year,
    serial_seq: r.serial_seq,
    signature_consent_at: r.signature_consent_at ?? null,
    employee_id: r.employee_id,
    signed: [] as SignedStep[],
    outstanding: [] as StepRole[],
    // Filled below: a cover can book leave between submission and approval, and
    // the manager should see that before deciding (spec §2.1). approve_leave_request
    // also refuses it, so this is a heads-up rather than the guard.
    replacement_conflict: false,
  }));

  // Who has already signed each pending request. One query for the whole queue.
  const { steps, orderEnforced } = await getApprovalConfig();
  const ids = mapped.map((r) => r.id);
  if (ids.length > 0) {
    const { data: approvals } = await c.supabase
      .from('leave_request_approvals')
      .select('request_id, step_id, step_role, decision')
      .in('request_id', ids);
    const byRequest = new Map<string, SignedStep[]>();
    for (const a of approvals ?? []) {
      const list = byRequest.get(a.request_id) ?? [];
      list.push({
        stepId: a.step_id ?? null,
        stepRole: a.step_role as StepRole,
        decision: a.decision as 'approved' | 'rejected',
      });
      byRequest.set(a.request_id, list);
    }
    for (const r of mapped) {
      r.signed = byRequest.get(r.id) ?? [];
      r.outstanding = outstandingSteps(steps, r.signed, r.kind);
    }
  }

  const scoped = filterApprovable(mapped, c.user.id, c.roles, steps, orderEnforced);

  // One round-trip for the whole queue rather than per row.
  const withCover = ((data ?? []) as unknown as Row[]).filter((r) => r.replacement_id);
  if (withCover.length > 0) {
    const coverIds = [...new Set(withCover.map((r) => r.replacement_id as string))];
    const { data: coverLeave } = await c.supabase
      .from('leave_requests')
      .select('employee_id, start_date, end_date, unit, start_time, end_time')
      .in('employee_id', coverIds)
      .in('status', ['pending', 'approved']);

    for (const req of scoped) {
      const raw = withCover.find((r) => r.id === req.id);
      if (!raw?.replacement_id) continue;
      req.replacement_conflict = (coverLeave ?? []).some(
        (l) =>
          l.employee_id === raw.replacement_id &&
          leavePeriodsOverlap(
            {
              startDate: l.start_date,
              endDate: l.end_date,
              unit: l.unit,
              startTime: l.start_time,
              endTime: l.end_time,
            },
            {
              startDate: req.start_date,
              endDate: req.end_date,
              unit: req.unit,
              startTime: req.start_time,
              endTime: req.end_time,
            }
          )
      );
    }
  }

  return { ok: true, requests: scoped };
}
