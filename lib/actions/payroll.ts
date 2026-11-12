'use server';

/**
 * FR-92: unpaid leave per person for payroll. Reports read (the RPCs re-check it).
 */

import { getLocale } from 'next-intl/server';
import { requireCaller } from '@/lib/auth/context';
import { dbErr, type DbErrorResult } from '@/lib/errors/db-error';
import { isValidIsoDate } from '@/lib/leave/settings-validation';
import { formatCalendarDate } from '@/lib/leave/calendarMonth';
import { localizedLeaveTypeName } from '@/lib/i18n/format';
import {
  groupPayroll,
  type PayrollItem,
  type PayrollPerson,
  type PayrollSource,
} from '@/lib/reports/payroll';

export async function getPayrollReport(
  from: string,
  to: string
): Promise<{ ok: true; people: PayrollPerson[] } | DbErrorResult> {
  const c = await requireCaller({ perm: ['reports', 'read'] });
  if (!c.ok) return c;
  if (!isValidIsoDate(from) || !isValidIsoDate(to) || to < from) return dbErr('invalid date range');

  const { data, error } = await c.supabase.rpc('app_payroll_unpaid', { p_from: from, p_to: to });
  if (error) return dbErr(error.message);

  const locale = await getLocale();
  const name = (fa: string | null, en: string | null) =>
    fa ? localizedLeaveTypeName({ name_fa: fa, name_en: en }, locale) : '—';
  const items: PayrollItem[] = (data ?? []).map((r) => ({
    employeeId: r.employee_id,
    fullName: r.full_name,
    personnelNo: r.personnel_no,
    department: name(r.department_name_fa, r.department_name_en),
    source: r.source as PayrollSource,
    ref: r.ref,
    onDate: formatCalendarDate(r.on_date, locale),
    leaveType: name(r.leave_type_name_fa, r.leave_type_name_en),
    unpaidMinutes: r.unpaid_minutes,
  }));

  const ids = [...new Set(items.map((i) => i.employeeId))];
  const balances: Record<string, number | null> = {};
  if (ids.length > 0) {
    const totals = await c.supabase.rpc('app_employee_leave_totals', { p_ids: ids });
    if (totals.error) return dbErr(totals.error.message);
    for (const t of totals.data ?? []) balances[t.employee_id] = t.balance_minutes;
  }

  return { ok: true, people: groupPayroll(items, balances) };
}
