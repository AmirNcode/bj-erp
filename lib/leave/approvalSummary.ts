import type { BalanceRule } from './duration';

/** The balance numbers an approver sees before signing (FR-92). All values are minutes. */
export type BalanceFigures = {
  balanceMinutes: number;
  otherPendingMinutes: number;
  availableMinutes: number;
  requestedMinutes: number;
  afterMinutes: number;
  unpaidMinutes: number;
  overdraftMinutes: number;
};

type Input = {
  requested_minutes: number;
  balance_minutes: number | null;
  pending_other_minutes: number | null;
  balance_rule: BalanceRule | null;
};

/**
 * What approving does to the requester's balance, from the context the database
 * returns. At approval the ledger works from the balance itself, not the available
 * figure (other pending requests are not yet decided). Null when no balance applies
 * (rule 'none', or the context withheld the figures).
 */
export function balanceFigures(row: Input): BalanceFigures | null {
  const rule = row.balance_rule ?? 'none';
  if (rule === 'none' || row.balance_minutes === null) return null;
  const balance = row.balance_minutes;
  const other = row.pending_other_minutes ?? 0;
  const requested = row.requested_minutes;
  if (rule === 'overdraft') {
    return {
      balanceMinutes: balance,
      otherPendingMinutes: other,
      availableMinutes: balance - other,
      requestedMinutes: requested,
      afterMinutes: balance - requested,
      unpaidMinutes: 0,
      overdraftMinutes: Math.max(requested - Math.max(balance, 0), 0),
    };
  }
  const paid = Math.min(requested, Math.max(balance, 0));
  return {
    balanceMinutes: balance,
    otherPendingMinutes: other,
    availableMinutes: balance - other,
    requestedMinutes: requested,
    afterMinutes: balance - paid,
    unpaidMinutes: requested - paid,
    overdraftMinutes: 0,
  };
}
