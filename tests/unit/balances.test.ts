import { describe, it, expect } from 'vitest';
import { latestBalances } from '@/lib/leave/balances';

describe('latestBalances', () => {
  it('keeps the latest balance_after per leave type', () => {
    const rows = [
      { leave_type_id: 'a', balance_after: 26, created_at: '2026-01-01T00:00:00Z' },
      { leave_type_id: 'a', balance_after: 24, created_at: '2026-06-01T00:00:00Z' },
      { leave_type_id: 'b', balance_after: 10, created_at: '2026-03-01T00:00:00Z' },
    ];
    expect(latestBalances(rows)).toEqual({ a: 24, b: 10 });
  });

  it('handles unsorted rows', () => {
    const rows = [
      { leave_type_id: 'a', balance_after: 24, created_at: '2026-06-01T00:00:00Z' },
      { leave_type_id: 'a', balance_after: 26, created_at: '2026-01-01T00:00:00Z' },
    ];
    expect(latestBalances(rows)).toEqual({ a: 24 });
  });

  it('empty -> {}', () => expect(latestBalances([])).toEqual({}));
});
