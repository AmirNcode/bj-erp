import { describe, expect, it } from 'vitest';
import {
  describeSnapshot, printedChanges, requestChanges, snapshotOf, type RequestSnapshot,
} from '@/lib/leave/requestChanges';
import type { RequestCorrection } from '@/lib/travel/extensions';

const current: RequestSnapshot = {
  unit: 'day', start: '2027-03-01', end: '2027-03-03', dayPart: 'full', startTime: null, endTime: null, minutes: 1440, perDiem: null,
};

const fix = (over: Partial<RequestCorrection>): RequestCorrection => ({
  old_start_date: '2027-03-01', new_start_date: '2027-03-01', old_end_date: '2027-03-03', new_end_date: '2027-03-03',
  per_diem_before: null, per_diem_after: null, reason: 'r', corrected_by_name: 'HR', corrected_at: '2027-03-05T10:00:00Z',
  old_unit: 'day', new_unit: 'day', old_day_part: 'full', new_day_part: 'full',
  old_start_time: null, new_start_time: null, old_end_time: null, new_end_time: null, minutes_before: 1440, minutes_after: 1440,
  ...over,
});

describe('requestChanges (FR-91)', () => {
  it('without edits the signed values are the current request and there are no changes', () => {
    expect(requestChanges(current, [])).toEqual({ signed: current, changes: [] });
  });

  it('sorts edits oldest first and takes the signed values from the oldest "before"', () => {
    const later = fix({ corrected_at: '2027-03-09T10:00:00Z', old_end_date: '2027-03-02', new_end_date: '2027-03-04', reason: 'second', minutes_before: 960, minutes_after: 1920 });
    const earlier = fix({ corrected_at: '2027-03-05T10:00:00Z', old_end_date: '2027-03-03', new_end_date: '2027-03-02', reason: 'first', minutes_before: 1440, minutes_after: 960 });
    const { signed, changes } = requestChanges({ ...current, end: '2027-03-04' }, [later, earlier]);
    expect(changes.map((c) => c.reason)).toEqual(['first', 'second']);
    expect(signed).toMatchObject({ start: '2027-03-01', end: '2027-03-03', minutes: 1440 });
    expect(changes[0].after.end).toBe('2027-03-02');
    expect(changes[1].before.end).toBe('2027-03-02');
    expect(changes[0].by).toBe('HR');
    expect(changes[0].at).toBe('2027-03-05T10:00:00Z');
  });

  it('reads a pre-FR-91 row (trip dates only) as a daily snapshot with unknown minutes', () => {
    const legacy = {
      old_start_date: '2027-03-01', new_start_date: '2027-03-01', old_end_date: '2027-03-03', new_end_date: '2027-03-05',
      per_diem_before: null, per_diem_after: 2500000, reason: 'legacy', corrected_by_name: null, corrected_at: '2027-03-02T10:00:00Z',
    } as unknown as RequestCorrection;
    const { signed, changes } = requestChanges(current, [legacy]);
    expect(signed).toMatchObject({ unit: 'day', dayPart: 'full', startTime: null, endTime: null, minutes: null, perDiem: null });
    expect(changes[0].after).toMatchObject({ unit: 'day', end: '2027-03-05', minutes: null, perDiem: 2500000 });
    expect(changes[0].by).toBeNull();
  });

  it('a daily to hourly edit carries both units and the new times', () => {
    const { changes } = requestChanges(
      { ...current, unit: 'hour', start: '2027-03-01', end: '2027-03-01', startTime: '09:00:00', endTime: '11:00:00', minutes: 120 },
      [fix({ new_unit: 'hour', old_end_date: '2027-03-03', new_end_date: '2027-03-01', new_start_time: '09:00:00', new_end_time: '11:00:00', minutes_after: 120 })]
    );
    expect(changes[0].before).toMatchObject({ unit: 'day', end: '2027-03-03', startTime: null });
    expect(changes[0].after).toMatchObject({ unit: 'hour', end: '2027-03-01', startTime: '09:00:00', endTime: '11:00:00', minutes: 120 });
  });
});

describe('snapshotOf', () => {
  it('maps a request row to a snapshot', () => {
    expect(snapshotOf({
      unit: 'hour', start_date: '2027-03-01', end_date: '2027-03-01', day_part: 'full', start_time: '09:00:00',
      end_time: '10:00:00', requested_minutes: 60, per_diem_rials: null,
    })).toEqual({ unit: 'hour', start: '2027-03-01', end: '2027-03-01', dayPart: 'full', startTime: '09:00:00', endTime: '10:00:00', minutes: 60, perDiem: null });
  });
});

describe('describeSnapshot', () => {
  const labels = { days: 'days', hours: 'hours', minutes: 'minutes', and: 'and', day: 'day', hour: 'hour', minute: 'minute' };
  const o = { locale: 'en', hoursPerDay: 8, durationLabels: labels, dayPartLabels: { am: 'Morning', pm: 'Afternoon' } };
  it('a date range with its days and hours, never decimal days', () => {
    const text = describeSnapshot({ ...current, minutes: 1560 }, o);
    expect(text).toContain('—');
    expect(text).toContain('3 days and 2 hours');
  });
  it('an hourly request shows the date and the time range', () => {
    const text = describeSnapshot({ ...current, unit: 'hour', end: current.start, startTime: '09:00:00', endTime: '11:00:00', minutes: 120 }, o);
    expect(text).toContain('09:00–11:00');
    expect(text).toContain('2 hours');
  });
  it('a half day names its part; unknown minutes add no duration', () => {
    const text = describeSnapshot({ ...current, end: current.start, dayPart: 'am', minutes: null }, o);
    expect(text).toContain('Morning');
    expect(text).not.toContain('(');
  });
});

describe('printedChanges (print form)', () => {
  it('a leave with one edit prints the signed dates, then one change; no "signed as" line', () => {
    const p = printedChanges(
      { ...current, end: '2027-03-02', minutes: 960 },
      [fix({ new_end_date: '2027-03-02', minutes_after: 960 })]
    );
    expect(p.body).toMatchObject({ start: '2027-03-01', end: '2027-03-03', minutes: 1440 });
    expect(p.signedLine).toBeNull();
    expect(p.changes).toHaveLength(1);
    expect(p.changes[0].after.end).toBe('2027-03-02');
  });
  it('without edits the body is the current request', () => {
    expect(printedChanges(current, [])).toEqual({ body: current, signedLine: null, changes: [] });
  });
  it('a type change prints the current form with the signed original in a line of its own', () => {
    const hourly: RequestSnapshot = { ...current, unit: 'hour', end: current.start, startTime: '09:00:00', endTime: '11:00:00', minutes: 120 };
    const p = printedChanges(hourly, [fix({ new_unit: 'hour', new_end_date: '2027-03-01', new_start_time: '09:00:00', new_end_time: '11:00:00', minutes_after: 120 })]);
    expect(p.body).toEqual(hourly);
    expect(p.signedLine).toMatchObject({ unit: 'day', end: '2027-03-03', minutes: 1440 });
    expect(p.changes).toHaveLength(1);
  });
});
