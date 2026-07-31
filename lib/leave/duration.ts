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

  if (days !== 0) parts.push(`${formatNumber(days, locale)} ${labels.days}`);
  if (hours !== 0) parts.push(`${formatNumber(hours, locale)} ${labels.hours}`);
  if (minutes !== 0) parts.push(`${formatNumber(minutes, locale)} ${labels.minutes}`);

  if (parts.length === 0) return `${formatNumber(0, locale)} ${labels.days}`;
  return parts.join(` ${labels.and} `);
}

/** Only for converting admin day-denominated input (allocations) into minutes. */
export function daysToMinutes(days: number, hoursPerDay: number): number {
  return Math.round(days * hoursPerDay * 60);
}
