'use server';

/**
 * Leave balances, allocations and the accrual policy. Balances accrue lazily:
 * every read first posts any months the employee has earned (see shared.ts).
 *
 * Admin and hr both manage balances and policies (FR-43); the database also
 * refuses a non-admin doing it to their own record.
 */

import { requireCaller } from '@/lib/auth/context';
import { createClient } from '@/lib/supabase/server';
import { dbErr } from '@/lib/errors/db-error';
import { invalidateAppCache } from '@/lib/cache/invalidate-app';
import { latestBalances, type BalanceItem } from '@/lib/leave/balances';
import { todayInAppTz } from '@/lib/appDate';
import { accrueBeforeRead } from './shared';

/**
 * Returns the caller's current balance for a given leave_type.
 * Reads the latest leave_ledger row for (employee_id, leave_type_id).
 * Returns null if no ledger entry exists (e.g. no allocation yet).
 */
export async function getMyBalance(
  leaveTypeId: string
): Promise<{ ok: true; balanceMinutes: number | null } | { ok: false; error: string }> {
  const c = await requireCaller();
  if (!c.ok) return c;

  await accrueBeforeRead(c.supabase);

  const { data, error } = await c.supabase
    .from('leave_ledger')
    .select('balance_after_minutes')
    .eq('employee_id', c.user.id)
    .eq('leave_type_id', leaveTypeId)
    // seq, not created_at: accrual writes several rows per transaction and
    // created_at ties (migration 20260729130007).
    .order('seq', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return dbErr(error.message);

  return { ok: true, balanceMinutes: data?.balance_after_minutes ?? null };
}

export async function getMyBalances(): Promise<
  { ok: true; balances: BalanceItem[] } | { ok: false; error: string }
> {
  const c = await requireCaller({ company: true });
  if (!c.ok) return c;

  await accrueBeforeRead(c.supabase);

  const [{ data: types, error: typesError }, { data: ledger, error: ledgerError }] =
    await Promise.all([
      c.supabase
        .from('leave_types')
        .select('id, name_fa, name_en')
        .eq('company_id', c.companyId)
        .eq('active', true)
        .order('name_fa'),
      c.supabase
        .from('leave_ledger')
        .select('leave_type_id, balance_after_minutes, seq')
        .eq('employee_id', c.user.id),
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
  const c = await requireCaller({ anyOf: ['admin', 'hr'], company: true });
  if (!c.ok) return c;

  await accrueBeforeRead(c.supabase, employeeId);

  const [{ data: types, error: typesError }, { data: ledger, error: ledgerError }] =
    await Promise.all([
      c.supabase
        .from('leave_types')
        .select('id, name_fa, name_en')
        .eq('company_id', c.companyId)
        .eq('active', true)
        .eq('affects_balance', true)
        .order('name_fa'),
      c.supabase
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
  const c = await requireCaller({ anyOf: ['admin', 'hr'] });
  if (!c.ok) return c;

  const { error } = await c.supabase.rpc('allocate_leave', {
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
 * Sets an employee's current balance for a leave type to an absolute target.
 * The RPC writes an auditable adjustment ledger row and re-checks the caller's
 * authority server-side.
 */
export async function setLeaveBalance(
  employeeId: string,
  leaveTypeId: string,
  targetMinutes: number
): Promise<SetLeaveBalanceResult> {
  const c = await requireCaller({ anyOf: ['admin', 'hr'] });
  if (!c.ok) return c;

  const { error } = await c.supabase.rpc('set_leave_balance', {
    p_employee_id: employeeId,
    p_leave_type_id: leaveTypeId,
    p_target_minutes: targetMinutes,
  });

  if (error) return dbErr(error.message);

  invalidateAppCache();
  return { ok: true };
}

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
  const c = await requireCaller({ anyOf: ['admin', 'hr'] });
  if (!c.ok) return c;

  const { error } = await c.supabase.rpc('set_employee_leave_policy', {
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
  const c = await requireCaller({ anyOf: ['admin', 'hr'] });
  if (!c.ok) return c;

  const { data, error } = await c.supabase
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
  // FR-51: hr posts accruals too (accrue_all_leave checks accruals.run).
  const c = await requireCaller({ anyOf: ['admin', 'hr'] });
  if (!c.ok) return c;

  const { data, error } = await c.supabase.rpc('accrue_all_leave');
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
  const supabase = await createClient();
  const today = todayInAppTz();
  const { data } = await supabase
    .from('jalali_months')
    .select('gregorian_start')
    .lte('gregorian_start', today)
    .gte('gregorian_end', today)
    .maybeSingle();
  return data?.gregorian_start ?? today;
}
