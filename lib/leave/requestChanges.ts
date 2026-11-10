/**
 * FR-91: the edits of an approved request, as before/after snapshots. A request keeps its signed
 * values; every later edit is one `request_corrections` row. Pure: the screens and the print
 * form both read the same list. A row written before FR-91 (trip dates only, FR-84) has no unit,
 * day part, times or minutes: it reads as a daily request of unknown minutes.
 */

import type { RequestCorrection } from '@/lib/travel/extensions';
import { formatCalendarDate } from '@/lib/leave/calendarMonth';
import { formatDuration, type DurationLabels } from '@/lib/leave/duration';
import { formatTimeRange } from '@/lib/leave/formatTimeRange';

export type RequestSnapshot = {
  unit: 'day' | 'hour';
  start: string;
  end: string;
  dayPart: 'full' | 'am' | 'pm';
  startTime: string | null;
  endTime: string | null;
  minutes: number | null;
  perDiem: number | null;
};

export type RequestChange = {
  at: string;
  by: string | null;
  reason: string;
  before: RequestSnapshot;
  after: RequestSnapshot;
};

/** A `leave_requests`-shaped row as a snapshot. */
export function snapshotOf(r: {
  unit: 'day' | 'hour';
  start_date: string;
  end_date: string;
  day_part: 'full' | 'am' | 'pm';
  start_time: string | null;
  end_time: string | null;
  requested_minutes: number | null;
  per_diem_rials?: number | null;
}): RequestSnapshot {
  return {
    unit: r.unit,
    start: r.start_date,
    end: r.end_date,
    dayPart: r.day_part,
    startTime: r.start_time,
    endTime: r.end_time,
    minutes: r.requested_minutes,
    perDiem: r.per_diem_rials ?? null,
  };
}

/** Every `request_corrections` row as a change, oldest first. */
export function correctionChanges(corrections: readonly RequestCorrection[]): RequestChange[] {
  return [...corrections]
    .sort((a, b) => a.corrected_at.localeCompare(b.corrected_at))
    .map((c) => ({
      at: c.corrected_at,
      by: c.corrected_by_name,
      reason: c.reason,
      before: {
        unit: c.old_unit ?? 'day',
        start: c.old_start_date,
        end: c.old_end_date,
        dayPart: c.old_day_part ?? 'full',
        startTime: c.old_start_time ?? null,
        endTime: c.old_end_time ?? null,
        minutes: c.minutes_before ?? null,
        perDiem: c.per_diem_before,
      },
      after: {
        unit: c.new_unit ?? 'day',
        start: c.new_start_date,
        end: c.new_end_date,
        dayPart: c.new_day_part ?? 'full',
        startTime: c.new_start_time ?? null,
        endTime: c.new_end_time ?? null,
        minutes: c.minutes_after ?? null,
        perDiem: c.per_diem_after,
      },
    }));
}

/**
 * The signed values (the first edit's `before`, or the current request when it was never
 * edited) and every edit, oldest first.
 */
export function requestChanges(
  current: RequestSnapshot,
  corrections: readonly RequestCorrection[]
): { signed: RequestSnapshot; changes: RequestChange[] } {
  const changes = correctionChanges(corrections);
  return { signed: changes[0]?.before ?? current, changes };
}

/**
 * What the paper form prints: the body holds the signed values, and one line per edit follows.
 * When the type changed since signing, the form of the current type cannot hold the signed
 * values (a day has no times), so the body shows the current request and `signedLine` carries
 * the signed original.
 */
export function printedChanges(
  current: RequestSnapshot,
  corrections: readonly RequestCorrection[]
): { body: RequestSnapshot; signedLine: RequestSnapshot | null; changes: RequestChange[] } {
  const { signed, changes } = requestChanges(current, corrections);
  if (changes.length === 0) return { body: current, signedLine: null, changes };
  if (signed.unit !== current.unit) return { body: current, signedLine: signed, changes };
  return { body: signed, signedLine: null, changes };
}

/** "1405/12/10 — 1405/12/12 (3 days)" or "1405/12/10 09:00–11:00 (2 hours)", for the locale. */
export function describeSnapshot(
  s: RequestSnapshot,
  o: {
    locale: string;
    hoursPerDay?: number;
    durationLabels?: DurationLabels;
    dayPartLabels?: { am: string; pm: string };
  }
): string {
  const date = (iso: string) => formatCalendarDate(iso, o.locale);
  let when: string;
  if (s.unit === 'hour') {
    when = `${date(s.start)} ${formatTimeRange(s.startTime, s.endTime, o.locale) ?? ''}`.trim();
  } else {
    when = s.start === s.end ? date(s.start) : `${date(s.start)} — ${date(s.end)}`;
    if (s.dayPart !== 'full' && o.dayPartLabels) when += ` ${o.dayPartLabels[s.dayPart]}`;
  }
  if (s.minutes !== null && o.hoursPerDay && o.durationLabels) {
    when += ` (${formatDuration(s.minutes, o.hoursPerDay, o.locale, o.durationLabels)})`;
  }
  return when;
}
