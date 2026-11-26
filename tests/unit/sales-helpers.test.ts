import { describe, expect, it } from 'vitest';
import { daysLeft, deadlineState } from '@/lib/sales/deadlines';
import { buildTree, columnsForDepth, pathTo } from '@/lib/sales/tree';
import { defaultNextStage, defaultOwner } from '@/lib/sales/stages';
import { deadlinePerformance, pipeline, results } from '@/lib/sales/reports';
import type { DeadlineRow, NodeRow, Stage } from '@/lib/sales/types';

const node = (id: string, parent: string | null, seq: number, code: string): NodeRow => ({
  id, parent_id: parent, seq, code, depth: code.split('-').length - 1, description: null, product_type: null,
  size: null, rating: null, qty: null, unit: null, custom: {}, product_id: null,
});
const stage = (id: string, position: number, extra: Partial<Stage> = {}): Stage => ({
  id, flow_id: 'f', position, name_fa: id, name_en: id, kind: 'open', action: null, code: id,
  owner_role_id: null, required: [], active: true, ...extra,
});
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
  it('pipeline: keeps stage order, drops empty and unknown stages', () => {
    const rows = [{ stage_id: 'b', count: 1 }, { stage_id: 'a', count: 3, value: { EUR: 150, IRR: 7 } }, { stage_id: 'unknown', count: 2 }];
    expect(pipeline(rows, [stage('a', 1), stage('b', 2), stage('c', 3)])).toEqual([
      { stageId: 'a', count: 3, value: { EUR: 150, IRR: 7 } },
      { stageId: 'b', count: 1, value: {} },
    ]);
  });
  it('results: win rate over won + lost', () => {
    const d = (bid_result: 'won' | 'lost' | 'cancelled', buyer_name: string | null = 'NISOC', result_at = '2026-11-16T10:00:00Z') => ({ buyer_id: buyer_name, buyer_name, buyer_name_en: null, bid_result, result_at });
    const rows = [d('won'), d('lost'), d('lost'), d('cancelled'), d('cancelled', 'PEDEC'), d('won', null)];
    expect(results(rows, 'customer')).toEqual([
      { key: 'NISOC', decided: 4, won: 1, lost: 2, cancelled: 1, winRate: 1 / 3 },
      { key: '—', decided: 1, won: 1, lost: 0, cancelled: 0, winRate: 1 },
      { key: 'PEDEC', decided: 1, won: 0, lost: 0, cancelled: 1, winRate: null },
    ]);
  });
  it('results: one buyer id groups despite spelling, and the label follows the locale', () => {
    const rows = [
      { buyer_id: 'n', buyer_name: 'نفت', buyer_name_en: 'NIOC', bid_result: 'won' as const, result_at: '2026-11-16T10:00:00Z' },
      { buyer_id: 'n', buyer_name: 'نفت ایران', buyer_name_en: 'NIOC', bid_result: 'lost' as const, result_at: '2026-11-16T10:00:00Z' },
    ];
    expect(results(rows, 'customer', 'en')).toMatchObject([{ key: 'NIOC', decided: 2, won: 1, lost: 1 }]);
    expect(results(rows, 'customer', 'fa')).toHaveLength(1);
    expect(results([{ ...rows[0], buyer_name_en: null }], 'customer', 'en')[0].key).toBe('نفت');
  });
  it('results by Persian year', () => {
    const rows = [{ buyer_id: 'a', buyer_name: 'A', buyer_name_en: null, bid_result: 'won' as const, result_at: '2026-11-16T10:00:00Z' }, { buyer_id: 'a', buyer_name: 'A', buyer_name_en: null, bid_result: 'lost' as const, result_at: '2025-06-01T10:00:00Z' }];
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
