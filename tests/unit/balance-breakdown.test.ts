import { describe, expect, it } from 'vitest';
import { balanceBreakdown, type QuickAddRow } from '@/lib/leave/balanceBreakdown';

const row = (leaveTypeId: string, minutes: number, at = '2026-11-05T10:00:00Z'): QuickAddRow => ({
  id: `${leaveTypeId}-${at}`,
  leaveTypeId,
  minutes,
  reason: 'returned early',
  at,
  byName: 'Fixture HR',
});

describe('balanceBreakdown (FR-85)', () => {
  it('returns null with no quick adds for the type', () => {
    expect(balanceBreakdown(600, [row('other', 60)], 'annual')).toBeNull();
  });

  it('splits the total so both parts sum to the balance', () => {
    expect(balanceBreakdown(1380, [row('annual', 180)], 'annual')).toMatchObject({
      addedMinutes: 180,
      otherMinutes: 1200,
    });
  });

  it('adds up every quick add of that type', () => {
    const rows = [row('annual', 180, '2026-01-01T00:00:00Z'), row('annual', 60), row('sick', 999)];
    expect(balanceBreakdown(1000, rows, 'annual')).toMatchObject({ addedMinutes: 240, otherMinutes: 760 });
  });

  it('allows a negative other part', () => {
    expect(balanceBreakdown(60, [row('annual', 180)], 'annual')?.otherMinutes).toBe(-120);
  });

  it('lists rows newest first', () => {
    const older = row('annual', 60, '2026-01-01T00:00:00Z');
    const newer = row('annual', 60, '2026-06-01T00:00:00Z');
    expect(balanceBreakdown(100, [older, newer], 'annual')?.rows).toEqual([newer, older]);
  });
});
