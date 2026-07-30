import { describe, it, expect } from 'vitest';
import { latestBalances } from '@/lib/leave/balances';

describe('latestBalances', () => {
  it('keeps the latest balance per leave type', () => {
    const rows = [
      { leave_type_id: 'a', balance_after_minutes: 12480, created_at: '2026-01-01T00:00:00Z' },
      { leave_type_id: 'a', balance_after_minutes: 11520, created_at: '2026-06-01T00:00:00Z' },
      { leave_type_id: 'b', balance_after_minutes: 4800, created_at: '2026-03-01T00:00:00Z' },
    ];
    expect(latestBalances(rows)).toEqual({ a: 11520, b: 4800 });
  });

  it('handles unsorted rows', () => {
    const rows = [
      { leave_type_id: 'a', balance_after_minutes: 11520, created_at: '2026-06-01T00:00:00Z' },
      { leave_type_id: 'a', balance_after_minutes: 12480, created_at: '2026-01-01T00:00:00Z' },
    ];
    expect(latestBalances(rows)).toEqual({ a: 11520 });
  });

  it('empty -> {}', () => expect(latestBalances([])).toEqual({}));
});
