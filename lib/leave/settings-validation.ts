import { timeToMinutes } from '@/lib/leave/hourly';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

/** Strict Gregorian YYYY-MM-DD validation (including month/day reality). */
export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export type HourlySettingsValidation =
  | { ok: true; workStart: string; workEnd: string; capMinutes: number }
  | { ok: false };

/** FR-57: hourly leave may never exceed 4 hours a day (CHECK on work_settings too). */
export const MAX_HOURLY_CAP_MINUTES = 240;

/**
 * Validate the company work window and keep the hourly cap inside that window
 * and at most 4 hours.
 */
export function validateHourlySettings(
  workStart: string,
  workEnd: string,
  capMinutes: number
): HourlySettingsValidation {
  if (!TIME_RE.test(workStart) || !TIME_RE.test(workEnd)) return { ok: false };
  const windowMinutes = timeToMinutes(workEnd) - timeToMinutes(workStart);
  if (windowMinutes <= 0) return { ok: false };
  if (
    !Number.isInteger(capMinutes) ||
    capMinutes <= 0 ||
    capMinutes > windowMinutes ||
    capMinutes > MAX_HOURLY_CAP_MINUTES
  ) {
    return { ok: false };
  }
  return { ok: true, workStart, workEnd, capMinutes };
}

/** FR-93: a lunch break may last at most 3 hours (CHECK work_settings_lunch_sane too). */
export const MAX_LUNCH_MINUTES = 180;

export type LunchBreakValidation =
  | { ok: true; lunchStart: string; lunchMinutes: number }
  | { ok: false };

/**
 * FR-93: the lunch break must sit inside the work window, unless it is 0 minutes
 * (no lunch break). Mirrors CHECK work_settings_lunch_sane.
 */
export function validateLunchBreak(
  workStart: string,
  workEnd: string,
  lunchStart: string,
  lunchMinutes: number
): LunchBreakValidation {
  if (!TIME_RE.test(lunchStart)) return { ok: false };
  if (!Number.isInteger(lunchMinutes) || lunchMinutes < 0 || lunchMinutes > MAX_LUNCH_MINUTES) {
    return { ok: false };
  }
  if (
    lunchMinutes > 0 &&
    (timeToMinutes(lunchStart) < timeToMinutes(workStart) ||
      timeToMinutes(lunchStart) + lunchMinutes > timeToMinutes(workEnd))
  ) {
    return { ok: false };
  }
  return { ok: true, lunchStart, lunchMinutes };
}
