import { describe, it, expect } from 'vitest';
import {
  validateWeekendDays,
  isWeekendDate,
  isoWeekdayOf,
  frequencyOf,
  WEEKDAYS,
} from '@/lib/leave/weekend';

describe('WEEKDAYS', () => {
  it('lists 7 days in Sat..Fri display order (ISO numbers)', () => {
    expect(WEEKDAYS.map((d) => d.iso)).toEqual([6, 7, 1, 2, 3, 4, 5]);
  });
});

describe('validateWeekendDays', () => {
  it('accepts the default Friday-only and dedupes/sorts', () => {
    expect(validateWeekendDays([5])).toEqual({
      ok: true,
      days: [5],
      biweeklyDays: [],
      anchor: null,
    });
    expect(validateWeekendDays([5, 5, 4])).toEqual({
      ok: true,
      days: [4, 5],
      biweeklyDays: [],
      anchor: null,
    });
  });

  it('rejects out-of-range weekday numbers, in either list', () => {
    expect(validateWeekendDays([0])).toEqual({ ok: false, reason: 'out_of_range' });
    expect(validateWeekendDays([8])).toEqual({ ok: false, reason: 'out_of_range' });
    expect(validateWeekendDays([5], [9], '2026-08-20')).toEqual({
      ok: false,
      reason: 'out_of_range',
    });
  });

  it('rejects marking every day a weekend, counting BOTH lists', () => {
    expect(validateWeekendDays([1, 2, 3, 4, 5, 6, 7])).toEqual({ ok: false, reason: 'all_week' });
    // The union is what matters: nothing could ever be requested.
    expect(validateWeekendDays([1, 2, 3, 4, 5], [6, 7], '2026-08-20')).toEqual({
      ok: false,
      reason: 'all_week',
    });
  });

  it('accepts the client’s real week: Friday weekly + Thursday fortnightly', () => {
    expect(validateWeekendDays([5], [4], '2026-08-20')).toEqual({
      ok: true,
      days: [5],
      biweeklyDays: [4],
      anchor: '2026-08-20',
    });
  });

  it('requires an anchor whenever a day is fortnightly', () => {
    // Without one, WHICH Thursdays are off is undefined; defaulting it would
    // silently pick.
    expect(validateWeekendDays([5], [4], null)).toEqual({
      ok: false,
      reason: 'anchor_required',
    });
    expect(validateWeekendDays([5], [4], '')).toEqual({
      ok: false,
      reason: 'anchor_required',
    });
  });

  it('rejects a day that is both weekly and fortnightly', () => {
    expect(validateWeekendDays([4, 5], [4], '2026-08-20')).toEqual({
      ok: false,
      reason: 'overlap',
    });
  });

  it('drops an anchor that no fortnightly day needs', () => {
    // Storing a value nothing reads invites a later reader to trust it.
    expect(validateWeekendDays([5], [], '2026-08-20')).toEqual({
      ok: true,
      days: [5],
      biweeklyDays: [],
      anchor: null,
    });
  });
});

describe('isoWeekdayOf', () => {
  it('returns ISO numbers, Mon=1 .. Sun=7', () => {
    expect(isoWeekdayOf('2026-08-17')).toBe(1); // Monday
    expect(isoWeekdayOf('2026-08-20')).toBe(4); // Thursday
    expect(isoWeekdayOf('2026-08-21')).toBe(5); // Friday
    expect(isoWeekdayOf('2026-08-22')).toBe(6); // Saturday
    expect(isoWeekdayOf('2026-08-23')).toBe(7); // Sunday
  });

  it('returns null for junk', () => {
    expect(isoWeekdayOf('not-a-date')).toBeNull();
  });
});

