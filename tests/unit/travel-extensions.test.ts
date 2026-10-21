import { describe, expect, it } from 'vitest';
import { printedTripDates } from '@/lib/travel/extensions';

const ext = (old_end_date: string, new_end_date: string, status: string, reason = 'r') =>
  ({ old_end_date, new_end_date, reason, status }) as never;

describe('printedTripDates (FR-70 print form)', () => {
  it('keeps the signed end date and lists approved extensions in order', () => {
    expect(printedTripDates('2027-03-06', [
      ext('2027-03-03', '2027-03-05', 'approved', 'More inspections'),
      ext('2027-03-05', '2027-03-07', 'rejected'),
      ext('2027-03-05', '2027-03-06', 'approved', 'Client asked'),
    ])).toEqual({
      signedEnd: '2027-03-03',
      extended: [{ date: '2027-03-05', reason: 'More inspections' }, { date: '2027-03-06', reason: 'Client asked' }],
    });
  });

  it('a trip never extended prints its own end date', () => {
    expect(printedTripDates('2027-03-03', [ext('2027-03-03', '2027-03-05', 'pending')])).toEqual({ signedEnd: '2027-03-03', extended: [] });
  });
});
