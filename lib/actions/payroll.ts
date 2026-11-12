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
    serialYear: r.serial_year,
    serialSeq: r.serial_seq,
    balanceMinutes: r.balance_minutes,
    onDate: formatCalendarDate(r.on_date, locale),
    leaveType: name(r.leave_type_name_fa, r.leave_type_name_en),
    unpaidMinutes: r.unpaid_minutes,
  }));

  return { ok: true, people: groupPayroll(items) };
}
