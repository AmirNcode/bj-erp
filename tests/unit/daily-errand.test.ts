import { describe, expect, it } from 'vitest';
import { countCalendarDays } from '@/lib/leave/dailyErrand';

describe('countCalendarDays', () => {
  it('counts a one-day errand', () => {
    expect(countCalendarDays('2026-08-05', '2026-08-05')).toBe(1);
  });

  it('counts an inclusive range across a month boundary', () => {
    expect(countCalendarDays('2026-08-30', '2026-09-02')).toBe(4);
  });

  it('rejects reversed or invalid ranges', () => {
    expect(countCalendarDays('2026-08-06', '2026-08-05')).toBe(0);
    expect(countCalendarDays('not-a-date', '2026-08-05')).toBe(0);
  });
});
