'use server';

import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/types';

type DayPart = Database['public']['Enums']['day_part'];

// ---------------------------------------------------------------------------
// Internal: fetch caller context
// ---------------------------------------------------------------------------

async function getCallerContext() {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { supabase, user: null, roles: [] as string[], companyId: null };
  }

  const [{ data: rolesData }, { data: profile }] = await Promise.all([
    supabase.from('user_roles').select('role').eq('user_id', user.id),
    supabase.from('profiles').select('company_id').eq('id', user.id).single(),
  ]);

  const roles = (rolesData ?? []).map((r) => r.role as string);
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
      weekendDays: ws?.weekend_days ?? [5, 6], // default Fri+Sat for Iran
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
