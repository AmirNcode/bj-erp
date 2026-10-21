'use server';

/**
 * Approving and rejecting requests through the approval chain (FR-14, FR-36),
 * and the queue of requests the caller can sign right now.
 */

import { requireCaller } from '@/lib/auth/context';
import { dbErr, type DbErrorResult } from '@/lib/errors/db-error';
import { invalidateAppCache } from '@/lib/cache/invalidate-app';
import type { Database } from '@/lib/supabase/types';
import type { ApprovalStep, ManagerScope, SignedStep, StepLabel, StepRole } from '@/lib/leave/approvals';
import { approvalBundle, approvalChoices, progressLabel, type ApprovalChoice, type ApprovalContextRow, type ApprovalProgressRow } from '@/lib/leave/approval-context';
import { perDiemProblem, signatureProblem } from '@/lib/leave/signature';
import type { TravellerField } from '@/lib/travel/fields';
import type { DayPart } from './shared';

/** `warning`: the decision is saved but a follow-up step (FR-70 travel tick) was not. */
export type DecisionResult = { ok: true; warning?: string } | DbErrorResult;

export type ApproveRequestInput = {
  signatureData: string;
  signatureAuthorized: boolean;
  /** FR-71: every step this one signature approves (own and delegated). */
  stepIds?: string[];
  /** FR-58: admin only — sign every outstanding step at once. */
  override?: boolean;
  /** FR-61: per diem in Rials, only with an hr step on an errand. */
  perDiemRials?: number | null;
  /** FR-70: mark the daily errand «نیاز به رزرو سفر» once the approval is saved. */
  travelBooking?: boolean;
};

/**
 * Approve a pending request: sign the caller's steps with one signature (FR-71),
 * or — for an admin — every outstanding step at once (FR-58). The SQL fn decides entitlement, flips
 * the status atomically when the chain completes, and debits the ledger for
 * balance-affecting types.
 */
export async function approveRequest(
  requestId: string,
  input: ApproveRequestInput
): Promise<DecisionResult> {
  const c = await requireCaller();
  if (!c.ok) return c;
  const bad = signatureProblem(input) ?? perDiemProblem(input.perDiemRials);
  if (bad) return dbErr(bad);
  const perDiem = input.perDiemRials ?? null;

  const stepIds = input.stepIds ?? [];
  // FR-71: one signature for the caller's steps; the admin override and the
  // legacy no-chain request (no step ids) keep the single-call path.
  const { error } = !input.override && stepIds.length > 0
    ? await c.supabase.rpc('approve_leave_request_steps', {
      p_id: requestId,
      p_step_ids: stepIds,
      p_signature_data: input.signatureData,
      p_signature_authorized: input.signatureAuthorized,
      p_per_diem_rials: perDiem ?? undefined,
    })
    : await c.supabase.rpc('approve_leave_request_v2', {
      p_id: requestId,
      p_step_id: null,
      p_signature_data: input.signatureData,
      p_signature_authorized: input.signatureAuthorized,
      p_override: input.override ?? false,
      p_per_diem_rials: perDiem ?? undefined,
    });
  if (error) return dbErr(error.message);
  invalidateAppCache();
  if (input.travelBooking) {
    // A separate call after the signature is saved: the approval stands even if this
    // fails, and HR can tick it later from the Requests page.
    const { error: tickError } = await c.supabase.rpc('app_set_travel_booking', { p_request: requestId, p_on: true });
    if (tickError) return { ok: true, warning: (await dbErr('travel booking not saved')).error };
  }
  return { ok: true };
}

/**
 * Reject a pending request. Same guard as approve; writes no ledger row.
 * The optional note is stored on the request (visible to the employee) and in
 * the audit row. Blank input is sent as no note at all.
 */
export async function rejectRequest(
  requestId: string,
  reason?: string,
  stepId?: string | null
): Promise<DecisionResult> {
  const c = await requireCaller();
  if (!c.ok) return c;

  const note = reason?.trim() ? reason.trim().slice(0, 500) : undefined;

  const { error } = await c.supabase.rpc('reject_leave_request_v2', {
    p_id: requestId,
    p_step_id: stepId ?? null,
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
  /** FR-47: manager of the requester's department, and whether that step applies. */
  employee_department_manager_id: string | null;
  department_step_applies: boolean;
  signed: SignedStep[];
  /** Labels of the steps already approved — a department signature carries role `manager`. */
  approved: StepLabel[];
  outstanding: StepLabel[];
  /** FR-58: the step the caller signs in their own right, if any. */
  natural_step: StepLabel | null;
  /** FR-58: admin — may sign every outstanding step at once. */
  can_override: boolean;
  /** FR-61: whether signing the natural step / the override takes a per diem. */
  per_diem_natural: boolean;
  per_diem_override: boolean;
  /**
   * FR-70: a daily errand whose HR step (or override) may mark it «نیاز به رزرو سفر»,
   * with the traveller details still missing. Null when the box does not apply.
   */
  travel: { employeeId: string; missingFields: TravellerField[] } | null;
  decision_steps?: ApprovalChoice[];
  rejection_steps?: ApprovalChoice[];
  progress?: ApprovalProgressRow[];
  configuration_changed?: boolean;
  legacy_reconciliation_required?: boolean;
  can_reject?: boolean;
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
      .select('id, role, step_order, applies_to, active, approver_id, manager_scope')
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
      managerScope: (r.manager_scope ?? 'direct') as ManagerScope,
    })),
    orderEnforced: ws?.approval_order_enforced ?? false,
  };
}

