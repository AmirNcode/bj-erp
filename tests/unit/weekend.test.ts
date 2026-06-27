import { describe, it, expect } from 'vitest';
import { validateWeekendDays, WEEKDAYS } from '@/lib/leave/weekend';

describe('WEEKDAYS', () => {
  it('lists 7 days in Sat..Fri display order (ISO numbers)', () => {
    expect(WEEKDAYS.map((d) => d.iso)).toEqual([6, 7, 1, 2, 3, 4, 5]);
  });
});

describe('validateWeekendDays', () => {
  it('accepts the default Friday-only and dedupes/sorts', () => {
    expect(validateWeekendDays([5])).toEqual({ ok: true, days: [5] });
    expect(validateWeekendDays([5, 5, 4])).toEqual({ ok: true, days: [4, 5] });
  });
  it('rejects out-of-range weekday numbers', () => {
    expect(validateWeekendDays([0])).toEqual({ ok: false, reason: 'out_of_range' });
    expect(validateWeekendDays([8])).toEqual({ ok: false, reason: 'out_of_range' });
  });
  it('rejects marking every day a weekend', () => {
    expect(validateWeekendDays([1, 2, 3, 4, 5, 6, 7])).toEqual({ ok: false, reason: 'all_week' });
  });
});
