import type { WorkSettings } from '@/lib/actions/leave';

/**
 * Every field of `WorkSettings` at its column default — the "settings could not
 * be read" fallback.
 *
 * It lives here rather than beside `getWorkSettings` because `lib/actions/leave.ts`
 * is a `'use server'` module, and such a file may only export async functions: a
 * plain object export fails the build with "A 'use server' file can only export
 * async functions, found object". The type import above is erased at runtime, so
 * it is safe.
 *
 * Exists at all because these values were previously hand-written as object
 * literals at each call site, and every new WorkSettings field meant hunting them
 * down again.
 */
export const WORK_SETTINGS_FALLBACK: WorkSettings = {
  weekendDays: [5],
  holidays: [],
  hoursPerDay: 8,
  workStart: '07:00',
  workEnd: '15:00',
  maxHourlyMinutesPerDay: 240,
};
