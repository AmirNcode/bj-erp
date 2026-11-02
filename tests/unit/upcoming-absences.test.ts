import { describe, it, expect } from 'vitest';
import { upcomingAbsenceWindow, UPCOMING_ABSENCE_DAYS } from '@/lib/absences/upcoming';

describe('upcomingAbsenceWindow', () => {
  it('starts today and ends 30 days out', () => {
    expect(UPCOMING_ABSENCE_DAYS).toBe(30);
    expect(upcomingAbsenceWindow('2026-11-02')).toEqual({ from: '2026-11-02', to: '2026-12-02' });
  });

  it('crosses a year end', () => {
    expect(upcomingAbsenceWindow('2026-12-20', 30)).toEqual({ from: '2026-12-20', to: '2027-01-19' });
  });
});