/** Pending request context and exact decision entitlements projected by the database. */
export async function getPendingApprovals(): Promise<
  { ok: true; requests: PendingApproval[] } | DbErrorResult
> {
  const c = await requireCaller();
  if (!c.ok) return c;

  const { data, error } = await c.supabase.rpc('app_approval_queue', { p_status: 'pending' });
  if (error) return dbErr(error.message);
  const rows = (Array.isArray(data) ? data : []) as unknown as ApprovalContextRow[];
  const requests: PendingApproval[] = rows.map((row) => {
    const progress = row.progress ?? [];
    const choices = approvalBundle(progress);
    const rejections = approvalChoices(progress, 'reject');
    // Old no-chain requests still need their explicitly authorized legacy action.
    if (!progress.length && row.can_approve) choices.push({ stepId: null, stepRole: 'manager', label: 'manager', name: null, principalName: null, delegated: false, perDiem: false });
    return {
      id: row.id,
      kind: row.kind,
      errand_location: row.errand_location,
      employee_name: row.employee_name,
      employee_id: row.employee_id,
      employee_manager_id: row.employee_manager_id,
      department_id: row.department_id,
      department_name_fa: row.department_name_fa,
      department_name_en: row.department_name_en,
      submitted_at: row.created_at,
      leave_type_id: row.leave_type_id,
      affects_balance: row.affects_balance,
      leave_type_name_fa: row.leave_type_name_fa ?? '—',
      leave_type_name_en: row.leave_type_name_en,
      start_date: row.start_date, end_date: row.end_date, day_part: row.day_part,
      unit: row.unit, start_time: row.start_time, end_time: row.end_time,
      requested_minutes: row.requested_minutes,
      reason: row.reason,
      replacement_name: row.replacement_name,
      replacement_conflict: row.replacement_conflict,
      serial_year: row.serial_year, serial_seq: row.serial_seq,
      signature_consent_at: row.signature_consent_at,
      employee_department_manager_id: row.employee_department_manager_id,
      department_step_applies: progress.some((step) => progressLabel(step) === 'departmentManager'),
      signed: progress.filter((step) => step.decision).map((step) => ({ stepId: step.step_id, stepRole: step.step_role, decision: step.decision as 'approved' | 'rejected' })),
      approved: progress.filter((step) => step.decision === 'approved').map(progressLabel),
      outstanding: progress.filter((step) => !step.decision && step.evidence_kind !== 'hr_exempt').map(progressLabel),
      natural_step: choices[0]?.label ?? null,
      can_override: row.can_override === true,
      per_diem_natural: choices.some((step) => step.perDiem),
      per_diem_override: row.can_override === true && row.kind === 'errand' && progress.some((step) => step.step_role === 'hr' && !step.decision && step.evidence_kind !== 'hr_exempt'),
      travel: null,
      decision_steps: choices,
      rejection_steps: rejections,
      progress,
      configuration_changed: row.configuration_changed,
      legacy_reconciliation_required: row.legacy_reconciliation_required,
      can_reject: row.can_reject === true || rejections.length > 0,
    };
  });
  // Like main: only what the caller can act on now. A later step waiting on an earlier one
  // (approval order enforced) stays out of the queue and badge, even though SQL lets it reject.
  const actionable = requests.filter((r) => r.can_override || !!r.decision_steps?.length);
  // FR-70: daily errands at an hr step get the travel-booking box and its missing-details hint.
  await Promise.all(actionable.map(async (r) => {
    const hrStep = r.per_diem_override || !!r.decision_steps?.some((step) => step.perDiem);
    if (r.kind !== 'errand' || r.unit !== 'day' || !hrStep) return;
    const { data, error: missingError } = await c.supabase.rpc('app_travel_missing_fields', { p_request: r.id });
    if (missingError) return;
    r.travel = { employeeId: r.employee_id, missingFields: (data ?? []) as TravellerField[] };
  }));
  return { ok: true, requests: actionable };
}

/**
 * Ids of the caller's current queue, for the new-requests banner's poll. Same
 * scoping as getPendingApprovals, so the banner never counts a request the
 * queue would not show.
 */
export async function getPendingApprovalIds(): Promise<
  { ok: true; ids: string[] } | DbErrorResult
> {
  const res = await getPendingApprovals();
  if (!res.ok) return res;
  return { ok: true, ids: res.requests.map((r) => r.id) };
}
