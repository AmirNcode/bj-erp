import { describe, it, expect } from 'vitest';
import { balanceAdjustments, currentYearPeriod } from '@/lib/leave/allocations';

describe('currentYearPeriod', () => {
  it('returns Jan 1-Dec 31 of the given year', () => {
    expect(currentYearPeriod(new Date('2026-06-30T12:00:00Z'))).toEqual({
      start: '2026-01-01',
      end: '2026-12-31',
    });
  });
});

describe('balanceAdjustments', () => {
  const current = [
    { leaveTypeId: 'annual', balance: 26 },
    { leaveTypeId: 'sick', balance: 10 },
  ];

  it('returns only changed types', () => {
    expect(
      balanceAdjustments(current, [
        { leaveTypeId: 'annual', target: 30 },
        { leaveTypeId: 'sick', target: 10 },
      ])
    ).toEqual([{ leaveTypeId: 'annual', target: 30 }]);
  });

  it('treats a missing current balance as zero', () => {
    expect(balanceAdjustments([], [{ leaveTypeId: 'annual', target: 5 }])).toEqual([
      { leaveTypeId: 'annual', target: 5 },
    ]);
  });

  it('returns nothing when all targets match current balances', () => {
    expect(
      balanceAdjustments(current, [
        { leaveTypeId: 'annual', target: 26 },
        { leaveTypeId: 'sick', target: 10 },
      ])
    ).toEqual([]);
  });
});
