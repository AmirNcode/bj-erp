import { describe, it, expect } from 'vitest';
import { latestBalances } from '@/lib/leave/balances';

describe('latestBalances', () => {
  it('keeps the latest balance per leave type', () => {
    const rows = [
      { leave_type_id: 'a', balance_after_minutes: 12480, seq: 1 },
      { leave_type_id: 'a', balance_after_minutes: 11520, seq: 2 },
      { leave_type_id: 'b', balance_after_minutes: 4800, seq: 3 },
    ];
    expect(latestBalances(rows)).toEqual({ a: 11520, b: 4800 });
  });

  it('handles unsorted rows (seq decides, not row order)', () => {
    const rows = [
      { leave_type_id: 'a', balance_after_minutes: 11520, seq: 2 },
      { leave_type_id: 'a', balance_after_minutes: 12480, seq: 1 },
    ];
    expect(latestBalances(rows)).toEqual({ a: 11520 });
  });

  it('empty -> {}', () => expect(latestBalances([])).toEqual({}));
});
