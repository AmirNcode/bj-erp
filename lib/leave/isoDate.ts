/**
 * Day arithmetic on Gregorian `YYYY-MM-DD` strings, parsed as UTC midnight so
 * the server's and the device's timezones never shift a date.
 */

const MS_PER_DAY = 86_400_000;

/** `iso` moved by `days` (may be negative). A malformed date comes back unchanged. */
export function addDays(iso: string, days: number): string {
  const ms = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(ms)) return iso;
  return new Date(ms + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Whole days from `start` to `end` (negative when reversed); 0 for a malformed date. */
export function daysBetween(start: string, end: string): number {
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return 0;
  return Math.floor((endMs - startMs) / MS_PER_DAY);
}
