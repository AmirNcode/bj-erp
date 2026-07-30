'use server';

import { invalidateAppCache } from '@/lib/cache/invalidate-app';
import { createClient } from '@/lib/supabase/server';
import { getCachedUser, getCachedRoles, getCachedProfile } from '@/lib/auth/context';
import { dbErr } from '@/lib/errors/db-error';
import type { Database } from '@/lib/supabase/types';
import { filterApprovable } from '@/lib/leave/approvals';
import { latestBalances, type BalanceItem } from '@/lib/leave/balances';
import type { ReplacementCandidate } from '@/lib/leave/replacement';
import { todayInAppTz } from '@/lib/appDate';

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
};

export type SubmitRequestResult =
  | { ok: true; requestId: string }
  | { ok: false; error: string };

export async function submitRequest(
  input: SubmitRequestInput
): Promise<SubmitRequestResult> {
  const { supabase, user } = await getCallerContext();

  if (!user) return dbErr('not authenticated');

  // Accrue first: a worker whose newly-earned day makes this request affordable
  // must not be refused by a stale balance.
  await accrueBeforeRead(supabase);

  const { data, error } = await supabase.rpc('submit_leave_request', {
    p_leave_type_id: input.leaveTypeId,
    p_start: input.start,
    p_end: input.end,
    p_day_part: input.dayPart,
    p_reason: input.reason ?? undefined,
    p_replacement_id: input.replacementId ?? undefined,
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
};

export async function submitHourlyRequest(
  input: SubmitHourlyInput
): Promise<SubmitRequestResult> {
  const { supabase, user } = await getCallerContext();
  if (!user) return dbErr('not authenticated');

  // Same reason as the daily path: a freshly-accrued hour must be spendable.
  await accrueBeforeRead(supabase);

  const { data, error } = await supabase.rpc('submit_hourly_leave_request', {
    p_leave_type_id: input.leaveTypeId,
    p_date: input.date,
    p_start_time: input.startTime,
    p_end_time: input.endTime,
    p_reason: input.reason ?? undefined,
    p_replacement_id: input.replacementId ?? undefined,
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
  start_date: string;
  end_date: string;
  day_part: DayPart;
  unit: Database['public']['Enums']['leave_unit'];
  start_time: string | null;
  end_time: string | null;
  requested_minutes: number;
  replacement_name: string | null;
  serial_year: number;
  serial_seq: number;
  status: Database['public']['Enums']['leave_status'];
  reason: string | null;
  /** Set by the decider on reject; the requester reads it on their own row. */
  decision_note: string | null;
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
      `id, start_date, end_date, day_part, unit, start_time, end_time, requested_minutes, serial_year, serial_seq, status, reason, decision_note, created_at,
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
 * RPC called first. Failures are logged and swallowed on purpose: a slightly
 * stale balance is a much better outcome than a blank page, and the next read
 * retries anyway because the work is idempotent.
 */
async function accrueBeforeRead(
  supabase: Awaited<ReturnType<typeof getCallerContext>>['supabase'],
  employeeId?: string
): Promise<void> {
  const { error } = employeeId
    ? await supabase.rpc('accrue_employee_leave', { p_employee_id: employeeId })
    : await supabase.rpc('accrue_my_leave');
  if (error) console.error('[accrual] skipped:', error.message);
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
    .select('id, name_fa, name_en, allow_half_day, allow_hourly, affects_balance, color')
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
      .select('weekend_days, hours_per_day, work_start, work_end, max_hourly_minutes_per_day')
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

/**
 * Approve a pending request. The SQL fn enforces is_manager_of(employee)||admin,
 * flips the status atomically, and debits the ledger for balance-affecting types.
 */
export async function approveRequest(requestId: string): Promise<DecisionResult> {
  const { supabase, user } = await getCallerContext();
  if (!user) return dbErr('not authenticated');

  const { error } = await supabase.rpc('approve_leave_request', { p_id: requestId });
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
};

/**
 * Pending requests the caller may act on: admin → all; manager → own reports.
 * RLS already scopes what is readable; filterApprovable narrows the queue to
 * what the caller can actually decide (the SQL fn re-checks on write).
 */
export async function getPendingApprovals(): Promise<
  { ok: true; requests: PendingApproval[] } | { ok: false; error: string }
> {
  const { supabase, user, roles } = await getCallerContext();
  if (!user) return dbErr('not authenticated');

  const { data, error } = await supabase
    .from('leave_requests')
    .select(
      `id, employee_id, start_date, end_date, day_part, unit, start_time, end_time, requested_minutes, serial_year, serial_seq, reason, replacement_id,
       replacement:profiles!leave_requests_replacement_id_fkey(full_name),
       profiles!leave_requests_employee_id_fkey(full_name, manager_id),
       leave_types(name_fa, name_en)`
    )
    .eq('status', 'pending')
    .order('start_date', { ascending: true });

  if (error) return dbErr(error.message);

  type Row = {
    id: string;
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
    profiles: { full_name: string; manager_id: string | null } | null;
    leave_types: { name_fa: string; name_en: string | null } | null;
  };

  const mapped: PendingApproval[] = ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
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
    // Filled below: a cover can book leave between submission and approval, and
    // the manager should see that before deciding (spec §2.1). approve_leave_request
    // also refuses it, so this is a heads-up rather than the guard.
    replacement_conflict: false,
  }));

  const scoped = filterApprovable(mapped, user.id, roles.includes('admin'));

  // One round-trip for the whole queue rather than per row.
  const withCover = ((data ?? []) as unknown as Row[]).filter((r) => r.replacement_id);
  if (withCover.length > 0) {
    const coverIds = [...new Set(withCover.map((r) => r.replacement_id as string))];
    const { data: coverLeave } = await supabase
      .from('leave_requests')
      .select('employee_id, start_date, end_date')
      .in('employee_id', coverIds)
      .in('status', ['pending', 'approved']);

    for (const req of scoped) {
      const raw = withCover.find((r) => r.id === req.id);
      if (!raw?.replacement_id) continue;
      req.replacement_conflict = (coverLeave ?? []).some(
        (l) =>
          l.employee_id === raw.replacement_id &&
          l.start_date <= req.end_date &&
          l.end_date >= req.start_date
      );
    }
  }

  return { ok: true, requests: scoped };
}

// ---------------------------------------------------------------------------
// Calendar — viewer-scoped time-off (FR-22). Reads the reason-less
// team_leave_calendar view, which scopes rows by the viewer automatically
// (own + same_team for employees; everyone for manager/security/admin).
// `reason` is never selected here.
// ---------------------------------------------------------------------------

export type CalendarEntry = {
  id: string;
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
      'id, employee_id, employee_name, leave_type_name_fa, leave_type_name_en, leave_type_color, start_date, end_date, day_part, unit, start_time, end_time, status'
    )
    .lte('start_date', rangeEnd)
    .gte('end_date', rangeStart)
    .order('start_date', { ascending: true });

  if (error) return dbErr(error.message);

  const entries: CalendarEntry[] = (data ?? []).map((r) => ({
    id: r.id ?? '',
    employee_id: r.employee_id ?? '',
    employee_name: r.employee_name ?? '—',
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
