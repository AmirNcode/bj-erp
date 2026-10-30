import { describe, expect, it } from 'vitest';
import { alternatingDaysOff, type WeekendRule } from '@/lib/leave/weekend';

// 2026-10-22 (1405/07/30) is a Thursday and an off Thursday, as in Settings.
const rule: WeekendRule = { weekendDays: [5], biweeklyWeekendDays: [4], biweeklyAnchor: '2026-10-22' };

describe('alternatingDaysOff', () => {
  it('today is the day and off: today is the answer', () => {
    expect(alternatingDaysOff('2026-11-05', rule)).toEqual([
      { weekday: 4, upcoming: '2026-11-05', upcomingOff: true, nextOff: '2026-11-05' },
    ]);
  });

  it('today is the day and worked: the next off one is a week later', () => {
    expect(alternatingDaysOff('2026-10-29', rule)).toEqual([
      { weekday: 4, upcoming: '2026-10-29', upcomingOff: false, nextOff: '2026-11-05' },
    ]);
  });

  it('mid-week looks at the coming Thursday', () => {
    // Saturday 2026-10-31 → Thursday 2026-11-05 (off).
    expect(alternatingDaysOff('2026-10-31', rule)[0]).toMatchObject({
      upcoming: '2026-11-05',
      upcomingOff: true,
    });
    // Friday 2026-10-23 → Thursday 2026-10-29 (worked).
    expect(alternatingDaysOff('2026-10-23', rule)[0]).toMatchObject({
      upcoming: '2026-10-29',
      upcomingOff: false,
      nextOff: '2026-11-05',
    });
  });

  it('a starting date in the future still sets the parity before it', () => {
    const future = { ...rule, biweeklyAnchor: '2026-12-03' }; // 6 weeks after 2026-10-22
    expect(alternatingDaysOff('2026-10-22', future)[0]).toMatchObject({ upcomingOff: true });
    expect(alternatingDaysOff('2026-10-29', future)[0]).toMatchObject({
      upcomingOff: false,
      nextOff: '2026-11-05',
    });
  });

  it('no every-other-week day (or no starting date) gives nothing', () => {
    expect(alternatingDaysOff('2026-10-29', { weekendDays: [5] })).toEqual([]);
    expect(alternatingDaysOff('2026-10-29', { ...rule, biweeklyAnchor: null })).toEqual([]);
    expect(alternatingDaysOff('bad', rule)).toEqual([]);
  });

  it('several days give one entry each, soonest first', () => {
    // Saturday 2026-10-31 starts the next Saturday-aligned week, the off one.
    const two = { ...rule, biweeklyWeekendDays: [4, 6] };
    expect(alternatingDaysOff('2026-10-29', two).map((d) => [d.upcoming, d.upcomingOff])).toEqual([
      ['2026-10-29', false],
      ['2026-10-31', true],
    ]);
  });
});
