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

  // ── FR-41: a weekday off every OTHER week ────────────────────────────────
  //
  // These four numbers were produced by public.compute_requested_minutes on the
  // live database first (24 / 20 / 22 working days over the same range) and are
  // asserted here so the TS mirror cannot drift from the SQL that actually
  // charges the ledger. Range: Sun 2026-08-16 .. Sat 2026-09-12, 28 days.
  describe('bi-weekly weekend days', () => {
    const RANGE = ['2026-08-16', '2026-09-12'] as const;
    const base = { holidays: [] as string[], dayPart: 'full' as const };

    it('matches SQL for Friday only: 24 working days', () => {
      expect(countWorkingDays(...RANGE, { ...base, weekendDays: [5] })).toBe(24);
    });

    it('matches SQL for Thursday AND Friday every week: 20', () => {
      expect(countWorkingDays(...RANGE, { ...base, weekendDays: [4, 5] })).toBe(20);
    });

    it('matches SQL for Thursday every OTHER week: 22, exactly between', () => {
      expect(
        countWorkingDays(...RANGE, {
          ...base,
          weekendDays: [5],
          biweeklyWeekendDays: [4],
          biweeklyAnchor: '2026-08-20',
        })
      ).toBe(22);
    });

    it('charges nothing for a single day on an OFF Thursday', () => {
      expect(
        countWorkingDays('2026-08-20', '2026-08-20', {
          ...base,
          weekendDays: [5],
          biweeklyWeekendDays: [4],
          biweeklyAnchor: '2026-08-20',
        })
      ).toBe(0);
    });

    it('charges a full day on a WORKED Thursday', () => {
      expect(
        countWorkingDays('2026-08-27', '2026-08-27', {
          ...base,
          weekendDays: [5],
          biweeklyWeekendDays: [4],
          biweeklyAnchor: '2026-08-20',
        })
      ).toBe(1);
    });

    it('refuses a half-day on an OFF Thursday and allows one on a worked Thursday', () => {
      const rule = {
        weekendDays: [5],
        biweeklyWeekendDays: [4],
        biweeklyAnchor: '2026-08-20',
        holidays: [] as string[],
      };
      expect(countWorkingDays('2026-08-20', '2026-08-20', { ...rule, dayPart: 'am' })).toBe(0);
      expect(countWorkingDays('2026-08-27', '2026-08-27', { ...rule, dayPart: 'am' })).toBe(0.5);
    });

    it('is unchanged when no bi-weekly day is configured', () => {
      // The guarantee that makes this safe to deploy against the client's live
      // database: an empty list must behave exactly like the old code path.
      expect(
        countWorkingDays(...RANGE, { ...base, weekendDays: [5], biweeklyWeekendDays: [] })
      ).toBe(24);
      expect(
        countWorkingDays(...RANGE, {
          ...base,
          weekendDays: [5],
          biweeklyWeekendDays: [4],
          biweeklyAnchor: null,
        })
      ).toBe(24);
    });
  });
});
