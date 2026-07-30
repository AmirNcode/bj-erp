/**
 * Pure leave-balance helpers. No I/O — unit-tested.
 * `BalanceItem` lives here (the neutral module) so both the home view-model
 * (lib/home/board.ts) and the getMyBalances action (lib/actions/leave.ts) can
 * import it without a circular dependency.
 *
 * Balances are integer MINUTES (spec §5). Render via lib/leave/duration.ts —
 * never divide by a workday length outside that module.
 *
 * "Latest" is decided by `seq`, never by `created_at`: accrual posts several
 * months in one transaction, where now() is frozen, so created_at ties and the
 * winner would be arbitrary (migration 20260729130007).
 */

export type BalanceItem = {
  leaveTypeId: string;
  name_fa: string;
  name_en: string | null;
  balanceMinutes: number;
};

/** Latest `balance_after_minutes` per leave type, by `seq`, from unsorted rows. */
export function latestBalances(
  rows: { leave_type_id: string; balance_after_minutes: number; seq: number }[]
): Record<string, number> {
  const latest: Record<string, { balance: number; seq: number }> = {};
  for (const r of rows) {
    const prev = latest[r.leave_type_id];
    if (!prev || r.seq > prev.seq) {
      latest[r.leave_type_id] = { balance: r.balance_after_minutes, seq: r.seq };
    }
  }
  return Object.fromEntries(Object.entries(latest).map(([k, v]) => [k, v.balance]));
}
