/**
 * Build-time generator for the `jalali_months` reference table (spec §4).
 *
 * NOT imported by app code — `scripts/gen-jalali-months.mjs` uses it to emit the
 * migration, and the 612 rows then live in Postgres. Accrual anchors, the
 * carryover boundary, and serial years all join against that table instead of
 * converting calendars at query time.
 */

// This module has to load under BOTH bundler resolution (Next, vitest) and plain
// Node ESM, because scripts/gen-jalali-months.mjs imports it directly. The two
// want opposite things from react-date-object (CJS, no exports map):
//   - extensionless subpaths resolve only under bundler resolution
//   - `.js` subpaths resolve only under Node, and have no type declarations
// createRequire satisfies both — CJS resolution infers the extension — at the
// cost of the calendar/locale objects being untyped. They are opaque config
// passed straight into DateObject, so nothing meaningful is lost.
// (lib/leave/dateConvert.ts can use plain imports: it is app-only.)
import { createRequire } from 'node:module';
import DateObjectModule from 'react-date-object';

const req = createRequire(import.meta.url);
const persian = req('react-date-object/calendars/persian');
const persian_en = req('react-date-object/locales/persian_en');
const gregorian = req('react-date-object/calendars/gregorian');
const gregorian_en = req('react-date-object/locales/gregorian_en');

// Under Node ESM the CJS default arrives wrapped; under bundler resolution it does not.
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
