// ISO weekday numbers: Mon=1 .. Sun=7. The Iranian/Persian week is shown Sat..Fri.
export const WEEKDAYS: { iso: number; key: string }[] = [
  { iso: 6, key: 'sat' },
  { iso: 7, key: 'sun' },
  { iso: 1, key: 'mon' },
  { iso: 2, key: 'tue' },
  { iso: 3, key: 'wed' },
  { iso: 4, key: 'thu' },
  { iso: 5, key: 'fri' },
];

export type WeekendValidation =
  | { ok: true; days: number[] }
  | { ok: false; reason: 'out_of_range' | 'all_week' };

/** Normalize + validate a weekend-day selection (ISO numbers). Must leave ≥1 working day. */
export function validateWeekendDays(days: number[]): WeekendValidation {
  const uniq = Array.from(new Set(days)).sort((a, b) => a - b);
  if (uniq.some((d) => d < 1 || d > 7)) return { ok: false, reason: 'out_of_range' };
  if (uniq.length >= 7) return { ok: false, reason: 'all_week' };
  return { ok: true, days: uniq };
}
