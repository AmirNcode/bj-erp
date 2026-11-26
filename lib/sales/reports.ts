/** FR-94 report maths over the records list. Pure. */

import { formatCalendarDate } from '@/lib/leave/calendarMonth';
import { labelOf } from './customerLabel';
import { daysLeft } from './deadlines';
import type { DeadlineRow, SalesReport, Stage } from './types';

export type PipelineRow = { stageId: string; count: number; value: Record<string, number> };

/** Records per stage, with the value per currency (contract value, else our price); empty stages left out. */
export function pipeline(rows: SalesReport['pipeline'], stages: Stage[]): PipelineRow[] {
  const byStage = new Map(rows.map((r) => [r.stage_id, r]));
  return stages
    .map((s) => ({ stageId: s.id, count: byStage.get(s.id)?.count ?? 0, value: { ...(byStage.get(s.id)?.value ?? {}) } }))
    .filter((r) => r.count > 0);
}

export type ResultRow = { key: string; decided: number; won: number; lost: number; cancelled: number; winRate: number | null };

/**
 * Bid results by buyer or by Persian year of the result. The report already holds only
 * bids decided in the app (an imported contract is a win with no lost bids beside it
 * and would make every rate 100%).
 */
export function results(rows: SalesReport['decided'], by: 'customer' | 'year', locale = 'fa'): ResultRow[] {
  const out = new Map<string, ResultRow>();
  for (const r of rows) {
    // Customers group by id (name when the row has none); the shown key is the label for the locale.
    const label = by === 'customer' ? labelOf(r.buyer_name, r.buyer_name_en, locale) || '—' : r.result_at ? formatCalendarDate(r.result_at.slice(0, 10), 'en', 'YYYY') : '—';
    const group = by === 'customer' ? (r.buyer_id ? `id:${r.buyer_id}` : `name:${label}`) : label;
    const row = out.get(group) ?? { key: label, decided: 0, won: 0, lost: 0, cancelled: 0, winRate: null };
    row.decided += 1;
    row[r.bid_result] += 1;
    out.set(group, row);
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
