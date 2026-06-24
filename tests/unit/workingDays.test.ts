import { describe, it, expect } from 'vitest';
import { countWorkingDays } from '@/lib/leave/workingDays';

// Verified weekdays (UTC parsing, ISO Mon=1..Sun=7):
// 2026-06-23 = Tuesday (iso 2) — working day
// 2026-06-24 = Wednesday (iso 3) — working day
// 2026-06-25 = Thursday (iso 4) — working day
// 2026-06-26 = Friday (iso 5) — weekend (weekendDays=[5])
// 2026-06-27 = Saturday (iso 6) — working day (not in weekendDays=[5])

const W = { weekendDays: [5], holidays: [] as string[] };

describe('countWorkingDays', () => {
  it('single working day (full) = 1', () => {
    // 2026-06-23 is Tuesday → working day
    expect(countWorkingDays('2026-06-23', '2026-06-23', { ...W, dayPart: 'full' })).toBe(1);
  });

  it('half day (am) on a working day = 0.5', () => {
    // 2026-06-23 is Tuesday → working day, half-day returns 0.5
    expect(countWorkingDays('2026-06-23', '2026-06-23', { ...W, dayPart: 'am' })).toBe(0.5);
  });

  it('half day (pm) on a working day = 0.5', () => {
    // 2026-06-23 is Tuesday → working day, half-day returns 0.5
    expect(countWorkingDays('2026-06-23', '2026-06-23', { ...W, dayPart: 'pm' })).toBe(0.5);
  });

  it('range that skips Friday = 2 (Thu + Sat, Fri excluded)', () => {
    // 2026-06-25 Thu, 2026-06-26 Fri (weekend, skipped), 2026-06-27 Sat → 2 working days
    expect(countWorkingDays('2026-06-25', '2026-06-27', { ...W, dayPart: 'full' })).toBe(2);
  });

  it('holiday excluded from count', () => {
    // 2026-06-23 Tue (working), 2026-06-24 Wed (holiday → excluded) → 1
    expect(
      countWorkingDays('2026-06-23', '2026-06-24', {
        weekendDays: [5],
        holidays: ['2026-06-24'],
        dayPart: 'full',
      })
    ).toBe(1);
  });

  it('half day on a weekend day = 0', () => {
    // 2026-06-26 is Friday (iso 5) → weekend → 0
    expect(countWorkingDays('2026-06-26', '2026-06-26', { ...W, dayPart: 'am' })).toBe(0);
  });

  it('half day on a holiday = 0', () => {
    // 2026-06-23 Tue is a holiday → not a working day → 0
    expect(
      countWorkingDays('2026-06-23', '2026-06-23', {
        weekendDays: [5],
        holidays: ['2026-06-23'],
        dayPart: 'am',
      })
    ).toBe(0);
  });

  it('half day with start ≠ end = 0 (invalid for half-day)', () => {
    // Half-day only valid for single-day range; multi-day returns 0
    expect(countWorkingDays('2026-06-23', '2026-06-24', { ...W, dayPart: 'am' })).toBe(0);
  });

  it('reversed range (end < start) = 0', () => {
    expect(countWorkingDays('2026-06-27', '2026-06-23', { ...W, dayPart: 'full' })).toBe(0);
  });

  it('multi-day range with all days working = exact count', () => {
    // 2026-06-23 Tue, 2026-06-24 Wed → 2 working days, no weekends/holidays
    expect(countWorkingDays('2026-06-23', '2026-06-24', { ...W, dayPart: 'full' })).toBe(2);
  });

  it('range spanning multiple weeks counts correctly', () => {
    // Mon 2026-06-22 through Sun 2026-06-28 = Mon,Tue,Wed,Thu,Sat,Sun = 6 (Fri=26 skipped)
    expect(countWorkingDays('2026-06-22', '2026-06-28', { ...W, dayPart: 'full' })).toBe(6);
  });

  it('invalid date string returns 0', () => {
    // Malformed input → NaN → guard returns 0
    expect(countWorkingDays('not-a-date', '2026-06-25', { ...W, dayPart: 'full' })).toBe(0);
  });
});
