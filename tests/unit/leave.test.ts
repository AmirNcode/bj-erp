import { describe, it, expect } from 'vitest';
import { isHalfDayAllowed } from '@/lib/leave/dateConvert';

// We test the pure predicates only (DateObject conversion is a thin wrapper around the library).

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
