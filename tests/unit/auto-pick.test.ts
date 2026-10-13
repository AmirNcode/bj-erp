import { describe, it, expect } from 'vitest';
import { autoPick } from '@/lib/employees/autoPick';

const A = { id: 'a', personnelNo: '1001' };
const B = { id: 'b', personnelNo: '10010' };
const C = { id: 'c', personnelNo: null };

describe('autoPick', () => {
  it('picks the only result', () => {
    expect(autoPick([A], 'Reza')).toBe(A);
  });
  it('picks an exact personnel number among several (Persian digits too)', () => {
    expect(autoPick([A, B], '1001')).toBe(A);
    expect(autoPick([A, B], '۱۰۰۱')).toBe(A);
  });
  it('asks the user otherwise', () => {
    expect(autoPick([A, B], '100')).toBeNull();
    expect(autoPick([A, C], 'Re')).toBeNull();
    expect(autoPick([], '1001')).toBeNull();
  });
});
