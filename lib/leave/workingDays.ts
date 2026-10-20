/**
 * Pure working-day counter (Gregorian only).
 *
 * Dates are parsed as UTC to avoid timezone drift.
 * weekendDays uses ISO weekday numbers (Mon=1 … Sun=7).
 *
 * The working-day test itself lives in `isWorkingDate` (lib/leave/weekend.ts); its weekend half
 * mirrors `private.is_company_weekend`. Since FR-41 a weekday can be off every
 * OTHER week, so this cannot be a plain `includes` any more — and the rule must
 * exist in exactly one place on each side of the wire.
 */
import { isWorkingDate, type WeekendRule } from './weekend';

export function countWorkingDays(
  start: string,
  end: string,
  opts: WeekendRule & {
    holidays: string[];
    dayPart: 'full' | 'am' | 'pm';
  }
): number {
  const { dayPart } = opts;

  // Parse as UTC midnight to avoid timezone shifts
  const startMs = Date.parse(start + 'T00:00:00Z');
  const endMs = Date.parse(end + 'T00:00:00Z');

  // Guard against invalid dates
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return 0;

  // Reversed range → 0
  if (endMs < startMs) return 0;

  const isWorkingDay = (d: Date) => isWorkingDate(d.toISOString().slice(0, 10), opts);

  // Half-day logic: valid only for a single working day
  if (dayPart === 'am' || dayPart === 'pm') {
    if (start !== end) return 0;
    const d = new Date(startMs);
    return isWorkingDay(d) ? 0.5 : 0;
  }

  // Full-day: count all working days in [start, end] inclusive
  let count = 0;
  const MS_PER_DAY = 86_400_000;
  for (let ms = startMs; ms <= endMs; ms += MS_PER_DAY) {
    if (isWorkingDay(new Date(ms))) count++;
  }
  return count;
}
