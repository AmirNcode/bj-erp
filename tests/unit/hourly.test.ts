import { describe, it, expect } from 'vitest';
import {
  timeToMinutes,
  minutesToTime,
  rangeMinutes,
  isWithinWindow,
  rangesOverlap,
  leavePeriodsOverlap,
  timeSlots,
  hourlyDayTotal,
} from '@/lib/leave/hourly';

const WINDOW = { start: '07:00', end: '15:00' };

describe('timeToMinutes / minutesToTime', () => {
  it('converts HH:MM', () => {
    expect(timeToMinutes('09:30')).toBe(570);
    expect(minutesToTime(570)).toBe('09:30');
  });

  it('tolerates the HH:MM:SS Postgres returns', () => {
    expect(timeToMinutes('09:30:00')).toBe(570);
  });

  it('pads single digits', () => {
    expect(minutesToTime(420)).toBe('07:00');
    expect(minutesToTime(5)).toBe('00:05');
  });

  it('round-trips every half-hour slot', () => {
    for (let m = 0; m < 1440; m += 30) {
      expect(timeToMinutes(minutesToTime(m))).toBe(m);
    }
  });
});

describe('rangeMinutes', () => {
  it('measures a normal range', () => {
    expect(rangeMinutes({ start: '09:00', end: '11:00' })).toBe(120);
    expect(rangeMinutes({ start: '09:15', end: '09:45' })).toBe(30);
  });

  it('returns 0 for a reversed or empty range', () => {
    expect(rangeMinutes({ start: '11:00', end: '09:00' })).toBe(0);
    expect(rangeMinutes({ start: '09:00', end: '09:00' })).toBe(0);
  });
});

describe('isWithinWindow', () => {
  it('accepts a range inside the window', () => {
    expect(isWithinWindow({ start: '09:00', end: '11:00' }, WINDOW)).toBe(true);
  });

  it('accepts a range exactly equal to the window', () => {
    expect(isWithinWindow(WINDOW, WINDOW)).toBe(true);
  });

  it('rejects a range starting before the window', () => {
    expect(isWithinWindow({ start: '06:30', end: '09:00' }, WINDOW)).toBe(false);
  });

  it('rejects a range ending after the window', () => {
    expect(isWithinWindow({ start: '14:00', end: '16:00' }, WINDOW)).toBe(false);
  });
});

describe('rangesOverlap', () => {
  it('detects a partial overlap', () => {
    expect(rangesOverlap({ start: '09:00', end: '11:00' }, { start: '10:00', end: '12:00' })).toBe(
      true
    );
  });

  it('treats touching ends as adjacent, NOT overlapping', () => {
    // Two errands in one day must not block each other on a boundary.
    expect(rangesOverlap({ start: '08:00', end: '10:00' }, { start: '10:00', end: '12:00' })).toBe(
      false
    );
  });

  it('detects containment and identity', () => {
    expect(rangesOverlap({ start: '09:00', end: '12:00' }, { start: '10:00', end: '11:00' })).toBe(
      true
    );
    expect(rangesOverlap({ start: '09:00', end: '11:00' }, { start: '09:00', end: '11:00' })).toBe(
      true
    );
  });

  it('returns false for disjoint ranges', () => {
    expect(rangesOverlap({ start: '08:00', end: '09:00' }, { start: '13:00', end: '14:00' })).toBe(
      false
    );
  });
});

describe('leavePeriodsOverlap', () => {
  const hourly = (startTime: string, endTime: string) => ({
    startDate: '2026-07-30',
    endDate: '2026-07-30',
    unit: 'hour' as const,
    startTime,
    endTime,
  });

  it('allows two hourly requests on the same date when their times do not overlap', () => {
    expect(leavePeriodsOverlap(hourly('08:00', '10:00'), hourly('10:00', '12:00'))).toBe(false);
  });

  it('detects hourly intersection and daily-vs-hourly conflict', () => {
    expect(leavePeriodsOverlap(hourly('08:00', '10:30'), hourly('10:00', '12:00'))).toBe(true);
    expect(
      leavePeriodsOverlap(
        {
          startDate: '2026-07-30',
          endDate: '2026-07-30',
          unit: 'day',
          startTime: null,
          endTime: null,
        },
        hourly('10:00', '12:00')
      )
    ).toBe(true);
  });

  it('rejects date-disjoint periods before comparing times', () => {
    expect(
      leavePeriodsOverlap(hourly('08:00', '12:00'), {
        ...hourly('08:00', '12:00'),
        startDate: '2026-07-31',
        endDate: '2026-07-31',
      })
    ).toBe(false);
  });
});

describe('timeSlots', () => {
  it('covers the window inclusively at the given step', () => {
    const slots = timeSlots(WINDOW, 30);
    expect(slots).toHaveLength(17); // 07:00 … 15:00 inclusive
    expect(slots[0]).toBe('07:00');
    expect(slots[slots.length - 1]).toBe('15:00');
    expect(slots).toContain('11:30');
  });

  it('returns an empty list for a reversed window', () => {
    expect(timeSlots({ start: '15:00', end: '07:00' }, 30)).toEqual([]);
  });
});

describe('hourlyDayTotal', () => {
  it('sums the day', () => {
    expect(hourlyDayTotal(120, 120)).toBe(240);
    expect(hourlyDayTotal(0, 60)).toBe(60);
  });
});
