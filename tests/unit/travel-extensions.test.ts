import { describe, expect, it } from 'vitest';
import { canCorrectTrip, printedTripDates } from '@/lib/travel/extensions';

const ext = (old_end_date: string, new_end_date: string, status: string, decided_at: string | null, reason = 'r') =>
  ({ old_end_date, new_end_date, reason, status, decided_at }) as never;

const fix = (
  at: string,
  [old_start_date, new_start_date]: [string, string],
  [old_end_date, new_end_date]: [string, string],
  [per_diem_before, per_diem_after]: [number | null, number | null] = [null, null],
  reason = 'c'
) =>
  ({
    corrected_at: at, old_start_date, new_start_date, old_end_date, new_end_date,
    per_diem_before, per_diem_after, reason, corrected_by_name: 'HR',
  }) as never;

const trip = (end: string, start = '2027-03-01', perDiem: number | null = null) => ({ start, end, perDiem });

describe('printedTripDates (FR-70 print form, FR-84 corrections)', () => {
  it('keeps the signed end date and lists approved extensions in order', () => {
    const printed = printedTripDates(trip('2027-03-06'), [
      ext('2027-03-03', '2027-03-05', 'approved', '2027-03-02T10:00:00Z', 'More inspections'),
      ext('2027-03-05', '2027-03-07', 'rejected', '2027-03-02T11:00:00Z'),
      ext('2027-03-05', '2027-03-06', 'approved', '2027-03-02T12:00:00Z', 'Client asked'),
    ], []);
    expect(printed.signedEnd).toBe('2027-03-03');
    expect(printed.changes.map((c) => [c.kind, c.end, c.reason])).toEqual([
      ['extension', '2027-03-05', 'More inspections'],
      ['extension', '2027-03-06', 'Client asked'],
    ]);
  });

  it('a trip never changed prints its own values', () => {
    expect(printedTripDates(trip('2027-03-03', '2027-03-01', 500), [ext('2027-03-03', '2027-03-05', 'pending', null)], [])).toEqual({
      signedStart: '2027-03-01', signedEnd: '2027-03-03', signedPerDiem: 500, changes: [],
    });
  });

  it('uses the first correction when it comes before an extension', () => {
    const printed = printedTripDates(trip('2027-03-14'), [
      ext('2027-03-12', '2027-03-14', 'approved', '2027-03-02T00:00:00Z'),
    ], [fix('2027-03-01T00:00:00Z', ['2027-03-01', '2027-03-01'], ['2027-03-10', '2027-03-12'])]);
    expect(printed.signedEnd).toBe('2027-03-10');
    expect(printed.changes.map((c) => c.kind)).toEqual(['correction', 'extension']);
  });

  it('uses the extension when it comes first', () => {
    const printed = printedTripDates(trip('2027-03-20'), [
      ext('2027-03-10', '2027-03-12', 'approved', '2027-03-01T00:00:00Z'),
    ], [fix('2027-03-02T00:00:00Z', ['2027-03-01', '2027-03-01'], ['2027-03-12', '2027-03-20'])]);
    expect(printed.signedEnd).toBe('2027-03-10');
    expect(printed.changes.map((c) => c.kind)).toEqual(['extension', 'correction']);
  });

  it('keeps signed start and per diem through two corrections with an extension between', () => {
    const printed = printedTripDates(trip('2027-03-09', '2027-02-27', 900), [
      ext('2027-03-07', '2027-03-08', 'approved', '2027-03-02T00:00:00Z'),
    ], [
      fix('2027-03-01T00:00:00Z', ['2027-03-01', '2027-02-28'], ['2027-03-05', '2027-03-07'], [null, 700]),
      fix('2027-03-03T00:00:00Z', ['2027-02-28', '2027-02-27'], ['2027-03-08', '2027-03-09'], [700, 900]),
    ]);
    expect(printed).toMatchObject({ signedStart: '2027-03-01', signedEnd: '2027-03-05', signedPerDiem: null });
    expect(printed.changes.map((c) => [c.kind, c.start, c.end, c.perDiem])).toEqual([
      ['correction', '2027-02-28', '2027-03-07', 700],
      ['extension', '2027-02-28', '2027-03-08', 700],
      ['correction', '2027-02-27', '2027-03-09', 900],
    ]);
  });
});

describe('canCorrectTrip (FR-84)', () => {
  const r = { kind: 'errand', unit: 'day', status: 'approved', employee_id: 'someone' };

  it('allows an approved daily trip of someone else', () => {
    expect(canCorrectTrip(r, 'viewer')).toBe(true);
  });
  it.each([
    ['the viewer\'s own trip', { ...r, employee_id: 'viewer' }],
    ['an hourly errand', { ...r, unit: 'hour' }],
    ['regular leave', { ...r, kind: 'leave' }],
    ['a pending trip', { ...r, status: 'pending' }],
    ['a cancelled trip', { ...r, status: 'cancelled' }],
  ])('refuses %s', (_, row) => {
    expect(canCorrectTrip(row, 'viewer')).toBe(false);
  });
});
