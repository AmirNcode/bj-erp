/**
 * Pure home-board view-model. Shapes the role-aware cards from already-fetched
 * data. No I/O — unit-tested.
 */

import type { LeaveRequestWithType, CalendarEntry } from '@/lib/actions/leave';
import type { BalanceItem } from '@/lib/leave/balances';

export type HomeBoard = {
  showApprovals: boolean;
  pendingCount: number;
  recent: LeaveRequestWithType[];
  balances: BalanceItem[];
  team: CalendarEntry[];
};

export function buildHomeBoard(input: {
  roles: string[];
  requests: LeaveRequestWithType[];
  balances: BalanceItem[];
  team: CalendarEntry[];
  pendingCount: number;
}): HomeBoard {
  const showApprovals = input.roles.includes('admin') || input.roles.includes('manager');
  return {
    showApprovals,
    pendingCount: input.pendingCount,
    recent: input.requests.slice(0, 5),
    balances: input.balances,
    team: input.team,
  };
}
