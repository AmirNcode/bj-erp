export type DesiredBalance = { leaveTypeId: string; target: number };
export type CurrentBalance = { leaveTypeId: string; balance: number };

/** The current calendar year as a Gregorian allocation period. */
export function currentYearPeriod(now: Date = new Date()): { start: string; end: string } {
  const year = now.getUTCFullYear();
  return { start: `${year}-01-01`, end: `${year}-12-31` };
}

/** Desired entries whose target differs from the current balance; absent current means zero. */
export function balanceAdjustments(
  current: CurrentBalance[],
  desired: DesiredBalance[]
): DesiredBalance[] {
  const byId = new Map(current.map((item) => [item.leaveTypeId, item.balance]));
  return desired.filter((item) => (byId.get(item.leaveTypeId) ?? 0) !== item.target);
}
