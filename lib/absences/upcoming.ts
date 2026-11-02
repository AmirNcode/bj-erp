import { addDays } from '@/lib/leave/isoDate';

/** How far ahead the absences look-ahead reaches (owner, 2026-11-02: about a month). */
export const UPCOMING_ABSENCE_DAYS = 30;

/** Start dates the look-ahead covers: tomorrow through `days` days from `today` (today is on the day board). */
export function upcomingAbsenceWindow(today: string, days = UPCOMING_ABSENCE_DAYS): { from: string; to: string } {
  return { from: addDays(today, 1), to: addDays(today, days) };
}
