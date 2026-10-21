import { describe, expect, it } from 'vitest';
import { tripTotal } from '@/lib/travel/totals';

const row = (r: Partial<Parameters<typeof tripTotal>[0]>) =>
  ({ status: 'approved', per_diem_rials: null, flight_cost_rials: null, hotel_cost_rials: null, lost_rials: null, ...r }) as Parameters<typeof tripTotal>[0];

describe('tripTotal (FR-70 finance)', () => {
  it('done trip sums per diem, ticket and hotel', () => {
    expect(tripTotal(row({ per_diem_rials: 500000, flight_cost_rials: 3000000, hotel_cost_rials: 2000000 }))).toBe(5500000);
  });
  it('company car: hotel only', () => {
    expect(tripTotal(row({ per_diem_rials: 500000, flight_cost_rials: 0, hotel_cost_rials: 2000000 }))).toBe(2500000);
  });
  it('cancelled trip counts only the amount lost', () => {
    expect(tripTotal(row({ status: 'cancelled', per_diem_rials: 500000, lost_rials: 400000 }))).toBe(400000);
  });
  it('missing amounts count as 0', () => {
    expect(tripTotal(row({}))).toBe(0);
    expect(tripTotal(row({ status: 'cancelled' }))).toBe(0);
  });
});
