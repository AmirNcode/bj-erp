import { describe, expect, it } from 'vitest';
import { addDays, daysBetween } from '@/lib/leave/isoDate';

describe('addDays', () => {
  it('moves across month and year ends in either direction', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('returns a malformed date unchanged', () => {
    expect(addDays('not-a-date', 3)).toBe('not-a-date');
  });
});

describe('daysBetween', () => {
  it('counts whole days, negative when reversed', () => {
    expect(daysBetween('2026-10-01', '2026-10-31')).toBe(30);
    expect(daysBetween('2026-10-31', '2026-10-01')).toBe(-30);
  });

  it('is 0 for a malformed date', () => {
    expect(daysBetween('x', '2026-10-01')).toBe(0);
  });
});
