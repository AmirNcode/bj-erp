import { describe, expect, it } from 'vitest';
import { daysLeft, deadlineState } from '@/lib/sales/deadlines';
import { buildTree, columnsForDepth, pathTo } from '@/lib/sales/tree';
import { defaultNextStage, defaultOwner } from '@/lib/sales/stages';
import { deadlinePerformance, pipeline, results } from '@/lib/sales/reports';
import type { DeadlineRow, NodeRow, RecordRow, Stage } from '@/lib/sales/types';

const node = (id: string, parent: string | null, seq: number, code: string): NodeRow => ({
  id, parent_id: parent, seq, code, depth: code.split('-').length - 1, description: null, product_type: null,
  size: null, rating: null, qty: null, unit: null, custom: {},
});
const stage = (id: string, position: number, extra: Partial<Stage> = {}): Stage => ({
  id, flow_id: 'f', position, name_fa: id, name_en: id, kind: 'open', action: null, code: id,
  owner_role_id: null, required: [], active: true, ...extra,
});
const rec = (extra: Partial<RecordRow>): RecordRow => ({
  stage_id: 'a', bid_decision: 'bid', bid_result: null, imported: false, currency: 'EUR', buyer_name: 'NISOC',
  result_at: null, ...extra,
} as RecordRow);

describe('deadlines', () => {
  it('counts whole days; today is 0, yesterday is overdue', () => {
    expect(daysLeft('2026-11-20', '2026-11-16')).toBe(4);
    expect(daysLeft('2026-11-16', '2026-11-16')).toBe(0);
    expect(deadlineState('2026-11-15', '2026-11-16', 7)).toBe('overdue');
    expect(deadlineState('2026-11-16', '2026-11-16', 7)).toBe('soon');
    expect(deadlineState('2026-11-23', '2026-11-16', 7)).toBe('soon');
    expect(deadlineState('2026-11-24', '2026-11-16', 7)).toBe('ok');
  });
});

describe('items tree', () => {
  const nodes = [node('c', null, 3, '8997-3'), node('a', null, 1, '8997-1'), node('a2', 'a', 2, '8997-1-2'),
    node('a1', 'a', 1, '8997-1-1'), node('a1x', 'a1', 5, '8997-1-1-5'), node('lost', 'gone', 1, '8997-9-1')];
  it('nests rows and orders siblings by dash number, not by arrival', () => {
    const tree = buildTree(nodes);
    expect(tree.map((n) => n.code)).toEqual(['8997-1', '8997-3']);
    expect(tree[0].children.map((n) => n.code)).toEqual(['8997-1-1', '8997-1-2']);
    expect(tree[0].children[0].children[0].code).toBe('8997-1-1-5');
  });
  it('finds the path to a row', () => {
    expect(pathTo(nodes, 'a1x')).toEqual(['a', 'a1', 'a1x']);
    expect(pathTo(nodes, 'nope')).toEqual([]);
  });
  it('columns: own depth, else the nearest configured part level, else defaults', () => {
    expect(columnsForDepth(null, 1)).toEqual(['product_type', 'size', 'rating', 'qty', 'unit']);
    expect(columnsForDepth(null, 3)).toEqual(['qty', 'unit']);
    const set = { '1': ['qty'], '2': ['x_material'] };
    expect(columnsForDepth(set, 1)).toEqual(['qty']);
    expect(columnsForDepth(set, 2)).toEqual(['x_material']);
    expect(columnsForDepth(set, 4)).toEqual(['x_material']);
    expect(columnsForDepth({ '1': ['qty'] }, 2)).toEqual(['qty', 'unit']);
  });
});

describe('stages', () => {
  const stages = [stage('a', 1), stage('price', 2, { action: 'quote' }), stage('off', 3, { active: false }),
    stage('lost', 4, { kind: 'lost' }), stage('send', 5, { owner_role_id: 'r1' })];
  it('next stage skips pricing without a quote, retired and closed stages', () => {
    expect(defaultNextStage(stages, 'a', true)?.id).toBe('price');
    expect(defaultNextStage(stages, 'a', false)?.id).toBe('send');
    expect(defaultNextStage(stages, 'send', true)).toBeNull();
    expect(defaultNextStage(stages, 'missing', true)).toBeNull();
  });
  it('suggests a holder of the stage owner role', () => {
    const people = [{ id: 'p1', name: 'A', personnel_no: null, role_ids: [] }, { id: 'p2', name: 'B', personnel_no: null, role_ids: ['r1'] }];
    expect(defaultOwner(stages[4], people)).toBe('p2');
    expect(defaultOwner(stages[0], people)).toBeNull();
  });
});

describe('reports', () => {
  it('pipeline: count and value per currency, contract value before our price', () => {
    const rows = [rec({ total_value: 100, our_price: 5 }), rec({ our_price: 50 }), rec({ currency: 'IRR', total_value: 7 }),
      rec({ stage_id: 'b' }), rec({ stage_id: 'unknown' })];
    expect(pipeline(rows, [stage('a', 1), stage('b', 2), stage('c', 3)])).toEqual([
      { stageId: 'a', count: 3, value: { EUR: 150, IRR: 7 } },
      { stageId: 'b', count: 1, value: {} },
    ]);
  });
  it('results: win rate over won + lost; imported contracts and undecided bids are left out', () => {
    const rows = [rec({ bid_result: 'won' }), rec({ bid_result: 'lost' }), rec({ bid_result: 'lost' }),
      rec({ bid_result: 'cancelled' }), rec({ bid_result: 'won', imported: true, bid_decision: 'pending' }),
      rec({ bid_result: 'cancelled', buyer_name: 'PEDEC' })];
    expect(results(rows, 'customer')).toEqual([
      { key: 'NISOC', decided: 4, won: 1, lost: 2, cancelled: 1, winRate: 1 / 3 },
      { key: 'PEDEC', decided: 1, won: 0, lost: 0, cancelled: 1, winRate: null },
    ]);
  });
  it('results by Persian year', () => {
    const rows = [rec({ bid_result: 'won', result_at: '2026-11-16T10:00:00Z' }), rec({ bid_result: 'lost', result_at: '2025-06-01T10:00:00Z' })];
    expect(results(rows, 'year').map((r) => r.key)).toEqual(['1405', '1404']);
  });
  it('deadline performance ignores rows that arrived already done', () => {
    const d = (extra: Partial<DeadlineRow>): DeadlineRow => ({ due_on: '2026-11-10', done_at: null, created_at: '2026-11-01T00:00:00Z', ...extra } as DeadlineRow);
    expect(deadlinePerformance([
      d({ done_at: '2026-11-09T08:00:00Z' }), d({ done_at: '2026-11-12T08:00:00Z' }),
      d({ done_at: '2026-11-01T00:00:00Z' }), d({}), d({ due_on: '2026-12-01' }),
    ], '2026-11-16')).toEqual({ onTime: 1, late: 1, openOverdue: 1, open: 2 });
  });
});
