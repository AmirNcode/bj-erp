/** FR-94 deadline maths. Pure; dates are Gregorian ISO (`YYYY-MM-DD`). */

export type DeadlineState = 'overdue' | 'soon' | 'ok';

const DAY = 24 * 60 * 60 * 1000;

/** Whole days from `today` to `dueOn`; negative when overdue, 0 on the day. */
export function daysLeft(dueOn: string, today: string): number {
  return Math.round((Date.parse(`${dueOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY);
}

/** Overdue: past the date. Soon: today up to `warnDays` ahead. */
export function deadlineState(dueOn: string, today: string, warnDays: number): DeadlineState {
  const left = daysLeft(dueOn, today);
  if (left < 0) return 'overdue';
  return left <= warnDays ? 'soon' : 'ok';
}
