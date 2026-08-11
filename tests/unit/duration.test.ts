import { describe, it, expect } from 'vitest';
import {
  minutesToDaysHours,
  formatDuration,
  daysToMinutes,
  projectLeaveBalance,
} from '@/lib/leave/duration';

const EN = { days: 'days', hours: 'hours', minutes: 'minutes', and: 'and' };

describe('minutesToDaysHours', () => {
  it('splits a whole number of days', () => {
    expect(minutesToDaysHours(4320, 8)).toEqual({ days: 9, hours: 0, minutes: 0 });
  });

  it('splits days plus hours — the client 9d4h case', () => {
    expect(minutesToDaysHours(4560, 8)).toEqual({ days: 9, hours: 4, minutes: 0 });
  });

  it('splits a bare part-hour', () => {
    expect(minutesToDaysHours(90, 8)).toEqual({ days: 0, hours: 1, minutes: 30 });
  });

  it('handles zero', () => {
    expect(minutesToDaysHours(0, 8)).toEqual({ days: 0, hours: 0, minutes: 0 });
  });

  it('handles a non-integer workday', () => {
    // 7.5h day = 450 min. 1000 min = 2 days (900) + 1h40m.
    expect(minutesToDaysHours(1000, 7.5)).toEqual({ days: 2, hours: 1, minutes: 40 });
  });

  it('keeps the sign of a negative delta and splits its magnitude', () => {
    expect(minutesToDaysHours(-480, 8)).toEqual({ days: -1, hours: 0, minutes: 0 });
  });
});

describe('formatDuration', () => {
  it('omits zero parts', () => {
    expect(formatDuration(4320, 8, 'en', EN)).toBe('9 days');
    expect(formatDuration(240, 8, 'en', EN)).toBe('4 hours');
  });

  it('joins days and hours', () => {
    expect(formatDuration(4560, 8, 'en', EN)).toBe('9 days and 4 hours');
  });

  it('joins all three parts', () => {
    expect(formatDuration(4590, 8, 'en', EN)).toBe('9 days and 4 hours and 30 minutes');
  });

  it('renders zero as zero days rather than an empty string', () => {
    expect(formatDuration(0, 8, 'en', EN)).toBe('0 days');
  });

  it('shapes Persian digits', () => {
    const FA = { days: 'روز', hours: 'ساعت', minutes: 'دقیقه', and: 'و' };
    expect(formatDuration(4560, 8, 'fa', FA)).toBe('۹ روز و ۴ ساعت');
  });
});

describe('daysToMinutes', () => {
  it('converts whole and half days', () => {
    expect(daysToMinutes(9, 8)).toBe(4320);
    expect(daysToMinutes(0.5, 8)).toBe(240);
  });

  it('rounds to a whole minute', () => {
    // 1/7 of an 8h day = 68.57 min -> 69.
    expect(daysToMinutes(1 / 7, 8)).toBe(69);
  });
});

describe('projectLeaveBalance', () => {
  it('subtracts a request from the current paid balance', () => {
    expect(projectLeaveBalance(4 * 480, 20 * 480 + 240)).toEqual({
      requestingMinutes: 1920,
      remainingMinutes: 16 * 480 + 240,
      unpaidMinutes: 0,
    });
  });

  it('splits an over-balance request at eight hours per day', () => {
    // Requesting 4 days (32h) from 3 days + 4h (28h) leaves 4h unpaid.
    expect(projectLeaveBalance(4 * 480, 3 * 480 + 240)).toEqual({
      requestingMinutes: 1920,
      remainingMinutes: 0,
      unpaidMinutes: 240,
    });
  });

  it('never projects a negative paid balance', () => {
    expect(projectLeaveBalance(60, -120)).toEqual({
      requestingMinutes: 60,
      remainingMinutes: 0,
      unpaidMinutes: 60,
    });
  });
});
