'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getCachedUser, getCachedRoles, getCachedProfile } from '@/lib/auth/context';
import type { Database } from '@/lib/supabase/types';
import { filterApprovable } from '@/lib/leave/approvals';
import { latestBalances, type BalanceItem } from '@/lib/leave/balances';

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
};

export type SubmitRequestResult =
  | { ok: true; requestId: string }
  | { ok: false; error: string };

export async function submitRequest(
  input: SubmitRequestInput
): Promise<SubmitRequestResult> {
  const { supabase, user } = await getCallerContext();

  if (!user) return { ok: false, error: 'Not authenticated' };

  const { data, error } = await supabase.rpc('submit_leave_request', {
    p_leave_type_id: input.leaveTypeId,
    p_start: input.start,
    p_end: input.end,
    p_day_part: input.dayPart,
    p_reason: input.reason ?? null,
  });

  if (error) {
    // Surface the Postgres error message directly
    return { ok: false, error: error.message };
  }

  // Route-group `(app)` is not part of the URL; revalidate the real dynamic
  // route so all locale variants of /request are invalidated server-side.
  revalidatePath('/[locale]/request', 'page');

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

  if (!user) return { ok: false, error: 'Not authenticated' };

  const { error } = await supabase.rpc('cancel_leave_request', {
    p_id: requestId,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// allocateLeave (admin-only)
// ---------------------------------------------------------------------------

export type AllocateLeaveInput = {
  employeeId: string;
  leaveTypeId: string;
  periodStart: string; // YYYY-MM-DD Gregorian
  periodEnd: string;   // YYYY-MM-DD Gregorian
  days: number;
};

export type AllocateLeaveResult =
  | { ok: true }
  | { ok: false; error: string };

export async function allocateLeave(
  input: AllocateLeaveInput
): Promise<AllocateLeaveResult> {
  const { supabase, user, roles } = await getCallerContext();

  if (!user) return { ok: false, error: 'Not authenticated' };
  if (!roles.includes('admin')) return { ok: false, error: 'Admin role required' };

  const { error } = await supabase.rpc('allocate_leave', {
    p_employee_id: input.employeeId,
    p_leave_type_id: input.leaveTypeId,
    p_period_start: input.periodStart,
    p_period_end: input.periodEnd,
    p_days: input.days,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

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
  target: number
): Promise<SetLeaveBalanceResult> {
  const { supabase, user, roles } = await getCallerContext();

  if (!user) return { ok: false, error: 'Not authenticated' };
  if (!roles.includes('admin')) return { ok: false, error: 'Admin role required' };

  const { error } = await supabase.rpc('set_leave_balance', {
    p_employee_id: employeeId,
    p_leave_type_id: leaveTypeId,
    p_target: target,
  });

  if (error) return { ok: false, error: error.message };

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
  requested_days: number;
  status: Database['public']['Enums']['leave_status'];
  reason: string | null;
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
  if (!user) return { ok: false, error: 'Not authenticated' };

  const { data, error } = await supabase
    .from('leave_requests')
    .select(
      `id, start_date, end_date, day_part, requested_days, status, reason, created_at,
       leave_types(id, name_fa, name_en, color)`
    )
    .eq('employee_id', user.id)
    .order('created_at', { ascending: false });

  if (error) return { ok: false, error: error.message };

  return { ok: true, requests: (data ?? []) as unknown as LeaveRequestWithType[] };
}

/**
 * Returns the caller's current balance for a given leave_type.
 * Reads the latest leave_ledger row for (employee_id, leave_type_id).
 * Returns null if no ledger entry exists (e.g. no allocation yet).
 */
export async function getMyBalance(
  leaveTypeId: string
): Promise<{ ok: true; balance: number | null } | { ok: false; error: string }> {
  const { supabase, user } = await getCallerContext();
  if (!user) return { ok: false, error: 'Not authenticated' };

  const { data, error } = await supabase
    .from('leave_ledger')
    .select('balance_after')
    .eq('employee_id', user.id)
    .eq('leave_type_id', leaveTypeId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };

  return { ok: true, balance: data?.balance_after ?? null };
}

/**
 * Fetches active leave types for the caller's company.
 */
export type LeaveType = {
  id: string;
  name_fa: string;
  name_en: string | null;
  allow_half_day: boolean;
  affects_balance: boolean;
  color: string | null;
};

export async function getActiveLeaveTypes(): Promise<{
  ok: true;
  types: LeaveType[];
} | { ok: false; error: string }> {
  const { supabase, user, companyId } = await getCallerContext();
  if (!user) return { ok: false, error: 'Not authenticated' };
  if (!companyId) return { ok: false, error: 'Could not determine your company' };

  const { data, error } = await supabase
    .from('leave_types')
    .select('id, name_fa, name_en, allow_half_day, affects_balance, color')
    .eq('company_id', companyId)
    .eq('active', true)
    .order('name_fa');

  if (error) return { ok: false, error: error.message };

  return { ok: true, types: (data ?? []) as LeaveType[] };
}

/**
 * Fetches work settings (weekend_days) and holidays for the caller's company.
 * Used by the live preview to compute working days client-side.
 */
export type WorkSettings = {
  weekendDays: number[];
  holidays: string[]; // YYYY-MM-DD strings
};

export async function getWorkSettings(): Promise<{
  ok: true;
  settings: WorkSettings;
} | { ok: false; error: string }> {
  const { supabase, user, companyId } = await getCallerContext();
  if (!user) return { ok: false, error: 'Not authenticated' };
  if (!companyId) return { ok: false, error: 'Could not determine your company' };

  const [{ data: ws, error: wsError }, { data: hols, error: holsError }] = await Promise.all([
    supabase
      .from('work_settings')
      .select('weekend_days')
      .eq('company_id', companyId)
      .maybeSingle(),
    supabase
      .from('holidays')
      .select('holiday_date')
      .eq('company_id', companyId),
  ]);

  if (wsError) return { ok: false, error: wsError.message };
  if (holsError) return { ok: false, error: holsError.message };

  return {
    ok: true,
    settings: {
      weekendDays: ws?.weekend_days ?? [5], // default Fri only to match SQL compute_requested_days
      holidays: (hols ?? []).map((h) => h.holiday_date),
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
  if (!user) return { ok: false, error: 'Not authenticated' };
  if (!roles.includes('admin')) return { ok: false, error: 'Admin role required' };

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, employee_code')
    .eq('active', true)
    .order('full_name');

  if (error) return { ok: false, error: error.message };

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
  if (!user) return { ok: false, error: 'Not authenticated' };

  const { error } = await supabase.rpc('approve_leave_request', { p_id: requestId });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Reject a pending request. Same guard as approve; writes no ledger row.
 */
export async function rejectRequest(
  requestId: string,
  reason?: string
): Promise<DecisionResult> {
  const { supabase, user } = await getCallerContext();
  if (!user) return { ok: false, error: 'Not authenticated' };

  const { error } = await supabase.rpc('reject_leave_request', {
    p_id: requestId,
    p_reason: reason ?? undefined,
  });
  if (error) return { ok: false, error: error.message };
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
  requested_days: number;
  reason: string | null;
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
  if (!user) return { ok: false, error: 'Not authenticated' };

  const { data, error } = await supabase
    .from('leave_requests')
    .select(
      `id, employee_id, start_date, end_date, day_part, requested_days, reason,
       profiles!leave_requests_employee_id_fkey(full_name, manager_id),
       leave_types(name_fa, name_en)`
    )
    .eq('status', 'pending')
    .order('start_date', { ascending: true });

  if (error) return { ok: false, error: error.message };

  type Row = {
    id: string;
    start_date: string;
    end_date: string;
    day_part: DayPart;
    requested_days: number;
    reason: string | null;
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
    requested_days: r.requested_days,
    reason: r.reason ?? null,
  }));

  return {
    ok: true,
    requests: filterApprovable(mapped, user.id, roles.includes('admin')),
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
  employee_id: string;
  employee_name: string;
  leave_type_name_fa: string;
  leave_type_name_en: string | null;
  leave_type_color: string | null;
  start_date: string;
  end_date: string;
  day_part: DayPart;
  status: 'pending' | 'approved';
};

export async function getCalendarEntries(
  rangeStart: string,
  rangeEnd: string
): Promise<{ ok: true; entries: CalendarEntry[] } | { ok: false; error: string }> {
  const { supabase, user } = await getCallerContext();
  if (!user) return { ok: false, error: 'Not authenticated' };

  // Overlap test: an entry intersects [rangeStart, rangeEnd] when it starts on
  // or before rangeEnd AND ends on or after rangeStart.
  const { data, error } = await supabase
    .from('team_leave_calendar')
    .select(
      'id, employee_id, employee_name, leave_type_name_fa, leave_type_name_en, leave_type_color, start_date, end_date, day_part, status'
    )
    .lte('start_date', rangeEnd)
    .gte('end_date', rangeStart)
    .order('start_date', { ascending: true });

  if (error) return { ok: false, error: error.message };

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
  if (!user) return { ok: false, error: 'Not authenticated' };
  if (!companyId) return { ok: false, error: 'Could not determine your company' };

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
        .select('leave_type_id, balance_after, created_at')
        .eq('employee_id', user.id),
    ]);

  if (typesError) return { ok: false, error: typesError.message };
  if (ledgerError) return { ok: false, error: ledgerError.message };

  const byType = latestBalances(ledger ?? []);
  const balances: BalanceItem[] = (types ?? []).map((t) => ({
    leaveTypeId: t.id,
    name_fa: t.name_fa,
    name_en: t.name_en,
    balance: byType[t.id] ?? 0,
  }));

  return { ok: true, balances };
}

export async function getEmployeeBalances(
  employeeId: string
): Promise<{ ok: true; balances: BalanceItem[] } | { ok: false; error: string }> {
  const { supabase, user, roles, companyId } = await getCallerContext();
  if (!user) return { ok: false, error: 'Not authenticated' };
  if (!roles.includes('admin')) return { ok: false, error: 'Admin role required' };
  if (!companyId) return { ok: false, error: 'Could not determine your company' };

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
        .select('leave_type_id, balance_after, created_at')
        .eq('employee_id', employeeId),
    ]);

  if (typesError) return { ok: false, error: typesError.message };
  if (ledgerError) return { ok: false, error: ledgerError.message };

  const byType = latestBalances(ledger ?? []);
  const balances: BalanceItem[] = (types ?? []).map((t) => ({
    leaveTypeId: t.id,
    name_fa: t.name_fa,
    name_en: t.name_en,
    balance: byType[t.id] ?? 0,
  }));

  return { ok: true, balances };
}
