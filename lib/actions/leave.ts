'use server';

import { invalidateAppCache } from '@/lib/cache/invalidate-app';
import { createClient } from '@/lib/supabase/server';
import { getCachedUser, getCachedRoles, getCachedProfile } from '@/lib/auth/context';
import { dbErr } from '@/lib/errors/db-error';
import type { Database } from '@/lib/supabase/types';
import {
  filterApprovable,
  outstandingSteps,
  type ApprovalStep,
  type SignedStep,
  type StepRole,
} from '@/lib/leave/approvals';
import { latestBalances, type BalanceItem } from '@/lib/leave/balances';
import type { ReplacementCandidate } from '@/lib/leave/replacement';
import { leavePeriodsOverlap } from '@/lib/leave/hourly';
import { todayInAppTz } from '@/lib/appDate';
import { isValidSignatureData } from '@/lib/leave/signature';

type DayPart = Database['public']['Enums']['day_part'];

// ---------------------------------------------------------------------------
// Internal: fetch caller context
// ---------------------------------------------------------------------------

async function getCallerContext() {
  const supabase = await createClient();
  const user = await getCachedUser();

  if (!user) {
    return { supabase, user: null, roles: [] as string[], companyId: null };
  }

  const [roles, profile] = await Promise.all([
    getCachedRoles(user.id),
    getCachedProfile(user.id),
  ]);

  return {
    supabase,
    user,
    roles,
    companyId: profile?.company_id ?? null,
  };
}

// ---------------------------------------------------------------------------
// submitRequest
// ---------------------------------------------------------------------------

export type SubmitRequestInput = {
  leaveTypeId: string;
  start: string; // YYYY-MM-DD Gregorian
  end: string;   // YYYY-MM-DD Gregorian
  dayPart: DayPart;
  reason?: string;
  /** Optional cover; null/undefined is valid. */
  replacementId?: string | null;
  signatureData: string;
  signatureAuthorized: boolean;
};

export type SubmitRequestResult =
  | { ok: true; requestId: string }
  | { ok: false; error: string };

export async function submitRequest(
  input: SubmitRequestInput
): Promise<SubmitRequestResult> {
  const { supabase, user } = await getCallerContext();

  if (!user) return dbErr('not authenticated');
  if (!input.signatureAuthorized) return dbErr('signature authorization is required');
  if (!input.signatureData) return dbErr('signature is required');
  if (!isValidSignatureData(input.signatureData)) return dbErr('signature data is invalid');

  // Accrue first: a worker whose newly-earned day makes this request affordable
  // must not be refused by a stale balance.
  const accrualError = await accrueBeforeRead(supabase);
  if (accrualError) return dbErr(accrualError);

  const { data, error } = await supabase.rpc('submit_leave_request', {
    p_leave_type_id: input.leaveTypeId,
    p_start: input.start,
    p_end: input.end,
    p_day_part: input.dayPart,
    p_reason: input.reason ?? undefined,
    p_replacement_id: input.replacementId ?? undefined,
    p_signature_data: input.signatureData,
    p_signature_authorized: input.signatureAuthorized,
  });

  if (error) {
    // Known SQL-raised messages are translated; unknown ones become generic.
    return dbErr(error.message);
  }

  invalidateAppCache();
  return { ok: true, requestId: data as string };
}

// ---------------------------------------------------------------------------
// cancelRequest
// ---------------------------------------------------------------------------

export type CancelRequestResult =
  | { ok: true }
  | { ok: false; error: string };

