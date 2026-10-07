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
};

export type DurationParts = {
  days: number;
  hours: number;
  minutes: number;
};

export type LeaveBalanceProjection = {
  requestingMinutes: number;
  remainingMinutes: number;
  unpaidMinutes: number;
};

/**
 * Projects one paid-leave request against the current balance without allowing
 * paid leave to become negative. The database repeats this calculation under
 * its employee ledger lock when the request is approved.
 */
export function projectLeaveBalance(
  requestedMinutes: number,
  currentBalanceMinutes: number
): LeaveBalanceProjection {
  const requestingMinutes = Math.max(Math.round(requestedMinutes), 0);
  const availableMinutes = Math.max(Math.round(currentBalanceMinutes), 0);

  return {
    requestingMinutes,
    remainingMinutes: Math.max(availableMinutes - requestingMinutes, 0),
    unpaidMinutes: Math.max(requestingMinutes - availableMinutes, 0),
  };
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

  if (days !== 0) parts.push(`${formatNumber(signed(days), locale)} ${labels.days}`);
  if (hours !== 0) parts.push(`${formatNumber(signed(hours), locale)} ${labels.hours}`);
  if (minutes !== 0) parts.push(`${formatNumber(signed(minutes), locale)} ${labels.minutes}`);

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
