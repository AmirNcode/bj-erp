/**
 * Pure leave-balance helpers. No I/O — unit-tested.
 * `BalanceItem` lives here (the neutral module) so both the home view-model
 * (lib/home/board.ts) and the getMyBalances action (lib/actions/leave.ts) can
 * import it without a circular dependency.
 */

export type BalanceItem = {
  leaveTypeId: string;
  name_fa: string;
  name_en: string | null;
  balance: number;
};

/** Latest `balance_after` per leave type, from (possibly unsorted) ledger rows. */
export function latestBalances(
  rows: { leave_type_id: string; balance_after: number; created_at: string }[]
): Record<string, number> {
  const latest: Record<string, { balance: number; at: string }> = {};
  for (const r of rows) {
    const prev = latest[r.leave_type_id];
    if (!prev || r.created_at > prev.at) {
      latest[r.leave_type_id] = { balance: r.balance_after, at: r.created_at };
    }
  }
  return Object.fromEntries(Object.entries(latest).map(([k, v]) => [k, v.balance]));
}
