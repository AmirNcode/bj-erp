/**
 * When the requester is back at work after a request (shown on the request forms).
 *
 * Display only: nothing is stored or charged from it. Weekends (weekly and
 * fortnightly, FR-41) and company holidays come from the same work settings the
 * duration preview uses. The half-day midpoint matches `private.approval_bounds`:
 * work_start + (work_end - work_start) / 2.
 */
import { minutesToTime, timeToMinutes } from './hourly';
import { isWorkingDate, nextWorkingDay, type WorkingDayRule } from './weekend';

export type ReturnToWorkInput = {
  unit: 'day' | 'hour';
  dayPart?: 'full' | 'am' | 'pm';
  /** Gregorian YYYY-MM-DD, last day of the absence. */
  end: string;
  /** 'HH:MM', hourly requests only. */
  endTime?: string | null;
};

export type ReturnToWorkSettings = WorkingDayRule & {
  workStart: string;
  workEnd: string;
};

/** A date, plus a time when the requester is back later that same working day. */
export type ReturnToWork = { date: string; time: string | null };

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
