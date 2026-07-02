/**
 * Company-local "today", independent of server timezone.
 *
 * The demo runs on Vercel (UTC) while the company operates in Iran
 * (Asia/Tehran, UTC+3:30) — between midnight and 03:30 Tehran time a plain
 * `new Date()` on the server is still on *yesterday's* date, shifting the home
 * board range and the calendar month label. These helpers pin date-only logic
 * to the company timezone. The SQL side mirrors this in cancel_leave_request
 * (migration 20260702120003).
 */

export const APP_TIME_ZONE = 'Asia/Tehran';

/** Today's date in the company timezone as YYYY-MM-DD (en-CA gives ISO order). */
export function todayInAppTz(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/**
 * A Date whose UTC calendar fields equal the company-timezone date (pinned to
 * 12:00 UTC so date-only consumers can't drift across a boundary). Use this
 * wherever server code derives "today" via getUTC* fields.
 */
export function nowInAppTz(at: Date = new Date()): Date {
  return new Date(todayInAppTz(at) + 'T12:00:00Z');
}
