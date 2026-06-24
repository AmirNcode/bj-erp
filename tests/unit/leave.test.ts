import { describe, it, expect } from 'vitest';
import DateObject from 'react-date-object';
import persian from 'react-date-object/calendars/persian';
import persian_fa from 'react-date-object/locales/persian_fa';
import gregorian from 'react-date-object/calendars/gregorian';
import gregorian_en from 'react-date-object/locales/gregorian_en';
import { dateObjectToGregorian, isHalfDayAllowed } from '@/lib/leave/dateConvert';

describe('dateObjectToGregorian', () => {
  it('converts a Persian DateObject (1403/04/01) to Gregorian 2024-06-21', () => {
    const jalaliDate = new DateObject({
      calendar: persian,
      locale: persian_fa,
      date: new Date(2024, 5, 21), // construct via known Gregorian anchor
    });
    // Override to Jalali 1403/04/01 explicitly
    const d = new DateObject({ calendar: persian, locale: persian_fa, year: 1403, month: 4, day: 1 });
    expect(dateObjectToGregorian(d)).toBe('2024-06-21');
  });

  it('converts a Gregorian DateObject (2026/06/27) to 2026-06-27 (no-op path)', () => {
    const d = new DateObject({ calendar: gregorian, locale: gregorian_en, year: 2026, month: 6, day: 27 });
    expect(dateObjectToGregorian(d)).toBe('2026-06-27');
  });
});

describe('isHalfDayAllowed', () => {
  it('returns true when allow_half_day=true and single-day range', () => {
    expect(isHalfDayAllowed(true, '2026-06-23', '2026-06-23')).toBe(true);
  });

  it('returns false when allow_half_day=false even for single-day', () => {
    expect(isHalfDayAllowed(false, '2026-06-23', '2026-06-23')).toBe(false);
  });

  it('returns false when allow_half_day=true but multi-day range', () => {
    expect(isHalfDayAllowed(true, '2026-06-23', '2026-06-24')).toBe(false);
  });

  it('returns false when allow_half_day=false and multi-day range', () => {
    expect(isHalfDayAllowed(false, '2026-06-23', '2026-06-25')).toBe(false);
  });
});
