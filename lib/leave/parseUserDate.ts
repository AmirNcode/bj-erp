/**
 * The one place a TYPED date becomes a stored date.
 *
 * Every screen shows Persian dates, but the database stores Gregorian (CLAUDE.md
 * convention 1), so anywhere a person types a date rather than picking one from a
 * calendar it has to be read, checked and converted. Today that means the two CSV
 * importers; anything similar in future should call this rather than grow a third
 * copy.
 *
 * That is not a hypothetical. `parseHireDate` and `parseHolidayDate` were
 * near-identical copies of this logic, both carrying the same silent bug (below).
 * One got fixed and the other did not, purely because they were separate. Hence
 * one implementation, one test suite, one place to get it right.
 *
 * ── Which calendar ──────────────────────────────────────────────────────────
 *
 * Disambiguated by the year: below 1600 is Persian, otherwise Gregorian. The two
 * calendars are ~621 years apart, so no real date is ambiguous — a Persian year
 * high enough to collide (1600+) is centuries in the future, and a Gregorian year
 * low enough (below 1600) is centuries in the past.
 *
 * Persian years far outside the app's `jalali_months` table are fine here: this
 * uses calendar arithmetic, not that lookup. A hire date of 1355 converts and
 * displays correctly. The table bounds which months leave can be ACCRUED for,
 * which is a different question.
 *
 * ── Why the round-trip check ────────────────────────────────────────────────
 *
 * `DateObject.isValid` does NOT reject an out-of-range day — it NORMALISES it and
 * still reports true. Measured:
 *
 *     2026-02-30  -> 2026-03-02          (Gregorian, February)
 *     2026-04-31  -> 2026-05-01          (Gregorian, April)
 *     1405/07/31  -> 1405/08/01          (Mehr has 30 days)
 *     1405/12/30  -> 1406/01/01          (Esfand has 29 days in 1405 — a whole
 *                                         Persian YEAR crossed)
 *
 * So a typo silently became a different date, with no error and nothing shown
 * back to the person importing. That matters beyond tidiness for a hire date:
 * `accrue_leave` skips months ending before it and pro-rates the hire month by
 * the days remaining in it, so a rolled date shifts earned leave.
 *
 * A naive "reject day > 30" would be wrong — 31 Shahrivar and 30 Esfand of a leap
 * year are both real. The only correct test is to build the date and read it back.
 */

import DateObject from 'react-date-object';
import persian from 'react-date-object/calendars/persian';
import gregorian from 'react-date-object/calendars/gregorian';
import { toAsciiDigits } from '@/lib/employees/code';

/** Years below this are read as Persian; at or above, Gregorian. */
export const PERSIAN_YEAR_CEILING = 1600;

/**
 * Reads a typed date and returns it as Gregorian ISO (`YYYY-MM-DD`).
 *
 * Accepts Persian or Gregorian, `/` or `-`, and Persian digits.
 *
 * Returns `null` for an empty cell — callers decide whether the field is
 * required — and `undefined` for anything that is not a real date, including a
 * day that does not exist in its month.
 */
export function parseUserDate(raw: string): string | null | undefined {
  const cell = toAsciiDigits((raw ?? '').trim());
  if (!cell) return null;

  const m = cell.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (!m) return undefined;

  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // Cheap rejects first, so `13` as a month never reaches the calendar at all.
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return undefined;

  const calendar = y < PERSIAN_YEAR_CEILING ? persian : gregorian;
  const obj = new DateObject({ calendar, year: y, month: mo, day: d });

  // `isValid` alone is not enough — see the header. Confirm by reading back the
  // value that was actually constructed; a genuine date survives unchanged.
  if (!obj.isValid || obj.year !== y || obj.month.number !== mo || obj.day !== d) {
    return undefined;
  }

  return obj.convert(gregorian).format('YYYY-MM-DD');
}
