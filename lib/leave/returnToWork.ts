/**
 * When the requester is back at work after a request (shown on the request forms).
 *
 * Display only: nothing is stored or charged from it. Weekends (weekly and
 * fortnightly, FR-41) and company holidays come from the same work settings the
 * duration preview uses. The half-day midpoint matches `private.approval_bounds`:
 * work_start + (work_end - work_start) / 2.
 */
import { minutesToTime, timeToMinutes } from './hourly';
import { isWeekendDate, type WeekendRule } from './weekend';

export type ReturnToWorkInput = {
  unit: 'day' | 'hour';
  dayPart?: 'full' | 'am' | 'pm';
  /** Gregorian YYYY-MM-DD, last day of the absence. */
  end: string;
  /** 'HH:MM', hourly requests only. */
  endTime?: string | null;
};

export type ReturnToWorkSettings = WeekendRule & {
  holidays: string[];
  workStart: string;
  workEnd: string;
};

/** A date, plus a time when the requester is back later that same working day. */
export type ReturnToWork = { date: string; time: string | null };

const MS_PER_DAY = 86_400_000;
/** Safety stop: a year of consecutive days off means the settings are wrong, not a real return day. */
const MAX_DAYS_AHEAD = 366;

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

export function isWorkingDate(iso: string, settings: ReturnToWorkSettings): boolean {
  return !isWeekendDate(iso, settings) && !settings.holidays.includes(iso);
}

/** First working day strictly after `iso`, or null if none within a year. */
export function nextWorkingDay(iso: string, settings: ReturnToWorkSettings): string | null {
  for (let i = 1; i <= MAX_DAYS_AHEAD; i++) {
    const day = addDays(iso, i);
    if (isWorkingDate(day, settings)) return day;
  }
  return null;
}

export function returnToWork(input: ReturnToWorkInput, settings: ReturnToWorkSettings): ReturnToWork | null {
  if (Number.isNaN(Date.parse(`${input.end}T00:00:00Z`))) return null;
  const nextDay = (): ReturnToWork | null => {
    const date = nextWorkingDay(input.end, settings);
    return date ? { date, time: null } : null;
  };
  const workStart = timeToMinutes(settings.workStart);
  const workEnd = timeToMinutes(settings.workEnd);

  // Back later the same day only if that day is a working day and time is left in it.
  let backAt: number | null = null;
  if (input.unit === 'hour') {
    if (!input.endTime) return null;
    backAt = Math.max(timeToMinutes(input.endTime), workStart);
  } else if (input.dayPart === 'am') {
    backAt = workStart + Math.floor((workEnd - workStart) / 2);
  }
  if (backAt !== null && backAt < workEnd && isWorkingDate(input.end, settings)) {
    return { date: input.end, time: minutesToTime(backAt) };
  }
  return nextDay();
}