describe('isWeekendDate', () => {
  const weeklyOnly = { weekendDays: [5] };
  // Friday every week, Thursday every other week, anchored on Thu 2026-08-20.
  const clientRule = {
    weekendDays: [5],
    biweeklyWeekendDays: [4],
    biweeklyAnchor: '2026-08-20',
  };

  it('honours the weekly list', () => {
    expect(isWeekendDate('2026-08-21', weeklyOnly)).toBe(true); // Friday
    expect(isWeekendDate('2026-08-20', weeklyOnly)).toBe(false); // Thursday
  });

  it('alternates the fortnightly weekday from the anchor', () => {
    // This is the exact sequence verified against private.is_company_weekend on
    // the live database — the SQL is authoritative and these must agree.
    expect(isWeekendDate('2026-08-20', clientRule)).toBe(true); // anchor week: off
    expect(isWeekendDate('2026-08-27', clientRule)).toBe(false); // next week: worked
    expect(isWeekendDate('2026-09-03', clientRule)).toBe(true); // off
    expect(isWeekendDate('2026-09-10', clientRule)).toBe(false); // worked
    expect(isWeekendDate('2026-09-17', clientRule)).toBe(true); // off
  });

  it('keeps Friday off in BOTH parities', () => {
    expect(isWeekendDate('2026-08-21', clientRule)).toBe(true);
    expect(isWeekendDate('2026-08-28', clientRule)).toBe(true);
  });

  it('leaves the rest of the week working', () => {
    for (const iso of ['2026-08-22', '2026-08-23', '2026-08-24', '2026-08-25', '2026-08-26']) {
      expect(isWeekendDate(iso, clientRule)).toBe(false);
    }
  });

  it('works BEFORE the anchor, not only after it', () => {
    // An admin picks "the next Thursday off", so every historical Thursday is
    // earlier than the anchor and must still alternate.
    expect(isWeekendDate('2026-08-13', clientRule)).toBe(false); // one week before
    expect(isWeekendDate('2026-08-06', clientRule)).toBe(true); // two weeks before
    expect(isWeekendDate('2026-07-30', clientRule)).toBe(false);
    expect(isWeekendDate('2026-07-23', clientRule)).toBe(true);
  });

  it('buckets dates on the far side of the week epoch correctly', () => {
    // The week index is a FLOORED division, not a truncating one. Both agree
    // while the date and the anchor sit on the same side of 2000-01-01 — which
    // every realistic date does, so an earlier version of this suite could not
    // tell the two apart and a truncating division passed every test.
    //
    // Truncation rounds toward zero, so it collapses the week straddling the
    // epoch and flips the parity of everything before it. These Thursdays are
    // the cheapest way to pin the distinction down. Not a scenario the client
    // will hit; it is here so the arithmetic cannot be "simplified" later.
    expect(isWeekendDate('1999-12-30', clientRule)).toBe(true);
    expect(isWeekendDate('1999-12-23', clientRule)).toBe(false);
    expect(isWeekendDate('1999-11-25', clientRule)).toBe(false);
  });

  it('holds parity across a year boundary', () => {
    // 2026-08-20 to 2027-08-19 is 52 weeks + 0 days, so the same weekday parity
    // must still alternate correctly a year out.
    expect(isWeekendDate('2027-08-19', clientRule)).toBe(true);
    expect(isWeekendDate('2027-08-26', clientRule)).toBe(false);
  });

  it('is inert when the fortnightly list is empty', () => {
    expect(isWeekendDate('2026-08-20', { weekendDays: [5], biweeklyWeekendDays: [] })).toBe(false);
  });

  it('is inert when the anchor is missing, rather than guessing a parity', () => {
    expect(
      isWeekendDate('2026-08-20', {
        weekendDays: [5],
        biweeklyWeekendDays: [4],
        biweeklyAnchor: null,
      })
    ).toBe(false);
  });

  it('does not treat an unparseable date as a weekend', () => {
    expect(isWeekendDate('nonsense', clientRule)).toBe(false);
  });

  it('uses a SATURDAY-aligned week grid, so one Iranian week shares a parity', () => {
    // Sat 2026-08-22 and the Thu 2026-08-27 that follows it belong to the same
    // Iranian week (Sat..Fri). Anchoring on that Saturday must therefore make
    // that Thursday an off day. On an ISO Monday grid they fall in different
    // buckets and this returns false — which is the bug this alignment prevents.
    const anchoredOnSaturday = {
      weekendDays: [],
      biweeklyWeekendDays: [4, 6],
      biweeklyAnchor: '2026-08-22',
    };
    expect(isWeekendDate('2026-08-22', anchoredOnSaturday)).toBe(true);
    expect(isWeekendDate('2026-08-27', anchoredOnSaturday)).toBe(true);
    // ...and the following Iranian week is worked.
    expect(isWeekendDate('2026-08-29', anchoredOnSaturday)).toBe(false);
    expect(isWeekendDate('2026-09-03', anchoredOnSaturday)).toBe(false);
  });
});

describe('frequencyOf', () => {
  it('reports the per-weekday state a settings UI edits', () => {
    expect(frequencyOf(5, [5], [4])).toBe('weekly');
    expect(frequencyOf(4, [5], [4])).toBe('biweekly');
    expect(frequencyOf(1, [5], [4])).toBe('working');
  });

  it('lets the weekly list win if a day somehow appears in both', () => {
    // validateWeekendDays refuses this, but the UI must still render something
    // deterministic for a row that reached it from older data.
    expect(frequencyOf(4, [4], [4])).toBe('weekly');
  });
});
