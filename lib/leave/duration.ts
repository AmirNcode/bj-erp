/**
 * Days <-> minutes conversion and rendering. Minutes are the canonical stored
 * unit (spec §5); this module is the ONLY place the conversion may happen.
 *
 * Pure — no I/O, and labels are injected so it carries no i18n dependency.
 */
import { formatNumber } from '@/lib/i18n/format';

export type DurationLabels = {
  days: string;
  hours: string;
  minutes: string;
  and: string;
  /** Singular forms for a count of exactly 1 ("1 hour"); fall back to the plural. */
  day?: string;
  hour?: string;
  minute?: string;
};

export type DurationParts = {
  days: number;
  hours: number;
  minutes: number;
};

/** How a paid-leave request is checked against the balance (FR-92). */
export type BalanceRule = 'overdraft' | 'strict' | 'split' | 'none';

export type LeaveBalanceProjection = {
  requestingMinutes: number;
  /** Balance minus pending requests; may be negative. */
  availableMinutes: number;
  remainingMinutes: number;
  unpaidMinutes: number;
  /** How much of the request exceeds what is available. */
  overMinutes: number;
  /** Strict rule only: the request exceeds the available balance. */
  blocked: boolean;
  rule: BalanceRule;
};

/**
 * Projects one paid-leave request against the balance minus pending requests.
 * `split` (default) turns the excess into unpaid time, `strict` blocks it,
 * `overdraft` lets the balance go negative, `none` ignores balances. The
 * database repeats this under its employee ledger lock.
 */
export function projectLeaveBalance(
  requestedMinutes: number,
  balanceMinutes: number,
  opts: { pendingMinutes?: number; rule?: BalanceRule } = {}
): LeaveBalanceProjection {
  const rule = opts.rule ?? 'split';
  const requestingMinutes = Math.max(Math.round(requestedMinutes), 0);
  const balance = Math.round(balanceMinutes);
  const availableMinutes = balance - Math.max(Math.round(opts.pendingMinutes ?? 0), 0);
  const usable = Math.max(availableMinutes, 0);
  const overMinutes = Math.max(requestingMinutes - usable, 0);
  const base = { requestingMinutes, availableMinutes, rule };

  switch (rule) {
    case 'overdraft':
      return {
        ...base,
        remainingMinutes: availableMinutes - requestingMinutes,
        unpaidMinutes: 0,
        overMinutes,
        blocked: false,
      };
    case 'strict':
      return {
        ...base,
        remainingMinutes: Math.max(availableMinutes - requestingMinutes, 0),
        unpaidMinutes: 0,
        overMinutes,
        blocked: overMinutes > 0,
      };
    case 'none':
      return { ...base, remainingMinutes: 0, unpaidMinutes: 0, overMinutes: 0, blocked: false };
    default:
      return {
        ...base,
        remainingMinutes: Math.max(availableMinutes - requestingMinutes, 0),
        // Like the database: the unpaid part comes from the balance, not from what is available.
        unpaidMinutes: Math.max(requestingMinutes - Math.max(balance, 0), 0),
        overMinutes,
        blocked: false,
      };
  }
}

/**
 * Splits a minute total into days/hours/minutes for display.
 * A negative total (a ledger debit) keeps its sign on each component and splits
 * its magnitude, so -480 at an 8h day reads as -1 day rather than -1 day plus a
 * positive remainder.
 */
export function minutesToDaysHours(totalMinutes: number, hoursPerDay: number): DurationParts {
  const minutesPerDay = Math.round(hoursPerDay * 60);
  const sign = totalMinutes < 0 ? -1 : 1;
  const abs = Math.abs(Math.round(totalMinutes));

  const days = Math.floor(abs / minutesPerDay);
  const afterDays = abs - days * minutesPerDay;
  const hours = Math.floor(afterDays / 60);
  const minutes = afterDays - hours * 60;

  // Sign only the non-zero parts: `sign * 0` is -0, which surprises callers that
  // compare with Object.is or serialise the result.
  const signed = (n: number) => (n === 0 ? 0 : sign * n);

  return { days: signed(days), hours: signed(hours), minutes: signed(minutes) };
}

/** Renders "۹ روز و ۴ ساعت" / "9 days and 4 hours". Zero renders as "0 days". */
export function formatDuration(
  totalMinutes: number,
  hoursPerDay: number,
  locale: string,
  labels: DurationLabels
): string {
  const { days, hours, minutes } = minutesToDaysHours(totalMinutes, hoursPerDay);
  const parts: string[] = [];
  // A negative balance (FR-48) reads "-1 day and 4 hours": the sign goes on the
  // first part only, or it would read as a sum of two debits.
  const signed = (n: number) => (parts.length === 0 ? n : Math.abs(n));

  const unit = (n: number, plural: string, singular?: string) =>
    Math.abs(n) === 1 && singular ? singular : plural;

  if (days !== 0) parts.push(`${formatNumber(signed(days), locale)} ${unit(days, labels.days, labels.day)}`);
  if (hours !== 0) parts.push(`${formatNumber(signed(hours), locale)} ${unit(hours, labels.hours, labels.hour)}`);
  if (minutes !== 0)
    parts.push(`${formatNumber(signed(minutes), locale)} ${unit(minutes, labels.minutes, labels.minute)}`);

  if (parts.length === 0) return `${formatNumber(0, locale)} ${labels.days}`;
  return parts.join(` ${labels.and} `);
}

/** Only for converting admin day-denominated input (allocations) into minutes. */
export function daysToMinutes(days: number, hoursPerDay: number): number {
  return Math.round(days * hoursPerDay * 60);
}

export type DaysHoursParts = {
  days: number;
  hours: number;
  /** Minutes below a whole hour the form keeps but does not show (from hourly leave). */
  restMinutes: number;
};

export type DaysHoursError = 'notWhole' | 'negative' | 'mixedSign' | 'hoursTooLarge' | 'tooLarge';

/** The database bounds a balance at ±366 days (FR-48); the CSV import uses the same limit. */
const MAX_DAYS = 366;

/**
 * Joins the whole days and whole hours an admin typed, plus the leftover minutes
 * the form carried along, back into minutes. The inverse of minutesToDaysHours.
 *
 * Same rules as the CSV import (lib/csv/import-rows.ts): a negative amount carries
 * its sign on both parts, and the hours stay below one working day. The leftover
 * minutes take the sign of what was typed, or keep their own when both parts are 0.
 */
export function daysHoursToMinutes(
  { days, hours, restMinutes }: DaysHoursParts,
  hoursPerDay: number,
  { allowNegative }: { allowNegative: boolean }
): { ok: true; minutes: number } | { ok: false; error: DaysHoursError } {
  if (!Number.isInteger(days) || !Number.isInteger(hours)) return { ok: false, error: 'notWhole' };
  if (!allowNegative && (days < 0 || hours < 0)) return { ok: false, error: 'negative' };
  if ((days > 0 && hours < 0) || (days < 0 && hours > 0)) return { ok: false, error: 'mixedSign' };
  if (Math.abs(hours) >= hoursPerDay) return { ok: false, error: 'hoursTooLarge' };
  if (Math.abs(days) > MAX_DAYS) return { ok: false, error: 'tooLarge' };

  const typedSign = Math.sign(days) || Math.sign(hours);
  const rest = typedSign === 0 ? restMinutes : typedSign * Math.abs(restMinutes);
  const minutesPerDay = Math.round(hoursPerDay * 60);
  return { ok: true, minutes: days * minutesPerDay + hours * 60 + rest };
}
