'use server';

/**
 * FR-92: turning a negative annual balance into unpaid leave. The RPCs re-check
 * the caller (leave_balances edit or admin) and who they may manage; the gates
 * here only fail fast.
 */

import { getLocale } from 'next-intl/server';
import { requireCaller } from '@/lib/auth/context';
import { dbErr, type DbErrorResult } from '@/lib/errors/db-error';
import { invalidateAppCache } from '@/lib/cache/invalidate-app';
import { localizedLeaveTypeName } from '@/lib/i18n/format';

export type NegativeBalanceRow = {
  employeeId: string;
  fullName: string;
  personnelNo: string | null;
  departmentName: string;
  balanceMinutes: number;
};

/** Everyone the caller may convert whose annual balance is below zero. */
export async function getNegativeBalances(): Promise<
  { ok: true; rows: NegativeBalanceRow[] } | DbErrorResult
> {
  const c = await requireCaller({ perm: ['leave_balances', 'edit'] });
  if (!c.ok) return c;

  const { data, error } = await c.supabase.rpc('app_negative_balances');
  if (error) return dbErr(error.message);

  const locale = await getLocale();
  return {
    ok: true,
    rows: (data ?? []).map((r) => ({
      employeeId: r.employee_id,
      fullName: r.full_name,
      personnelNo: r.personnel_no,
      departmentName: r.department_name_fa
        ? localizedLeaveTypeName({ name_fa: r.department_name_fa, name_en: r.department_name_en }, locale)
        : '—',
      balanceMinutes: r.balance_minutes,
    })),
  };
}

/** Converts every listed person who is still negative; the rest are skipped. */
export async function convertNegatives(
  employeeIds: string[]
): Promise<{ ok: true; converted: number } | DbErrorResult> {
  const c = await requireCaller({ perm: ['leave_balances', 'edit'] });
  if (!c.ok) return c;
  if (employeeIds.length === 0) return { ok: true, converted: 0 };

  const { data, error } = await c.supabase.rpc('app_convert_negatives', {
    p_employee_ids: employeeIds,
  });
  if (error) return dbErr(error.message);

  invalidateAppCache();
  return { ok: true, converted: data ?? 0 };
}

/** Converts part (or all) of one person's negative balance. */
export async function convertNegative(
  employeeId: string,
  minutes: number,
  note: string
): Promise<{ ok: true; minutes: number } | DbErrorResult> {
  const c = await requireCaller({ perm: ['leave_balances', 'edit'] });
  if (!c.ok) return c;
  if (!Number.isSafeInteger(minutes) || minutes <= 0) return dbErr('amount must be more than 0');

  const { data, error } = await c.supabase.rpc('app_convert_negative', {
    p_employee_id: employeeId,
    p_minutes: minutes,
    p_note: note.trim() === '' ? null : note.trim(),
  });
  if (error) return dbErr(error.message);

  invalidateAppCache();
  return { ok: true, minutes: data };
}

/** Pending requests per leave type, for the warning on balance edits. */
export async function getPendingLeaveCounts(
  employeeId: string
): Promise<
  { ok: true; counts: Record<string, { count: number; minutes: number }> } | DbErrorResult
> {
  const c = await requireCaller({ perm: ['leave_balances', 'read'] });
  if (!c.ok) return c;

  const { data, error } = await c.supabase.rpc('app_pending_leave_counts', {
    p_employee_id: employeeId,
  });
  if (error) return dbErr(error.message);

  const counts: Record<string, { count: number; minutes: number }> = {};
  for (const r of data ?? []) {
    counts[r.leave_type_id] = { count: r.pending_count, minutes: r.pending_minutes };
  }
  return { ok: true, counts };
}
