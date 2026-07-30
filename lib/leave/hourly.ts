/**
 * Pure time arithmetic for hourly leave / مرخصی ساعتی (spec §7).
 *
 * MIRRORS the SQL in supabase/migrations/20260729130009_leave_hourly_fns.sql.
 * The database is authoritative at runtime — a client must never be able to
 * fabricate a duration — but time-overlap logic deserves exhaustive tests rather
 * than a hand-check in psql, and the request form needs the same maths for its
 * live preview.
 *
 * Times are company-local 'HH:MM' (or 'HH:MM:SS', which is what Postgres returns
 * for a `time` column). There is no timezone question inside a single workday.
 */

export type TimeRange = { start: string; end: string };

/** '09:30' or '09:30:00' -> 570. Seconds are ignored, not rounded. */
export function timeToMinutes(t: string): number {
  const [h, m] = t.split(':');
  return Number(h) * 60 + Number(m);
}

/** 570 -> '09:30', zero-padded. */
export function minutesToTime(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** Duration in minutes; 0 for a reversed or empty range (never negative). */
export function rangeMinutes(r: TimeRange): number {
  const span = timeToMinutes(r.end) - timeToMinutes(r.start);
  return span > 0 ? span : 0;
}

/** True when the range sits inside the window, endpoints inclusive. */
export function isWithinWindow(r: TimeRange, window: TimeRange): boolean {
  return (
    timeToMinutes(r.start) >= timeToMinutes(window.start) &&
    timeToMinutes(r.end) <= timeToMinutes(window.end)
  );
}

/**
 * True when two ranges genuinely intersect.
 *
 * Strict on both sides, so 08:00–10:00 and 10:00–12:00 are ADJACENT, not
 * overlapping: a worker running two separate errands in one day must not be
 * blocked by a shared boundary.
 */
export function rangesOverlap(a: TimeRange, b: TimeRange): boolean {
  return timeToMinutes(a.start) < timeToMinutes(b.end) && timeToMinutes(a.end) > timeToMinutes(b.start);
}

export type LeavePeriod = {
  startDate: string;
  endDate: string;
  unit: 'day' | 'hour';
  startTime: string | null;
  endTime: string | null;
};

/**
 * The full leave-overlap predicate shared by approval warnings and SQL:
 * disjoint dates never overlap; a daily request occupies the whole date;
 * two hourly requests intersect only when their times genuinely intersect.
 */
export function leavePeriodsOverlap(a: LeavePeriod, b: LeavePeriod): boolean {
  if (a.startDate > b.endDate || a.endDate < b.startDate) return false;
  if (a.unit === 'day' || b.unit === 'day') return true;
  if (!a.startTime || !a.endTime || !b.startTime || !b.endTime) return false;
  return rangesOverlap(
    { start: a.startTime, end: a.endTime },
    { start: b.startTime, end: b.endTime }
  );
}

/**
 * Selectable times across the window, inclusive of both ends — the options for the
 * from/to native selects. Empty for a reversed window.
 */
export function timeSlots(window: TimeRange, stepMinutes: number): string[] {
  const from = timeToMinutes(window.start);
  const to = timeToMinutes(window.end);
  if (to <= from || stepMinutes <= 0) return [];

  const slots: string[] = [];
  for (let m = from; m <= to; m += stepMinutes) slots.push(minutesToTime(m));
  return slots;
}

/** That day's hourly minutes once this request is added — checked against the cap. */
export function hourlyDayTotal(existingMinutes: number, requestedMinutes: number): number {
  return existingMinutes + requestedMinutes;
}
