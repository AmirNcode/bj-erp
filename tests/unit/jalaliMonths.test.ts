import { describe, it, expect } from 'vitest';
import DateObject from 'react-date-object';
import gregorian from 'react-date-object/calendars/gregorian';
import gregorian_en from 'react-date-object/locales/gregorian_en';
import persian from 'react-date-object/calendars/persian';
import persian_en from 'react-date-object/locales/persian_en';
import { buildJalaliMonths } from '@/lib/leave/jalaliMonths';
import { firstMonthStartAfter } from '@/lib/leave/dateConvert';

const rows = buildJalaliMonths(1400, 1450);

function daysBetween(a: string, b: string): number {
  return (Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000;
}

describe('buildJalaliMonths', () => {
  it('produces 12 months for every year in the range', () => {
    expect(rows).toHaveLength(51 * 12);
    expect(rows[0]).toMatchObject({ jalaliYear: 1400, jalaliMonth: 1 });
    expect(rows[rows.length - 1]).toMatchObject({ jalaliYear: 1450, jalaliMonth: 12 });
  });

  it('is contiguous — each month starts the day after the previous month ends', () => {
    for (let i = 1; i < rows.length; i++) {
      expect(daysBetween(rows[i - 1].gregorianEnd, rows[i].gregorianStart)).toBe(1);
    }
  });

  it('round-trips: each gregorianStart converts back to day 1 of that Jalali month', () => {
    for (const row of rows) {
      const [y, m, d] = row.gregorianStart.split('-').map(Number);
      const back = new DateObject({
        calendar: gregorian,
        locale: gregorian_en,
        year: y,
        month: m,
        day: d,
      }).convert(persian, persian_en);
      expect(back.year).toBe(row.jalaliYear);
      expect(back.month.number).toBe(row.jalaliMonth);
      expect(back.day).toBe(1);
    }
  });

  it('starts every Jalali year in March', () => {
    for (const row of rows.filter((r) => r.jalaliMonth === 1)) {
      expect(Number(row.gregorianStart.split('-')[1])).toBe(3);
    }
  });

  it('gives every month a plausible length', () => {
    for (const row of rows) {
      const len = daysBetween(row.gregorianStart, row.gregorianEnd) + 1;
      expect(len).toBeGreaterThanOrEqual(29);
      expect(len).toBeLessThanOrEqual(31);
    }
  });
});

describe('firstMonthStartAfter', () => {
  it('returns 1 Aban for a date in Mehr', () => {
    // 2026-10-05 = 13 Mehr 1405; 1 Aban 1405 = 2026-10-23.
    expect(firstMonthStartAfter('2026-10-05')).toBe('2026-10-23');
  });
  it('treats the first and last day of a month alike', () => {
    expect(firstMonthStartAfter('2026-09-23')).toBe('2026-10-23'); // 1 Mehr
    expect(firstMonthStartAfter('2026-10-22')).toBe('2026-10-23'); // 30 Mehr
  });
  it('crosses the Jalali new year', () => {
    // 2027-03-20 = 29 Esfand 1405 → 1 Farvardin 1406 = 2027-03-21.
    expect(firstMonthStartAfter('2027-03-20')).toBe('2027-03-21');
  });
  it('rejects a malformed date', () => {
    expect(firstMonthStartAfter('1405/07/13')).toBeNull();
  });
  it('agrees with the generated jalali_months table at both ends of every month of 1404–1406', () => {
    const months = buildJalaliMonths(1404, 1406);
    for (let i = 0; i + 1 < months.length; i++) {
      for (const iso of [months[i].gregorianStart, months[i].gregorianEnd]) {
        expect(firstMonthStartAfter(iso)).toBe(months[i + 1].gregorianStart);
      }
    }
  });
});
