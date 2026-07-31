/**
 * Pure monthly-accrual planner (spec §6.2). Decides which ledger rows *should*
 * exist for an employee/leave-type; writes nothing and knows nothing about
 * Postgres.
 *
 * MUST STAY IN LOCKSTEP with public.accrue_leave in
 * supabase/migrations/20260729130006_leave_accrual_fns.sql — same order of
 * operations, same rounding. The SQL is authoritative at runtime; this is what
 * makes the rules testable, the same way lib/leave/workingDays.ts mirrors
 * compute_requested_minutes.
 *
 * Order of operations per month, and each step exists for a reason:
 *   1. skip months already posted            — idempotency
 *   2. skip months ending before the hire    — nobody accrues before being hired
 *   3. forfeit carryover excess at Farvardin — BEFORE crediting that month
 *   4. pro-rate the hire month               — calendar days, so HR can check it
 *   5. clamp to the annual cap               — counts accruals, not the balance
 */

export type AccrualPolicy = {
  accrualMinutesPerMonth: number;
  annualCapMinutes: number | null;
  carryoverCapMinutes: number;
  /** YYYY-MM-DD — the Gregorian start of a Jalali month. */
  accrualStartMonth: string;
};

export type JalaliMonth = {
  jalaliYear: number;
  jalaliMonth: number;
  gregorianStart: string;
  gregorianEnd: string;
};

export type AccrualEntryType = 'allocation' | 'carryover_forfeit';

export type PostedEntry = {
  periodMonth: string;
  entryType: AccrualEntryType;
  deltaMinutes: number;
};

export type PlannedEntry = {
  periodMonth: string;
  entryType: AccrualEntryType;
  /** Signed: positive for accrual, negative for a forfeiture. */
  deltaMinutes: number;
  balanceAfterMinutes: number;
};

const DAY_MS = 86_400_000;

/** Whole days from `a` to `b`, both YYYY-MM-DD, parsed as UTC to avoid drift. */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY_MS);
}

export function planAccruals(input: {
  policy: AccrualPolicy;
  months: JalaliMonth[];
  posted: PostedEntry[];
  hireDate: string | null;
  today: string;
  openingBalanceMinutes: number;
}): PlannedEntry[] {
  const { policy, months, posted, hireDate, today, openingBalanceMinutes } = input;

  // A zero rate means this type does not accrue at all (sick leave).
  if (policy.accrualMinutesPerMonth <= 0) return [];

  const isPosted = (periodMonth: string, entryType: AccrualEntryType) =>
    posted.some((p) => p.periodMonth === periodMonth && p.entryType === entryType);

  // Accruals already credited, per Jalali year, so the annual cap governs the
  // whole year rather than just what this call adds. Opening allocations carry no
  // period_month and so never appear here — they must not consume the cap.
  const yearOfMonth = new Map(months.map((m) => [m.gregorianStart, m.jalaliYear]));
  const accruedByYear = new Map<number, number>();
  for (const p of posted) {
    if (p.entryType !== 'allocation') continue;
    const year = yearOfMonth.get(p.periodMonth);
    if (year === undefined) continue;
    accruedByYear.set(year, (accruedByYear.get(year) ?? 0) + p.deltaMinutes);
  }

  const due = months
    .filter((m) => m.gregorianStart >= policy.accrualStartMonth && m.gregorianStart <= today)
    .sort((a, b) => a.gregorianStart.localeCompare(b.gregorianStart));

  const planned: PlannedEntry[] = [];
  let balance = openingBalanceMinutes;

  for (const month of due) {
    if (hireDate && month.gregorianEnd < hireDate) continue;

    // Year boundary: clamp what was carried in, before crediting this month.
    // The earlier-accrual guard stops a brand-new employee whose first month
    // happens to be Farvardin from being "carried over" into and losing their
    // opening balance.
    const hasEarlierAccrual =
      posted.some((p) => p.entryType === 'allocation' && p.periodMonth < month.gregorianStart) ||
      planned.some((p) => p.entryType === 'allocation' && p.periodMonth < month.gregorianStart);

    if (
      month.jalaliMonth === 1 &&
      hasEarlierAccrual &&
      !isPosted(month.gregorianStart, 'carryover_forfeit') &&
      balance > policy.carryoverCapMinutes
    ) {
      const excess = balance - policy.carryoverCapMinutes;
      balance -= excess;
      planned.push({
        periodMonth: month.gregorianStart,
        entryType: 'carryover_forfeit',
        deltaMinutes: -excess,
        balanceAfterMinutes: balance,
      });
    }

    if (isPosted(month.gregorianStart, 'allocation')) continue;

    let amount = policy.accrualMinutesPerMonth;

    // Pro-rate the hire month by calendar days remaining in it. Calendar rather
    // than working days so an employee can check it against a payslip by hand.
    if (hireDate && hireDate >= month.gregorianStart && hireDate <= month.gregorianEnd) {
      const total = daysBetween(month.gregorianStart, month.gregorianEnd) + 1;
      const remaining = daysBetween(hireDate, month.gregorianEnd) + 1;
      amount = Math.round((policy.accrualMinutesPerMonth * remaining) / total);
    }

    if (policy.annualCapMinutes !== null) {
      const already = accruedByYear.get(month.jalaliYear) ?? 0;
      amount = Math.min(amount, Math.max(policy.annualCapMinutes - already, 0));
    }

    if (amount <= 0) continue;

    balance += amount;
    accruedByYear.set(month.jalaliYear, (accruedByYear.get(month.jalaliYear) ?? 0) + amount);
    planned.push({
      periodMonth: month.gregorianStart,
      entryType: 'allocation',
      deltaMinutes: amount,
      balanceAfterMinutes: balance,
    });
  }

  return planned;
}
