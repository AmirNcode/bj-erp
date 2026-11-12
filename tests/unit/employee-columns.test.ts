import { describe, expect, it } from 'vitest';
import { COLUMN_SHOW, DETAIL_HIDE, EXPAND_HIDE, type EmpColumn } from '@/lib/employees/columns';

const COLS: EmpColumn[] = ['last', 'id', 'hire', 'department', 'roles', 'upcoming', 'balance', 'used', 'unpaid', 'edit'];
const bp = (s: string) => s.match(/@[0-9a-z]+/)?.[0];

describe('employee table columns (FR-92)', () => {
  it('every column has a show and a detail-hide class on the same breakpoint', () => {
    for (const c of COLS) {
      expect(COLUMN_SHOW[c], c).toBeDefined();
      expect(DETAIL_HIDE[c], c).toBeDefined();
      expect(COLUMN_SHOW[c].startsWith('hidden ')).toBe(true);
      expect(DETAIL_HIDE[c].endsWith(':hidden')).toBe(true);
      expect(bp(COLUMN_SHOW[c])).toBe(bp(DETAIL_HIDE[c]));
    }
  });
  it('balance appears at @2xl; used and unpaid at @7xl', () => {
    expect(bp(COLUMN_SHOW.balance)).toBe('@2xl');
    expect(bp(COLUMN_SHOW.used)).toBe('@7xl');
    expect(bp(COLUMN_SHOW.unpaid)).toBe('@7xl');
  });
  it('the toggle disappears when everything fits', () => {
    expect(EXPAND_HIDE).toBe('@7xl:hidden');
  });
});
