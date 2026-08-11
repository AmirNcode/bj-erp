/** Inclusive Gregorian calendar-day count for daily work errands. */
export function countCalendarDays(start: string, end: string): number {
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) return 0;
  return Math.floor((endMs - startMs) / 86_400_000) + 1;
}
