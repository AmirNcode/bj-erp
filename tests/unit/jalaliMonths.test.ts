import { describe, it, expect } from 'vitest';
import DateObject from 'react-date-object';
import gregorian from 'react-date-object/calendars/gregorian';
import gregorian_en from 'react-date-object/locales/gregorian_en';
import persian from 'react-date-object/calendars/persian';
import persian_en from 'react-date-object/locales/persian_en';
import { buildJalaliMonths } from '@/lib/leave/jalaliMonths';

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
