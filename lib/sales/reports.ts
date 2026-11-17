/** FR-94 report maths over the records list. Pure. */

import { formatCalendarDate } from '@/lib/leave/calendarMonth';
import { daysLeft } from './deadlines';
import type { DeadlineRow, RecordRow, Stage } from './types';

export type PipelineRow = { stageId: string; count: number; value: Record<string, number> };

/** Records per stage, with the value per currency (contract value, else our price). */
export function pipeline(rows: RecordRow[], stages: Stage[]): PipelineRow[] {
  const out = new Map<string, PipelineRow>(stages.map((s) => [s.id, { stageId: s.id, count: 0, value: {} }]));
  for (const r of rows) {
    const row = out.get(r.stage_id);
    if (!row) continue;
    row.count += 1;
    const amount = r.total_value ?? r.our_price;
    if (typeof amount === 'number' && r.currency) row.value[r.currency] = (row.value[r.currency] ?? 0) + amount;
  }
  return stages.map((s) => out.get(s.id)!).filter((r) => r.count > 0);
}

export type ResultRow = { key: string; decided: number; won: number; lost: number; cancelled: number; winRate: number | null };

/**
 * Bid results by buyer or by Persian year of the result. Only bids decided in the
 * app count (bid_decision = bid): an imported contract is a win with no lost bids
 * beside it, and would make every rate 100%.
 */
export function results(rows: RecordRow[], by: 'customer' | 'year'): ResultRow[] {
  const out = new Map<string, ResultRow>();
  for (const r of rows) {
    if (r.bid_decision !== 'bid' || !r.bid_result || r.imported) continue;
    const key = by === 'customer' ? r.buyer_name ?? '—' : r.result_at ? formatCalendarDate(r.result_at.slice(0, 10), 'en', 'YYYY') : '—';
    const row = out.get(key) ?? { key, decided: 0, won: 0, lost: 0, cancelled: 0, winRate: null };
    row.decided += 1;
    row[r.bid_result] += 1;
    out.set(key, row);
  }
  for (const row of out.values()) {
    const competed = row.won + row.lost;
    row.winRate = competed > 0 ? row.won / competed : null;
  }
  return [...out.values()].sort((a, b) => (by === 'year' ? b.key.localeCompare(a.key) : b.decided - a.decided || a.key.localeCompare(b.key)));
}

export type DeadlinePerformance = { onTime: number; late: number; openOverdue: number; open: number };

/**
 * Met on time / met late / still open and overdue. A deadline that arrived already
 * done (an old date from the ledger import: done_at = created_at) has no real
 * completion time and is left out.
 */
export function deadlinePerformance(deadlines: DeadlineRow[], today: string): DeadlinePerformance {
  const out: DeadlinePerformance = { onTime: 0, late: 0, openOverdue: 0, open: 0 };
  for (const d of deadlines) {
    if (!d.done_at) {
      out.open += 1;
      if (daysLeft(d.due_on, today) < 0) out.openOverdue += 1;
    } else if (d.done_at !== d.created_at) {
      if (d.done_at.slice(0, 10) <= d.due_on) out.onTime += 1;
      else out.late += 1;
    }
  }
  return out;
}
