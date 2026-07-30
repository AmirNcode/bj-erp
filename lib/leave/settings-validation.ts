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

/** Validate the company work window and keep the hourly cap inside that window. */
export function validateHourlySettings(
  workStart: string,
  workEnd: string,
  capMinutes: number
): HourlySettingsValidation {
  if (!TIME_RE.test(workStart) || !TIME_RE.test(workEnd)) return { ok: false };
  const windowMinutes = timeToMinutes(workEnd) - timeToMinutes(workStart);
  if (windowMinutes <= 0) return { ok: false };
  if (!Number.isInteger(capMinutes) || capMinutes <= 0 || capMinutes > windowMinutes) {
    return { ok: false };
  }
  return { ok: true, workStart, workEnd, capMinutes };
}
