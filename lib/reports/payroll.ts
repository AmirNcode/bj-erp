/**
 * Payroll report builders (FR-92): unpaid leave per person, for HR to pass to payroll.
 * Pure, no I/O and no i18n, so the whole Payroll section can move into its own module
 * later without untangling leave code.
 */

import { formatSerial } from '@/lib/leave/serial';
import { minutesToDecimalDays, type ReportTable } from '@/lib/reports/reports';

export type PayrollSource = 'unpaid_type' | 'unpaid_part' | 'conversion';

export type PayrollItem = {
  employeeId: string;
  fullName: string;
  personnelNo: string | null;
  department: string;
  source: PayrollSource;
  /** The request's tracking number parts; null for a conversion. */
  serialYear: number | null;
  serialSeq: number | null;
  /** The person's current annual balance (the same on each of their rows). */
  balanceMinutes: number | null;
  /** Already formatted for display (Jalali). */
  onDate: string;
  leaveType: string;
  unpaidMinutes: number;
};

export type PayrollPerson = {
  employeeId: string;
  fullName: string;
  personnelNo: string | null;
  department: string;
  unpaidMinutes: number;
  balanceMinutes: number | null;
  items: PayrollItem[];
};

/** One entry per employee, in order of first appearance; items keep their input order. */
export function groupPayroll(items: PayrollItem[]): PayrollPerson[] {
  const byId = new Map<string, PayrollPerson>();
  for (const item of items) {
    let person = byId.get(item.employeeId);
    if (!person) {
      person = {
        employeeId: item.employeeId,
        fullName: item.fullName,
        personnelNo: item.personnelNo,
        department: item.department,
        unpaidMinutes: 0,
        balanceMinutes: item.balanceMinutes,
        items: [],
      };
      byId.set(item.employeeId, person);
    }
    person.unpaidMinutes += item.unpaidMinutes;
    person.items.push(item);
  }
  return [...byId.values()];
}

/** One CSV row per item; amounts as decimal days so payroll can total them. */
export function payrollCsv(
  people: PayrollPerson[],
  labels: { columns: string[]; source: Record<PayrollSource, string> },
  minutesPerDay: number
): ReportTable {
  const hoursPerDay = minutesPerDay / 60;
  const rows: (string | number)[][] = [];
  for (const p of people) {
    for (const i of p.items) {
      rows.push([
        i.fullName,
        i.personnelNo ?? '',
        i.department,
        labels.source[i.source],
        i.serialYear !== null && i.serialSeq !== null ? formatSerial(i.serialYear, i.serialSeq) : '',
        i.onDate,
        i.leaveType,
        minutesToDecimalDays(i.unpaidMinutes, hoursPerDay),
        p.balanceMinutes === null ? '' : minutesToDecimalDays(p.balanceMinutes, hoursPerDay),
      ]);
    }
  }
  return { columns: labels.columns, rows };
}
