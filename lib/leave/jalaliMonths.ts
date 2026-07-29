/**
 * Build-time generator for the `jalali_months` reference table (spec §4).
 *
 * NOT imported by app code — `scripts/gen-jalali-months.mjs` uses it to emit the
 * migration, and the 612 rows then live in Postgres. Accrual anchors, the
 * carryover boundary, and serial years all join against that table instead of
 * converting calendars at query time.
 */

// Subpaths carry the explicit `.js` extension and DateObject goes through an
// interop shim because this module is also imported by scripts/gen-jalali-months.mjs
// under plain Node ESM, where react-date-object (CJS, no exports map) resolves
// neither bare subpaths nor an unwrapped default. Bundler resolution (Next,
// vitest) is unaffected by both. This is why it differs from lib/leave/dateConvert.ts.
import DateObjectModule from 'react-date-object';
import persian from 'react-date-object/calendars/persian.js';
import persian_en from 'react-date-object/locales/persian_en.js';
import gregorian from 'react-date-object/calendars/gregorian.js';
import gregorian_en from 'react-date-object/locales/gregorian_en.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const DateObject = ((DateObjectModule as any).default ??
  DateObjectModule) as typeof DateObjectModule;

export type JalaliMonthRow = {
  jalaliYear: number;
  jalaliMonth: number;
  /** Gregorian YYYY-MM-DD of day 1 of this Jalali month. */
  gregorianStart: string;
  /** Gregorian YYYY-MM-DD of the last day of this Jalali month. */
  gregorianEnd: string;
};

function toGregorian(jYear: number, jMonth: number, jDay: number): string {
  return new DateObject({
    calendar: persian,
    locale: persian_en,
    year: jYear,
    month: jMonth,
    day: jDay,
  })
    .convert(gregorian, gregorian_en)
    .format('YYYY-MM-DD');
}

/** Inclusive on both years. 1400–1450 yields 612 rows. */
export function buildJalaliMonths(fromYear: number, toYear: number): JalaliMonthRow[] {
  const rows: JalaliMonthRow[] = [];
  for (let y = fromYear; y <= toYear; y++) {
    for (let m = 1; m <= 12; m++) {
      // toLastOfMonth() is calendar-aware: it knows Esfand is 29 or 30 days.
      const lastDay = new DateObject({
        calendar: persian,
        locale: persian_en,
        year: y,
        month: m,
        day: 1,
      }).toLastOfMonth().day;

      rows.push({
        jalaliYear: y,
        jalaliMonth: m,
        gregorianStart: toGregorian(y, m, 1),
        gregorianEnd: toGregorian(y, m, lastDay),
      });
    }
  }
  return rows;
}