export async function cancelRequest(
  requestId: string
): Promise<CancelRequestResult> {
  const { supabase, user } = await getCallerContext();

  if (!user) return dbErr('not authenticated');

  const { error } = await supabase.rpc('cancel_leave_request', {
    p_id: requestId,
  });

  if (error) {
    return dbErr(error.message);
  }

  invalidateAppCache();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// submitHourlyRequest (self) — مرخصی ساعتی, the BJ-F 50208 flow.
// ---------------------------------------------------------------------------

export type SubmitHourlyInput = {
  leaveTypeId: string;
  /** Optional cover; null/undefined is valid. */
  replacementId?: string | null;
  /** Gregorian YYYY-MM-DD — one date only. */
  date: string;
  /** 'HH:MM', company-local. */
  startTime: string;
  endTime: string;
  reason?: string;
  signatureData: string;
  signatureAuthorized: boolean;
};

export async function submitHourlyRequest(
  input: SubmitHourlyInput
): Promise<SubmitRequestResult> {
  const { supabase, user } = await getCallerContext();
  if (!user) return dbErr('not authenticated');
  if (!input.signatureAuthorized) return dbErr('signature authorization is required');
  if (!input.signatureData) return dbErr('signature is required');
  if (!isValidSignatureData(input.signatureData)) return dbErr('signature data is invalid');

  // Same reason as the daily path: a freshly-accrued hour must be spendable.
  const accrualError = await accrueBeforeRead(supabase);
  if (accrualError) return dbErr(accrualError);

  const { data, error } = await supabase.rpc('submit_hourly_leave_request', {
    p_leave_type_id: input.leaveTypeId,
    p_date: input.date,
    p_start_time: input.startTime,
    p_end_time: input.endTime,
    p_reason: input.reason ?? undefined,
    p_replacement_id: input.replacementId ?? undefined,
    p_signature_data: input.signatureData,
    p_signature_authorized: input.signatureAuthorized,
  });

  if (error) return dbErr(error.message);

  invalidateAppCache();
  return { ok: true, requestId: data as string };
}

// ---------------------------------------------------------------------------
// submitErrandRequest (self) — ماموریت ساعتی, the BJ-F 50207 flow.
// ---------------------------------------------------------------------------

export type SubmitErrandInput = {
  /** Gregorian YYYY-MM-DD — one date only. */
  date: string;
  /** 'HH:MM', company-local. */
  startTime: string;
  endTime: string;
  /** محل ماموریت — required. */
  location: string;
  /** شرح ماموریت — optional; stored in `reason`, which is FR-25-private. */
  description?: string;
  signatureData: string;
  signatureAuthorized: boolean;
};

export async function submitErrandRequest(
  input: SubmitErrandInput
): Promise<SubmitRequestResult> {
  const { supabase, user } = await getCallerContext();
  if (!user) return dbErr('not authenticated');
  if (!input.signatureAuthorized) return dbErr('signature authorization is required');
  if (!input.signatureData) return dbErr('signature is required');
  if (!isValidSignatureData(input.signatureData)) return dbErr('signature data is invalid');

  // No accrual pass here, unlike the two leave paths: an errand is work. It
  // spends no balance, so there is nothing a freshly-accrued hour could unlock.
  const { data, error } = await supabase.rpc('submit_errand_request', {
    p_date: input.date,
    p_start_time: input.startTime,
    p_end_time: input.endTime,
    p_location: input.location,
    p_description: input.description ?? undefined,
    p_signature_data: input.signatureData,
    p_signature_authorized: input.signatureAuthorized,
  });

  if (error) return dbErr(error.message);

  invalidateAppCache();
  return { ok: true, requestId: data as string };
}

// ---------------------------------------------------------------------------
// submitDailyErrandRequest (self) — full-day work errand / travel range.
// ---------------------------------------------------------------------------

export type SubmitDailyErrandInput = {
  /** Gregorian YYYY-MM-DD values; the UI displays Persian dates. */
  start: string;
  end: string;
  /** محل ماموریت — required. */
  location: string;
  /** شرح ماموریت — optional and FR-25-private. */
  description?: string;
  signatureData: string;
  signatureAuthorized: boolean;
};

export async function submitDailyErrandRequest(
  input: SubmitDailyErrandInput
): Promise<SubmitRequestResult> {
  const { supabase, user } = await getCallerContext();
  if (!user) return dbErr('not authenticated');
  if (!input.signatureAuthorized) return dbErr('signature authorization is required');
  if (!input.signatureData) return dbErr('signature is required');
  if (!isValidSignatureData(input.signatureData)) return dbErr('signature data is invalid');

  const { data, error } = await supabase.rpc('submit_daily_errand_request', {
    p_start: input.start,
    p_end: input.end,
    p_location: input.location,
    p_description: input.description ?? undefined,
    p_signature_data: input.signatureData,
    p_signature_authorized: input.signatureAuthorized,
  });

  if (error) return dbErr(error.message);

  invalidateAppCache();
  return { ok: true, requestId: data as string };
}

// ---------------------------------------------------------------------------
// Replacement / cover reads (spec §8)
// ---------------------------------------------------------------------------

export async function getReplacementCandidates(input: {
  start: string;
  end: string;
  unit?: 'day' | 'hour';
  startTime?: string | null;
  endTime?: string | null;
}): Promise<
  { ok: true; candidates: ReplacementCandidate[] } | { ok: false; error: string }
> {
  const { supabase, user } = await getCallerContext();
  if (!user) return dbErr('not authenticated');

  const { data, error } = await supabase.rpc('get_replacement_candidates', {
    p_start: input.start,
    p_end: input.end,
    p_unit: input.unit ?? 'day',
    p_start_time: input.startTime ?? undefined,
    p_end_time: input.endTime ?? undefined,
  });
  if (error) return dbErr(error.message);

  return {
    ok: true,
    candidates: (data ?? []).map((r) => ({
      profileId: r.profile_id,
      fullName: r.full_name,
      employeeCode: r.employee_code,
      unavailable: r.unavailable,
      unavailableReason: r.unavailable_reason,
    })),
  };
}

export type CoverDuty = {
  requestId: string;
  employeeName: string;
  startDate: string;
  endDate: string;
  unit: 'day' | 'hour';
  startTime: string | null;
  endTime: string | null;
};

/**
 * Requests the caller is named cover for, in a window.
 *
 * Two uses: the reverse-case WARNING on the request screens (spec §2.1 — being
 * someone's cover never blocks your own leave), and the "you are covering X" card
 * on Home (D15 — the named person should never be surprised).
 */
export async function getMyCoverDuties(
  start: string,
  end: string
): Promise<{ ok: true; duties: CoverDuty[] } | { ok: false; error: string }> {
  const { supabase, user } = await getCallerContext();
  if (!user) return dbErr('not authenticated');

  const { data, error } = await supabase.rpc('get_my_cover_conflicts', {
    p_start: start,
    p_end: end,
  });
  if (error) return dbErr(error.message);

  return {
    ok: true,
    duties: (data ?? []).map((r) => ({
      requestId: r.request_id,
      employeeName: r.employee_name,
      startDate: r.start_date,
      endDate: r.end_date,
      unit: r.unit,
      startTime: r.start_time,
      endTime: r.end_time,
    })),
  };
}

// ---------------------------------------------------------------------------
// allocateLeave (admin-only)
// ---------------------------------------------------------------------------

export type AllocateLeaveInput = {
  employeeId: string;
  leaveTypeId: string;
  periodStart: string; // YYYY-MM-DD Gregorian
  periodEnd: string;   // YYYY-MM-DD Gregorian
  /** Minutes, the stored unit. Convert day-denominated admin input with daysToMinutes. */
  minutes: number;
};

export type AllocateLeaveResult =
  | { ok: true }
  | { ok: false; error: string };

export async function allocateLeave(
  input: AllocateLeaveInput
): Promise<AllocateLeaveResult> {
  const { supabase, user, roles } = await getCallerContext();

  if (!user) return dbErr('not authenticated');
  if (!roles.includes('admin')) return dbErr('admin role required');

  const { error } = await supabase.rpc('allocate_leave', {
    p_employee_id: input.employeeId,
    p_leave_type_id: input.leaveTypeId,
    p_period_start: input.periodStart,
    p_period_end: input.periodEnd,
    p_minutes: input.minutes,
  });

  if (error) {
    return dbErr(error.message);
  }

  invalidateAppCache();
  return { ok: true };
}

export type SetLeaveBalanceResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Admin sets an employee's current balance for a leave type to an absolute
 * target. The RPC writes an auditable adjustment ledger row and re-checks admin
 * privileges server-side.
 */
export async function setLeaveBalance(
  employeeId: string,
  leaveTypeId: string,
  targetMinutes: number
): Promise<SetLeaveBalanceResult> {
  const { supabase, user, roles } = await getCallerContext();

  if (!user) return dbErr('not authenticated');
  if (!roles.includes('admin')) return dbErr('admin role required');

  const { error } = await supabase.rpc('set_leave_balance', {
    p_employee_id: employeeId,
    p_leave_type_id: leaveTypeId,
    p_target_minutes: targetMinutes,
  });

  if (error) return dbErr(error.message);

  invalidateAppCache();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

/**
 * Fetches the caller's own leave requests with leave_type joined.
 */
export type LeaveRequestWithType = {
  id: string;
  /** 'errand' rows are work trips (BJ-F 50207), not leave — they carry no type. */
  kind: Database['public']['Enums']['request_kind'];
  /** محل ماموریت. Set only on errands; never exposed to teammates. */
  errand_location: string | null;
  start_date: string;
  end_date: string;
  day_part: DayPart;
  unit: Database['public']['Enums']['leave_unit'];
  start_time: string | null;
  end_time: string | null;
  requested_minutes: number;
  /** Portion not covered by paid leave; finalized when approved. */
  unpaid_minutes: number;
  replacement_name: string | null;
  serial_year: number;
  serial_seq: number;
  status: Database['public']['Enums']['leave_status'];
  reason: string | null;
  /** Set by the decider on reject; the requester reads it on their own row. */
  decision_note: string | null;
  /** Database-recorded proof that this request carries a requester signature. */
  signature_consent_at: string | null;
  /** Database-recorded proof that an authorized approver signed the approval. */
  approver_signature_consent_at: string | null;
  created_at: string;
  leave_types: {
    id: string;
    name_fa: string;
    name_en: string | null;
    color: string | null;
  } | null;
};

export async function getMyLeaveRequests(): Promise<{
  ok: true;
  requests: LeaveRequestWithType[];
} | { ok: false; error: string }> {
  const { supabase, user } = await getCallerContext();
  if (!user) return dbErr('not authenticated');

  const { data, error } = await supabase
    .from('leave_requests')
    .select(
      `id, kind, errand_location, start_date, end_date, day_part, unit, start_time, end_time, requested_minutes, unpaid_minutes, serial_year, serial_seq, status, reason, decision_note, signature_consent_at, approver_signature_consent_at, created_at,
       replacement:profiles!leave_requests_replacement_id_fkey(full_name),
       leave_types(id, name_fa, name_en, color)`
    )
    .eq('employee_id', user.id)
    .order('created_at', { ascending: false });

  if (error) return dbErr(error.message);

  type Raw = Omit<LeaveRequestWithType, 'replacement_name'> & {
    replacement: { full_name: string } | null;
  };
  const requests: LeaveRequestWithType[] = ((data ?? []) as unknown as Raw[]).map((r) => ({
    ...r,
    replacement_name: r.replacement?.full_name ?? null,
  }));

  return { ok: true, requests };
}

/**
 * Post any months this employee has earned before a balance is read (spec §6.4).
 *
 * Accrual WRITES, so it cannot live in a view or an RLS select — it has to be an
 * RPC called first. Callers that only render a balance intentionally ignore a
 * returned error (a stale number is better than a blank page). Submit callers
 * propagate it, because silently continuing could reject leave that was just
 * earned. The next attempt is safe because accrual is idempotent.
 */
async function accrueBeforeRead(
  supabase: Awaited<ReturnType<typeof getCallerContext>>['supabase'],
  employeeId?: string
): Promise<string | null> {
  const { error } = employeeId
    ? await supabase.rpc('accrue_employee_leave', { p_employee_id: employeeId })
    : await supabase.rpc('accrue_my_leave');
  if (error) {
    console.error('[accrual] skipped:', error.message);
    return error.message;
  }
  return null;
}

/**
 * Returns the caller's current balance for a given leave_type.
 * Reads the latest leave_ledger row for (employee_id, leave_type_id).
 * Returns null if no ledger entry exists (e.g. no allocation yet).
 */
export async function getMyBalance(
  leaveTypeId: string
): Promise<{ ok: true; balanceMinutes: number | null } | { ok: false; error: string }> {
  const { supabase, user } = await getCallerContext();
  if (!user) return dbErr('not authenticated');

  await accrueBeforeRead(supabase);

  const { data, error } = await supabase
    .from('leave_ledger')
    .select('balance_after_minutes')
    .eq('employee_id', user.id)
    .eq('leave_type_id', leaveTypeId)
    // seq, not created_at: accrual writes several rows per transaction and
    // created_at ties (migration 20260729130007).
    .order('seq', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return dbErr(error.message);

  return { ok: true, balanceMinutes: data?.balance_after_minutes ?? null };
}

/**
 * Fetches active leave types for the caller's company.
 */
export type LeaveType = {
  id: string;
  name_fa: string;
  name_en: string | null;
  allow_half_day: boolean;
  /** Gates the hourly screen's type list; the SQL re-checks it on submit. */
  allow_hourly: boolean;
  affects_balance: boolean;
  is_paid: boolean;
  color: string | null;
};

export async function getActiveLeaveTypes(): Promise<{
  ok: true;
  types: LeaveType[];
} | { ok: false; error: string }> {
  const { supabase, user, companyId } = await getCallerContext();
  if (!user) return dbErr('not authenticated');
  if (!companyId) return dbErr('no profile for caller');

  const { data, error } = await supabase
    .from('leave_types')
    .select('id, name_fa, name_en, allow_half_day, allow_hourly, affects_balance, is_paid, color')
    .eq('company_id', companyId)
    .eq('active', true)
    .order('name_fa');

  if (error) return dbErr(error.message);

  return { ok: true, types: (data ?? []) as LeaveType[] };
}

/**
 * Fetches work settings (weekend_days) and holidays for the caller's company.
 * Used by the live preview to compute working days client-side.
 */
export type WorkSettings = {
  weekendDays: number[];
  /** FR-41: ISO weekdays off every OTHER week. Empty when unused. */
  biweeklyWeekendDays: number[];
  /** FR-41: a date whose week is an off week. Null when unused. */
  biweeklyAnchor: string | null;
  holidays: string[]; // YYYY-MM-DD strings
  /** What one day of leave means, in hours. Drives every days<->minutes render. */
  hoursPerDay: number;
  /** Company work-hours window; hourly requests must fall inside it (D8). */
  workStart: string;
  workEnd: string;
  /** Per-day cap on hourly leave, in minutes (D7). */
  maxHourlyMinutesPerDay: number;
};

export async function getWorkSettings(): Promise<{
  ok: true;
  settings: WorkSettings;
} | { ok: false; error: string }> {
  const { supabase, user, companyId } = await getCallerContext();
  if (!user) return dbErr('not authenticated');
  if (!companyId) return dbErr('no profile for caller');

  const [{ data: ws, error: wsError }, { data: hols, error: holsError }] = await Promise.all([
    supabase
      .from('work_settings')
      .select(
        'weekend_days, biweekly_weekend_days, biweekly_anchor, hours_per_day, work_start, work_end, max_hourly_minutes_per_day'
      )
      .eq('company_id', companyId)
      .maybeSingle(),
    supabase
      .from('holidays')
      .select('holiday_date')
      .eq('company_id', companyId),
  ]);

  if (wsError) return dbErr(wsError.message);
  if (holsError) return dbErr(holsError.message);

  return {
    ok: true,
    settings: {
      weekendDays: ws?.weekend_days ?? [5], // default Fri only to match SQL compute_requested_minutes
      biweeklyWeekendDays: ws?.biweekly_weekend_days ?? [],
      biweeklyAnchor: ws?.biweekly_anchor ?? null,
      holidays: (hols ?? []).map((h) => h.holiday_date),
      hoursPerDay: ws?.hours_per_day ?? 8, // matches the work_settings column default
      workStart: ws?.work_start ?? '07:00',
      workEnd: ws?.work_end ?? '15:00',
      maxHourlyMinutesPerDay: ws?.max_hourly_minutes_per_day ?? 240,
    },
  };
}

/**
 * Fetches all employees for admin use (allocation UI).
 */
export type EmployeeOption = {
  id: string;
  full_name: string;
  employee_code: string;
};

export async function getAllEmployees(): Promise<{
  ok: true;
  employees: EmployeeOption[];
} | { ok: false; error: string }> {
  const { supabase, user, roles } = await getCallerContext();
  if (!user) return dbErr('not authenticated');
  if (!roles.includes('admin')) return dbErr('admin role required');

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, employee_code')
    .eq('active', true)
    .order('full_name');

  if (error) return dbErr(error.message);

  return { ok: true, employees: (data ?? []) as EmployeeOption[] };
}

// ---------------------------------------------------------------------------
// Approval flow (manager-of direct report / admin override) — FR-14
// ---------------------------------------------------------------------------

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
  const { supabase, user } = await getCallerContext();
  if (!user) return dbErr('not authenticated');
  if (!input.signatureAuthorized) return dbErr('signature authorization is required');
  if (!input.signatureData) return dbErr('signature is required');
  if (!isValidSignatureData(input.signatureData)) return dbErr('signature data is invalid');

  const { error } = await supabase.rpc('approve_leave_request', {
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
  const { supabase, user } = await getCallerContext();
  if (!user) return dbErr('not authenticated');

  const note = reason?.trim() ? reason.trim().slice(0, 500) : undefined;

  const { error } = await supabase.rpc('reject_leave_request', {
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
  const { supabase, companyId } = await getCallerContext();
  if (!companyId) return { steps: [], orderEnforced: false };

  const [{ data: steps }, { data: ws }] = await Promise.all([
    supabase
      .from('approval_steps')
      .select('id, role, step_order, applies_to, active, approver_id')
      .eq('company_id', companyId)
      .order('step_order'),
    supabase
      .from('work_settings')
      .select('approval_order_enforced')
      .eq('company_id', companyId)
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
  const { supabase, user, roles } = await getCallerContext();
  if (!user) return dbErr('not authenticated');

  const { data, error } = await supabase
    .from('leave_requests')
    .select(
      `id, employee_id, kind, errand_location, start_date, end_date, day_part, unit, start_time, end_time, requested_minutes, serial_year, serial_seq, reason, replacement_id, signature_consent_at,
       replacement:profiles!leave_requests_replacement_id_fkey(full_name),
       profiles!leave_requests_employee_id_fkey(full_name, manager_id),
       leave_types(name_fa, name_en)`
    )
    .eq('status', 'pending')
    .order('start_date', { ascending: true });

  if (error) return dbErr(error.message);

  type Row = {
    id: string;
    employee_id: string;
    kind: Database['public']['Enums']['request_kind'];
    errand_location: string | null;
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
    profiles: { full_name: string; manager_id: string | null } | null;
    leave_types: { name_fa: string; name_en: string | null } | null;
  };

  const mapped: PendingApproval[] = ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    kind: r.kind ?? 'leave',
    errand_location: r.errand_location ?? null,
    employee_name: r.profiles?.full_name ?? '—',
    employee_manager_id: r.profiles?.manager_id ?? null,
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
    const { data: approvals } = await supabase
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

  const scoped = filterApprovable(mapped, user.id, roles, steps, orderEnforced);

  // One round-trip for the whole queue rather than per row.
  const withCover = ((data ?? []) as unknown as Row[]).filter((r) => r.replacement_id);
  if (withCover.length > 0) {
    const coverIds = [...new Set(withCover.map((r) => r.replacement_id as string))];
    const { data: coverLeave } = await supabase
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

// ---------------------------------------------------------------------------
// Requester signature — private base-row data, fetched only on demand.
// ---------------------------------------------------------------------------

export async function getRequestSignature(requestId: string): Promise<
  | { ok: true; signatureData: string; consentAt: string }
  | { ok: false; error: string }
> {
  const { supabase, user } = await getCallerContext();
  if (!user) return dbErr('not authenticated');

  const { data, error } = await supabase
    .from('leave_requests')
    .select('signature_data, signature_consent_at')
    .eq('id', requestId)
    .maybeSingle();

  if (error) return dbErr(error.message);
  if (
    !data?.signature_consent_at ||
    !isValidSignatureData(data.signature_data)
  ) {
    return dbErr('request signature not found');
  }

  return {
    ok: true,
    signatureData: data.signature_data,
    consentAt: data.signature_consent_at,
  };
}

/** Private approver evidence, with the same base-row RLS boundary as the request signature. */
export async function getApproverSignature(requestId: string): Promise<
  | { ok: true; signatureData: string; consentAt: string }
  | { ok: false; error: string }
> {
  const { supabase, user } = await getCallerContext();
  if (!user) return dbErr('not authenticated');

  const { data, error } = await supabase
    .from('leave_requests')
    .select('approver_signature_data, approver_signature_consent_at')
    .eq('id', requestId)
    .maybeSingle();

  if (error) return dbErr(error.message);
  if (
    !data?.approver_signature_consent_at ||
    !isValidSignatureData(data.approver_signature_data)
  ) {
    return dbErr('request signature not found');
  }

  return {
    ok: true,
    signatureData: data.approver_signature_data,
    consentAt: data.approver_signature_consent_at,
  };
}

export type VisibleSignatureConsent = {
  requestId: string;
  requesterConsentAt: string | null;
  approverConsentAt: string | null;
};

/**
 * Tiny calendar metadata query. RLS returns direct reports for managers and all
 * rows for security/admin; the PNG itself remains lazy and is never serialized
 * with the calendar page.
 */
export async function getVisibleSignatureConsents(
  rangeStart: string,
  rangeEnd: string
): Promise<
  | { ok: true; signatures: VisibleSignatureConsent[] }
  | { ok: false; error: string }
> {
  const { supabase, user, roles } = await getCallerContext();
  if (!user) return dbErr('not authenticated');
  if (!roles.some((role) => ['admin', 'manager', 'security'].includes(role))) {
    return { ok: true, signatures: [] };
  }

  const { data, error } = await supabase
    .from('leave_requests')
    .select('id, signature_consent_at, approver_signature_consent_at')
    .lte('start_date', rangeEnd)
    .gte('end_date', rangeStart)
    .in('status', ['pending', 'approved'])
    .not('signature_consent_at', 'is', null);

  if (error) return dbErr(error.message);

  return {
    ok: true,
    signatures: (data ?? []).map((row) => ({
      requestId: row.id,
      requesterConsentAt: row.signature_consent_at,
      approverConsentAt: row.approver_signature_consent_at,
    })),
  };
}

// ---------------------------------------------------------------------------
// Calendar — viewer-scoped time-off (FR-22). Reads the reason-less
// team_leave_calendar view, which scopes rows by the viewer automatically
// (own + same_team for employees; everyone for manager/security/admin).
// `reason` is never selected here.
// ---------------------------------------------------------------------------

export type CalendarEntry = {
  id: string;
  /**
   * 'errand' rows are work trips. `errand_location` is deliberately NOT here:
   * the view omits it, so teammates see that someone is out, not where (FR-25).
   */
  kind: Database['public']['Enums']['request_kind'];
  employee_id: string;
  employee_name: string;
  leave_type_name_fa: string;
  leave_type_name_en: string | null;
  leave_type_color: string | null;
  start_date: string;
  end_date: string;
  day_part: DayPart;
  unit: Database['public']['Enums']['leave_unit'];
  start_time: string | null;
  end_time: string | null;
  status: 'pending' | 'approved';
};

export async function getCalendarEntries(
  rangeStart: string,
  rangeEnd: string
): Promise<{ ok: true; entries: CalendarEntry[] } | { ok: false; error: string }> {
  const { supabase, user } = await getCallerContext();
  if (!user) return dbErr('not authenticated');

  // Overlap test: an entry intersects [rangeStart, rangeEnd] when it starts on
  // or before rangeEnd AND ends on or after rangeStart.
  const { data, error } = await supabase
    .from('team_leave_calendar')
    .select(
      'id, kind, employee_id, employee_name, leave_type_name_fa, leave_type_name_en, leave_type_color, start_date, end_date, day_part, unit, start_time, end_time, status'
    )
    .lte('start_date', rangeEnd)
    .gte('end_date', rangeStart)
    .order('start_date', { ascending: true });

  if (error) return dbErr(error.message);

  const entries: CalendarEntry[] = (data ?? []).map((r) => ({
    id: r.id ?? '',
    kind: r.kind ?? 'leave',
    employee_id: r.employee_id ?? '',
    employee_name: r.employee_name ?? '—',
    // An errand has no leave type, so the LEFT JOIN leaves these null.
    leave_type_name_fa: r.leave_type_name_fa ?? '—',
    leave_type_name_en: r.leave_type_name_en ?? null,
    leave_type_color: r.leave_type_color ?? null,
    start_date: r.start_date ?? '',
    end_date: r.end_date ?? '',
    day_part: (r.day_part ?? 'full') as DayPart,
    unit: (r.unit ?? 'day') as Database['public']['Enums']['leave_unit'],
    start_time: r.start_time ?? null,
    end_time: r.end_time ?? null,
    status: (r.status ?? 'pending') as 'pending' | 'approved',
  }));

  return { ok: true, entries };
}

// ---------------------------------------------------------------------------
// getMyBalances — current balance per active leave type for the caller (home board).
// ---------------------------------------------------------------------------

export async function getMyBalances(): Promise<
  { ok: true; balances: BalanceItem[] } | { ok: false; error: string }
> {
  const { supabase, user, companyId } = await getCallerContext();
  if (!user) return dbErr('not authenticated');
  if (!companyId) return dbErr('no profile for caller');

  await accrueBeforeRead(supabase);

  const [{ data: types, error: typesError }, { data: ledger, error: ledgerError }] =
    await Promise.all([
      supabase
        .from('leave_types')
        .select('id, name_fa, name_en')
        .eq('company_id', companyId)
        .eq('active', true)
        .order('name_fa'),
      supabase
        .from('leave_ledger')
        .select('leave_type_id, balance_after_minutes, seq')
        .eq('employee_id', user.id),
    ]);

  if (typesError) return dbErr(typesError.message);
  if (ledgerError) return dbErr(ledgerError.message);

  const byType = latestBalances(ledger ?? []);
  const balances: BalanceItem[] = (types ?? []).map((t) => ({
    leaveTypeId: t.id,
    name_fa: t.name_fa,
    name_en: t.name_en,
    balanceMinutes: byType[t.id] ?? 0,
  }));

  return { ok: true, balances };
}

export async function getEmployeeBalances(
  employeeId: string
): Promise<{ ok: true; balances: BalanceItem[] } | { ok: false; error: string }> {
  const { supabase, user, roles, companyId } = await getCallerContext();
  if (!user) return dbErr('not authenticated');
  if (!roles.includes('admin')) return dbErr('admin role required');
  if (!companyId) return dbErr('no profile for caller');

  await accrueBeforeRead(supabase, employeeId);

  const [{ data: types, error: typesError }, { data: ledger, error: ledgerError }] =
    await Promise.all([
      supabase
        .from('leave_types')
        .select('id, name_fa, name_en')
        .eq('company_id', companyId)
        .eq('active', true)
        .eq('affects_balance', true)
        .order('name_fa'),
      supabase
        .from('leave_ledger')
        .select('leave_type_id, balance_after_minutes, seq')
        .eq('employee_id', employeeId),
    ]);

  if (typesError) return dbErr(typesError.message);
  if (ledgerError) return dbErr(ledgerError.message);

  const byType = latestBalances(ledger ?? []);
  const balances: BalanceItem[] = (types ?? []).map((t) => ({
    leaveTypeId: t.id,
    name_fa: t.name_fa,
    name_en: t.name_en,
    balanceMinutes: byType[t.id] ?? 0,
  }));

  return { ok: true, balances };
}

// ---------------------------------------------------------------------------
// Accrual policy (admin) — spec §6.1. Inputs arrive in MINUTES; the forms convert
// their day-denominated fields at the boundary via lib/leave/duration.ts.
// ---------------------------------------------------------------------------

export type LeavePolicyInput = {
  employeeId: string;
  leaveTypeId: string;
  accrualMinutesPerMonth: number;
  annualCapMinutes: number | null;
  carryoverCapMinutes: number;
  /** Gregorian YYYY-MM-DD; must be a jalali_months.gregorian_start (the RPC checks). */
  accrualStartMonth: string;
};

export type LeavePolicyRow = {
  leaveTypeId: string;
  accrualMinutesPerMonth: number;
  annualCapMinutes: number | null;
  carryoverCapMinutes: number;
  accrualStartMonth: string;
};

export async function setEmployeeLeavePolicy(
  input: LeavePolicyInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase, user, roles } = await getCallerContext();
  if (!user) return dbErr('not authenticated');
  if (!roles.includes('admin')) return dbErr('admin role required');

  const { error } = await supabase.rpc('set_employee_leave_policy', {
    p_employee_id: input.employeeId,
    p_leave_type_id: input.leaveTypeId,
    p_accrual_minutes_per_month: input.accrualMinutesPerMonth,
    p_annual_cap_minutes: input.annualCapMinutes,
    p_carryover_cap_minutes: input.carryoverCapMinutes,
    p_accrual_start_month: input.accrualStartMonth,
  });
  if (error) return dbErr(error.message);

  invalidateAppCache();
  return { ok: true };
}

/** Existing policies for one employee, for pre-filling the edit form. */
export async function getEmployeePolicies(
  employeeId: string
): Promise<{ ok: true; policies: LeavePolicyRow[] } | { ok: false; error: string }> {
  const { supabase, user, roles } = await getCallerContext();
  if (!user) return dbErr('not authenticated');
  if (!roles.includes('admin')) return dbErr('admin role required');

  const { data, error } = await supabase
    .from('employee_leave_policies')
    .select(
      'leave_type_id, accrual_minutes_per_month, annual_cap_minutes, carryover_cap_minutes, accrual_start_month'
    )
    .eq('employee_id', employeeId);
  if (error) return dbErr(error.message);

  return {
    ok: true,
    policies: (data ?? []).map((r) => ({
      leaveTypeId: r.leave_type_id,
      accrualMinutesPerMonth: r.accrual_minutes_per_month,
      annualCapMinutes: r.annual_cap_minutes,
      carryoverCapMinutes: r.carryover_cap_minutes,
      accrualStartMonth: r.accrual_start_month,
    })),
  };
}

/** Admin "Post accruals now". Returns what actually happened, for the UI to show. */
export async function runAllAccruals(): Promise<
  { ok: true; employees: number; rowsPosted: number } | { ok: false; error: string }
> {
  const { supabase, user, roles } = await getCallerContext();
  if (!user) return dbErr('not authenticated');
  if (!roles.includes('admin')) return dbErr('admin role required');

  const { data, error } = await supabase.rpc('accrue_all_leave');
  if (error) return dbErr(error.message);

  const summary = (data ?? {}) as { employees?: number; rows_posted?: number };
  invalidateAppCache();
  return { ok: true, employees: summary.employees ?? 0, rowsPosted: summary.rows_posted ?? 0 };
}

/**
 * The Gregorian start of the Jalali month containing today — the sensible default
 * accrual start month, so switching accrual on never retroactively credits a year
 * of leave (spec §6, deployment note).
 */
export async function getCurrentJalaliMonthStart(): Promise<string> {
  const { supabase } = await getCallerContext();
  const today = todayInAppTz();
  const { data } = await supabase
    .from('jalali_months')
    .select('gregorian_start')
    .lte('gregorian_start', today)
    .gte('gregorian_end', today)
    .maybeSingle();
  return data?.gregorian_start ?? today;
}

// ---------------------------------------------------------------------------
// HR review + printable paper form (FR-38)
//
// RLS is the authority for BOTH of these. `leave_requests_select` returns the
// full base row to the requester, their direct manager, security, admin and hr
// (migration 20260818140001), so neither function re-implements visibility —
// they simply cannot read a row the caller is not entitled to.
// ---------------------------------------------------------------------------

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
  const { supabase, user, roles } = await getCallerContext();
  if (!user) return dbErr('not authenticated');
  if (!roles.includes('hr') && !roles.includes('admin')) {
    return dbErr('not allowed to review requests');
  }

  const { data, error } = await supabase
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
  const { supabase, user } = await getCallerContext();
  if (!user) return dbErr('not authenticated');

  const { data, error } = await supabase
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
  const { data: approvalRows } = await supabase
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
    const { data: ledger } = await supabase
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
