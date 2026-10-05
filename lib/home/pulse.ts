/**
 * Pure view-models for the approver home dashboard: today's pulse band, the
 * short-staffed warning on pending rows, my-balance usage and the next holiday.
 * No I/O — unit-tested. The reads live in lib/actions/home.ts.
 */

import type { CalendarEntry } from '@/lib/actions/leave/calendar';

export type PulseProfile = { id: string; department_id: string | null };

export type PulseLeaveType = { name_fa: string; name_en: string | null; count: number };

export type TodayPulse = {
  /** People in scope who are on site today. */
  present: number;
  /** Active headcount in scope. */
  total: number;
  /** Distinct people on approved leave today. */
  onLeave: number;
  /** `onLeave` split by leave type, largest first. */
  onLeaveByType: PulseLeaveType[];
  /** Distinct people on an approved full-day work errand today. */
  errandDaily: number;
  /** Distinct people on an approved hourly work errand today. */
  errandHourly: number;
  /** Off site today, per department id (`''` = no department). */
  absentByDepartment: Record<string, number>;
  /** Active headcount per department id. */
  headcountByDepartment: Record<string, number>;
  /** Who is off site today — used to avoid counting the requester twice. */
  absentIds: string[];
};

const covers = (e: { start_date: string; end_date: string }, today: string) =>
  e.start_date <= today && e.end_date >= today;

/**
 * Today's figures for `profiles` (the caller's scope: a manager's team, or the
 * whole company for hr/admin). Only approved entries count. A person is off
 * site when a full-day entry (leave or errand) covers today; half-day leave and
 * hourly entries are counted in their bucket but still leave the person present.
 */
export function buildTodayPulse(input: {
  today: string;
  profiles: PulseProfile[];
  entries: CalendarEntry[];
}): TodayPulse {
  const { today } = input;
  const deptOf = new Map(input.profiles.map((p) => [p.id, p.department_id ?? '']));
  const todays = input.entries.filter(
    (e) => e.status === 'approved' && deptOf.has(e.employee_id) && covers(e, today)
  );

  const absent = new Set<string>();
  const onLeave = new Set<string>();
  const errandDaily = new Set<string>();
  const errandHourly = new Set<string>();
  const byType = new Map<string, { name_fa: string; name_en: string | null; ids: Set<string> }>();

  for (const e of todays) {
    const fullDay = e.unit === 'day' && e.day_part === 'full';
    if (fullDay) absent.add(e.employee_id);
    if (e.kind === 'errand') {
      (e.unit === 'hour' ? errandHourly : errandDaily).add(e.employee_id);
      continue;
    }
    onLeave.add(e.employee_id);
    const key = e.leave_type_name_fa;
    const bucket = byType.get(key) ?? {
      name_fa: e.leave_type_name_fa,
      name_en: e.leave_type_name_en,
      ids: new Set<string>(),
    };
    bucket.ids.add(e.employee_id);
    byType.set(key, bucket);
  }

  const headcountByDepartment: Record<string, number> = {};
  for (const p of input.profiles) {
    const d = p.department_id ?? '';
    headcountByDepartment[d] = (headcountByDepartment[d] ?? 0) + 1;
  }
  const absentByDepartment: Record<string, number> = {};
  for (const id of absent) {
    const d = deptOf.get(id) ?? '';
    absentByDepartment[d] = (absentByDepartment[d] ?? 0) + 1;
  }

  return {
    present: input.profiles.length - absent.size,
    total: input.profiles.length,
    onLeave: onLeave.size,
    onLeaveByType: [...byType.values()]
      .map((b) => ({ name_fa: b.name_fa, name_en: b.name_en, count: b.ids.size }))
      .sort((a, b) => b.count - a.count),
    errandDaily: errandDaily.size,
    errandHourly: errandHourly.size,
    absentByDepartment,
    headcountByDepartment,
    absentIds: [...absent],
  };
}

/** Share of a department off site at which a pending row gets the warning. */
export const SHORT_STAFFED_RATIO = 0.2;

/**
 * How many OTHER people from the requester's department are off site today,
 * when that is enough to call the department short-staffed; otherwise null.
 */
export function shortStaffedOthers(input: {
  departmentId: string | null;
  employeeId: string;
  pulse: Pick<TodayPulse, 'absentByDepartment' | 'headcountByDepartment' | 'absentIds'>;
}): number | null {
  if (!input.departmentId) return null;
  const headcount = input.pulse.headcountByDepartment[input.departmentId] ?? 0;
  const absent = input.pulse.absentByDepartment[input.departmentId] ?? 0;
  const others = absent - (input.pulse.absentIds.includes(input.employeeId) ? 1 : 0);
  if (others < 1 || headcount === 0) return null;
  return others / headcount >= SHORT_STAFFED_RATIO ? others : null;
}

/** Whole days between an ISO timestamp/date and today (both read as dates). */
export function daysAgo(iso: string, today: string): number {
  const from = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  const to = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

export type BalanceUsage = {
  leaveTypeId: string;
  name_fa: string;
  name_en: string | null;
  /** False for unpaid / non-balance types: only `usedMinutes` is meaningful. */
  hasBalance: boolean;
  leftMinutes: number;
  usedMinutes: number;
  /** left + used: what the year started with plus what accrued since. */
  entitledMinutes: number;
};

/**
 * Entitled / used per leave type for the current year.
 * - Balance types: used = this year's consumption net of reversals (ledger);
 *   left = latest balance; entitled = left + used.
 * - Non-balance types (unpaid): never touch the ledger, so used = approved
 *   requested minutes this year.
 */
export function buildBalanceUsage(input: {
  types: { id: string; name_fa: string; name_en: string | null; affects_balance: boolean }[];
  balances: Record<string, number>;
  /** This year's ledger rows (consumption is negative, reversal positive). */
  ledger: { leave_type_id: string; entry_type: string; delta_minutes: number }[];
  /** This year's approved requests of non-balance types. */
  unpaidRequests: { leave_type_id: string | null; requested_minutes: number }[];
}): BalanceUsage[] {
  const usedLedger: Record<string, number> = {};
  for (const r of input.ledger) {
    if (r.entry_type !== 'consumption' && r.entry_type !== 'reversal') continue;
    usedLedger[r.leave_type_id] = (usedLedger[r.leave_type_id] ?? 0) - r.delta_minutes;
  }
  const usedUnpaid: Record<string, number> = {};
  for (const r of input.unpaidRequests) {
    if (!r.leave_type_id) continue;
    usedUnpaid[r.leave_type_id] = (usedUnpaid[r.leave_type_id] ?? 0) + r.requested_minutes;
  }

  return input.types.map((t) => {
    if (!t.affects_balance) {
      const used = usedUnpaid[t.id] ?? 0;
      return {
        leaveTypeId: t.id,
        name_fa: t.name_fa,
        name_en: t.name_en,
        hasBalance: false,
        leftMinutes: 0,
        usedMinutes: used,
        entitledMinutes: used,
      };
    }
    const left = input.balances[t.id] ?? 0;
    const used = Math.max(usedLedger[t.id] ?? 0, 0);
    return {
      leaveTypeId: t.id,
      name_fa: t.name_fa,
      name_en: t.name_en,
      hasBalance: true,
      leftMinutes: left,
      usedMinutes: used,
      entitledMinutes: Math.max(left + used, 0),
    };
  });
}
