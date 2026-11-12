'use server';

import { requireCaller } from '@/lib/auth/context';
import { dbErr, type DbErrorResult } from '@/lib/errors/db-error';

export type EmployeeLeaveTotals = {
  /** Annual-leave balance; null when the person has no balance row. */
  balanceMinutes: number | null;
  /** Annual leave used this Jalali year. */
  usedMinutes: number;
  /** Unpaid time this year. */
  unpaidMinutes: number;
};

/** Balance / used / unpaid for the Employees list (FR-92); `people` read. */
export async function getEmployeeLeaveTotals(
  ids: string[]
): Promise<{ ok: true; totals: Record<string, EmployeeLeaveTotals> } | DbErrorResult> {
  const c = await requireCaller({ perm: ['people', 'read'] });
  if (!c.ok) return c;
  if (ids.length === 0) return { ok: true, totals: {} };
  const { data, error } = await c.supabase.rpc('app_employee_leave_totals', { p_ids: ids });
  if (error) return dbErr(error.message);
  const totals: Record<string, EmployeeLeaveTotals> = {};
  for (const r of data ?? []) {
    totals[r.employee_id] = {
      balanceMinutes: r.balance_minutes,
      usedMinutes: r.used_minutes,
      unpaidMinutes: r.unpaid_minutes,
    };
  }
  return { ok: true, totals };
}
