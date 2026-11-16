import { describe, expect, it } from 'vitest';
import { lunchOverlapMinutes, netHourlyMinutes } from '@/lib/leave/hourly';
import { validateLunchBreak } from '@/lib/leave/settings-validation';

// FR-93: mirrors private.lunch_overlap_minutes (tests/sql/lunch-break.sql covers the SQL side).
const lunch = { start: '13:00', minutes: 60 };

describe('lunchOverlapMinutes', () => {
  it.each([
    ['08:00', '12:00', 0],
    ['14:00', '16:00', 0],
    ['12:00', '13:00', 0],
    ['12:00', '15:00', 60],
    ['12:30', '13:30', 30],
    ['13:30', '15:00', 30],
    ['13:00', '14:00', 60],
    ['13:15', '13:45', 30],
    ['15:00', '12:00', 0],
  ])('%s-%s overlaps %i min', (start, end, want) => {
    expect(lunchOverlapMinutes({ start, end }, lunch)).toBe(want);
  });

  it('is 0 with no lunch break', () => {
    expect(lunchOverlapMinutes({ start: '12:00', end: '15:00' }, { start: '13:00', minutes: 0 })).toBe(0);
  });

  it('reads Postgres HH:MM:SS times', () => {
    expect(lunchOverlapMinutes({ start: '12:00:00', end: '15:00:00' }, { start: '13:00:00', minutes: 60 })).toBe(60);
  });
});

describe('netHourlyMinutes', () => {
  it('subtracts the lunch break inside the range', () => {
    expect(netHourlyMinutes({ start: '12:00', end: '15:00' }, lunch)).toBe(120);
    expect(netHourlyMinutes({ start: '11:00', end: '16:00' }, lunch)).toBe(240);
  });
  it('is 0 for a request wholly inside lunch', () => {
    expect(netHourlyMinutes({ start: '13:00', end: '14:00' }, lunch)).toBe(0);
  });
  it('is 0 for a reversed range', () => {
    expect(netHourlyMinutes({ start: '15:00', end: '12:00' }, lunch)).toBe(0);
  });
});

describe('validateLunchBreak', () => {
  it('accepts a break inside the window', () => {
    expect(validateLunchBreak('08:00', '17:00', '13:00', 60)).toEqual({ ok: true, lunchStart: '13:00', lunchMinutes: 60 });
    expect(validateLunchBreak('08:00', '17:00', '16:00', 60).ok).toBe(true);
  });
  it('accepts no break anywhere', () => {
    expect(validateLunchBreak('08:00', '17:00', '07:00', 0).ok).toBe(true);
  });
  it.each([
    ['07:00', 60],
    ['16:30', 60],
    ['13:00', 181],
    ['13:00', -5],
    ['13:00', 30.5],
    ['1pm', 60],
  ])('refuses %s for %s min', (start, minutes) => {
    expect(validateLunchBreak('08:00', '17:00', start as string, minutes as number).ok).toBe(false);
  });
});
