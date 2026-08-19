/**
 * The shared typed-date reader (`lib/leave/parseUserDate.ts`).
 *
 * This is the single point where a date somebody TYPED becomes a date the
 * database stores, so it carries the whole burden of rejecting dates that do not
 * exist. Both CSV importers delegate here; their own suites cover the surrounding
 * row validation rather than repeating this.
 */
import { describe, it, expect } from 'vitest';
import { parseUserDate, PERSIAN_YEAR_CEILING } from '@/lib/leave/parseUserDate';

describe('parseUserDate — calendar detection', () => {
  it('reads a Persian date and returns Gregorian ISO', () => {
    expect(parseUserDate('1404/04/22')).toBe('2025-07-13');
    expect(parseUserDate('1405/01/01')).toBe('2026-03-21'); // Nowruz
  });

  it('passes a Gregorian date through, with either separator', () => {
    expect(parseUserDate('2025-07-13')).toBe('2025-07-13');
    expect(parseUserDate('2025/07/13')).toBe('2025-07-13');
  });

  it('switches calendar at the year ceiling', () => {
    expect(PERSIAN_YEAR_CEILING).toBe(1600);
    expect(parseUserDate('1599/01/01')).not.toBe('1599-01-01'); // read as Persian
    expect(parseUserDate('1600/01/01')).toBe('1600-01-01'); // read as Gregorian
  });

  it('normalizes Persian digits', () => {
    expect(parseUserDate('۱۴۰۴/۰۴/۲۲')).toBe('2025-07-13');
  });

  it('accepts single-digit month and day, and surrounding whitespace', () => {
    expect(parseUserDate('1405/1/1')).toBe('2026-03-21');
    expect(parseUserDate('  1405/01/01  ')).toBe('2026-03-21');
  });
});

describe('parseUserDate — rejecting dates that do not exist', () => {
  it('rejects an out-of-range day rather than rolling it forward', () => {
    // The reason this function exists. `DateObject.isValid` NORMALISES an
    // out-of-range day and still returns true, so every one of these was
    // previously accepted and stored as a different date, silently:
    //
    //   2026-02-30  -> 2026-03-02
    //   2026-04-31  -> 2026-05-01
    //   1405/07/31  -> 1405/08/01   (Mehr has 30 days)
    //   1405/12/30  -> 1406/01/01   (Esfand has 29 days in 1405)
    //
    // The last one crosses a Persian YEAR, which is what makes "it's only a day
    // out" the wrong intuition.
    expect(parseUserDate('2026-02-30')).toBeUndefined();
    expect(parseUserDate('2026-04-31')).toBeUndefined();
    expect(parseUserDate('2026-02-29')).toBeUndefined(); // 2026 is not a leap year
    expect(parseUserDate('1405/07/31')).toBeUndefined();
    expect(parseUserDate('1405/12/30')).toBeUndefined();
    expect(parseUserDate('1404/12/30')).toBeUndefined();
  });

  it('accepts genuine month-end dates that a naive day cap would break', () => {
    // Persian months 1-6 have 31 days; 7-11 have 30; Esfand has 29, or 30 in a
    // leap year. 1403 is a leap year and 1404/1405 are not.
    expect(parseUserDate('1405/06/31')).toBe('2026-09-22');
    expect(parseUserDate('1405/07/30')).toBe('2026-10-22');
    expect(parseUserDate('1403/12/30')).toBe('2025-03-20');
    expect(parseUserDate('1404/12/29')).toBe('2026-03-20'); // last day of 1404
    // Gregorian leap day.
    expect(parseUserDate('2024-02-29')).toBe('2024-02-29');
    expect(parseUserDate('2026-01-31')).toBe('2026-01-31');
  });

  it('rejects an impossible month before reaching the calendar at all', () => {
    expect(parseUserDate('1404/13/01')).toBeUndefined();
    expect(parseUserDate('2026-00-01')).toBeUndefined();
    expect(parseUserDate('2026-01-00')).toBeUndefined();
    expect(parseUserDate('2026-01-32')).toBeUndefined();
  });

  it('rejects anything that is not a date at all', () => {
    expect(parseUserDate('yesterday')).toBeUndefined();
    expect(parseUserDate('14050101')).toBeUndefined();
    expect(parseUserDate('1405/01')).toBeUndefined();
    expect(parseUserDate('05/01/1405')).toBeUndefined(); // day-first is not accepted
  });

  it('returns null for an empty cell, so callers decide if the field is required', () => {
    expect(parseUserDate('')).toBeNull();
    expect(parseUserDate('   ')).toBeNull();
    // Defensive: the CSV readers can hand back an absent cell.
    expect(parseUserDate(undefined as unknown as string)).toBeNull();
  });
});

describe('parseUserDate — dates outside the app’s accrual calendar', () => {
  it('converts Persian years long before jalali_months begins', () => {
    // `jalali_months` covers 1400-1450 and bounds which months leave can be
    // ACCRUED for. It is NOT consulted here, so an employee with decades of
    // service is enterable. Confirmed end to end against the database: a hire
    // date of 1355/01/01 created and accrued correctly.
    expect(parseUserDate('1380/05/15')).toBe('2001-08-06');
    expect(parseUserDate('1355/01/01')).toBe('1976-03-21');
    expect(parseUserDate('1340/12/29')).toBe('1962-03-20');
    expect(parseUserDate('1300/01/01')).toBe('1921-03-21');
  });

  it('converts Persian years beyond it too', () => {
    expect(parseUserDate('1460/01/01')).toBe('2081-03-20');
  });
});
