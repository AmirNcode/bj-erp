import { describe, expect, it } from 'vitest';
import { returnToWork } from '@/lib/leave/returnToWork';
import { nextWorkingDay } from '@/lib/leave/weekend';

// The client's week: Friday off every week, Thursday off every other week (FR-41).
// 2026-10-16 is a Friday; anchor 2026-10-15 makes that Thursday an off week.
const settings = {
  weekendDays: [5],
  biweeklyWeekendDays: [4],
  biweeklyAnchor: '2026-10-15',
  holidays: ['2026-10-17'],
  workStart: '07:00',
  workEnd: '15:00',
};

describe('nextWorkingDay', () => {
  it('skips weekly and fortnightly weekends and holidays', () => {
    // Wed 14 → Thu 15 (off week) → Fri 16 (weekend) → Sat 17 (holiday) → Sun 18.
    expect(nextWorkingDay('2026-10-14', settings)).toBe('2026-10-18');
  });
  it('keeps the Thursday of a working week', () => {
    expect(nextWorkingDay('2026-10-21', settings)).toBe('2026-10-22');
  });
  it('gives up instead of looping when every day is off', () => {
    expect(nextWorkingDay('2026-10-14', { ...settings, weekendDays: [1, 2, 3, 4, 5, 6, 7] })).toBeNull();
  });
});

describe('returnToWork', () => {
  it('full days: the next working day after the last day', () => {
    expect(returnToWork({ unit: 'day', dayPart: 'full', end: '2026-10-14' }, settings)).toEqual({ date: '2026-10-18', time: null });
  });
  it('morning off: back the same day at midday', () => {
    expect(returnToWork({ unit: 'day', dayPart: 'am', end: '2026-10-18' }, settings)).toEqual({ date: '2026-10-18', time: '11:00' });
  });
  it('afternoon off: next working day', () => {
    expect(returnToWork({ unit: 'day', dayPart: 'pm', end: '2026-10-18' }, settings)).toEqual({ date: '2026-10-19', time: null });
  });
  it('hourly: back the same day at the end time', () => {
    expect(returnToWork({ unit: 'hour', end: '2026-10-18', endTime: '10:30' }, settings)).toEqual({ date: '2026-10-18', time: '10:30' });
  });
  it('hourly ending at or after work end: next working day', () => {
    expect(returnToWork({ unit: 'hour', end: '2026-10-18', endTime: '15:00' }, settings)).toEqual({ date: '2026-10-19', time: null });
    expect(returnToWork({ unit: 'hour', end: '2026-10-18', endTime: '20:00' }, settings)).toEqual({ date: '2026-10-19', time: null });
  });
  it('early errand before work starts: back at the start of work', () => {
    expect(returnToWork({ unit: 'hour', end: '2026-10-18', endTime: '06:00' }, settings)).toEqual({ date: '2026-10-18', time: '07:00' });
  });
  it('hourly errand on a day off: next working day', () => {
    expect(returnToWork({ unit: 'hour', end: '2026-10-16', endTime: '10:00' }, settings)).toEqual({ date: '2026-10-18', time: null });
  });
  it('returns null for missing input', () => {
    expect(returnToWork({ unit: 'hour', end: '2026-10-18', endTime: null }, settings)).toBeNull();
    expect(returnToWork({ unit: 'day', end: '' }, settings)).toBeNull();
  });
});

describe('formatLongPersianDate', () => {
  it('reads naturally in Farsi and English', async () => {
    const { formatLongPersianDate } = await import('@/lib/i18n/format');
    expect(formatLongPersianDate('2026-10-28', 'fa')).toBe('چهارشنبه ۶ آبان ۱۴۰۵');
    expect(formatLongPersianDate('2026-10-28', 'en')).toBe('Wednesday, Aban 6, 1405 AP');
  });
});
