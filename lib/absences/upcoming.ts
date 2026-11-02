import { addDays } from '@/lib/leave/isoDate';

/** How far ahead the absences look-ahead reaches (owner, 2026-11-02: about a month). */
export const UPCOMING_ABSENCE_DAYS = 30;

/**
 * Days the look-ahead covers: today through `days` days from `today`. An absence
 * shows when it overlaps them, so one already under way is listed too (owner,
 * 2026-11-02: the Home card is the next 30 days only, no day picker).
 */
export function upcomingAbsenceWindow(today: string, days = UPCOMING_ABSENCE_DAYS): { from: string; to: string } {
  return { from: today, to: addDays(today, days) };
}
