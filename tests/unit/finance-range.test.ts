import { describe, it, expect } from 'vitest';
import { defaultFinanceRange } from '@/lib/finance/range';

const months = [
  { gregorianStart: '2026-09-23', gregorianEnd: '2026-10-22', jalaliYear: 1405, jalaliMonth: 7 },
  { gregorianStart: '2026-10-23', gregorianEnd: '2026-11-21', jalaliYear: 1405, jalaliMonth: 8 },
];

describe('defaultFinanceRange', () => {
  it('current month through the end of the next one', () => {
    expect(defaultFinanceRange(months, '2026-10-21')).toEqual({ from: '2026-09-23', to: '2026-11-21' });
  });
  it('last month in the list: current month only', () => {
    expect(defaultFinanceRange(months, '2026-11-01')).toEqual({ from: '2026-10-23', to: '2026-11-21' });
  });
  it('today not in the list: today only', () => {
    expect(defaultFinanceRange(months, '2027-01-01')).toEqual({ from: '2027-01-01', to: '2027-01-01' });
  });
});
