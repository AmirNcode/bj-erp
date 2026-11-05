/**
 * FR-85: how much of a leave balance came from HR's quick adds, and why. Pure.
 * The other part is simply the balance less those adds, so the two always sum to
 * the field above them, and it may be negative.
 */

export type QuickAddRow = {
  id: string;
  leaveTypeId: string;
  minutes: number;
  reason: string;
  at: string;
  byName: string | null;
};

export type BalanceBreakdown = { addedMinutes: number; otherMinutes: number; rows: QuickAddRow[] };

export function balanceBreakdown(
  balanceMinutes: number,
  rows: QuickAddRow[],
  leaveTypeId: string
): BalanceBreakdown | null {
  const own = rows
    .filter((r) => r.leaveTypeId === leaveTypeId)
    .sort((a, b) => b.at.localeCompare(a.at));
  if (own.length === 0) return null;
  const addedMinutes = own.reduce((sum, r) => sum + r.minutes, 0);
  return { addedMinutes, otherMinutes: balanceMinutes - addedMinutes, rows: own };
}
