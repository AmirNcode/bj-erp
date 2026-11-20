import { describe, expect, it } from 'vitest';
import { formatFileSize, groupFilesByStage, recordFlowIds } from '@/lib/sales/files';
import type { EventRow, Flow, RecordRow, SalesFile, Stage } from '@/lib/sales/types';

const flows: Flow[] = [
  { id: 'fc', kind: 'contract', name_fa: 'قرارداد', name_en: 'Contract' },
  { id: 'fb', kind: 'bid', name_fa: 'مناقصه', name_en: 'Bid' },
];
const st = (id: string, flow_id: string, position: number): Stage => ({
  id, flow_id, position, name_fa: id, name_en: id, kind: 'open', action: null, code: id, owner_role_id: null, required: [], active: true,
});
const stages: Stage[] = [st('c1', 'fc', 1), st('c2', 'fc', 2), st('b2', 'fb', 2), st('b1', 'fb', 1)];
const file = (id: string, stage_id: string): SalesFile => ({
  id, stage_id, name: id, size_bytes: 1, uploaded_by: null, uploader_name: null, uploaded_at: '2026-11-20T00:00:00Z', can_delete: true,
});
const ev = (body: Record<string, unknown>): EventRow => ({ id: 'e', at: '', kind: 'stage', actor_name: null, body });
const rec = (stage_id: string, flow_id: string) => ({ stage_id, flow_id }) as RecordRow;

describe('recordFlowIds', () => {
  it('has the current flow and the flows named in stage events and files', () => {
    const ids = recordFlowIds(rec('c1', 'fc'), [ev({ from: 'b2', to: 'b1' })], [file('f', 'b1')], stages);
    expect(new Set(ids)).toEqual(new Set(['fc', 'fb']));
  });
  it('adds the flow of a stage with files even without events', () => {
    expect(new Set(recordFlowIds(rec('c1', 'fc'), [], [file('f', 'b1')], stages))).toEqual(new Set(['fc', 'fb']));
  });
  it('is only the current flow without bid history', () => {
    expect(recordFlowIds(rec('c1', 'fc'), [ev({ note: 'x' })], [file('f', 'c2')], stages)).toEqual(['fc']);
  });
  it('ignores unknown stage ids', () => {
    expect(recordFlowIds(rec('b1', 'fb'), [ev({ from: 'zz', to: 'b2' })], [file('f', 'zz')], stages)).toEqual(['fb']);
  });
});

describe('groupFilesByStage', () => {
  it('lists bid stages before contract stages, all stages, files in place', () => {
    const g = groupFilesByStage([file('f1', 'b1')], stages, ['fc', 'fb'], flows);
    expect(g.map((x) => x.stage?.id)).toEqual(['b1', 'b2', 'c1', 'c2']);
    expect(g[0].files.map((f) => f.id)).toEqual(['f1']);
    expect(g[1].files).toEqual([]);
  });
  it('keeps files of an unknown stage in an Other group', () => {
    const g = groupFilesByStage([file('f1', 'gone'), file('f2', 'c1')], stages, ['fc'], flows);
    expect(g.map((x) => x.stage?.id ?? null)).toEqual(['c1', 'c2', null]);
    expect(g[2].files.map((f) => f.id)).toEqual(['f1']);
  });
  it('has no Other group when every file has a stage', () => {
    expect(groupFilesByStage([], stages, ['fb'], flows).some((x) => x.stage === null)).toBe(false);
  });
});

describe('formatFileSize', () => {
  it('picks the unit', () => {
    expect(formatFileSize(500)).toEqual({ value: 500, unit: 'B' });
    expect(formatFileSize(2048)).toEqual({ value: 2, unit: 'KB' });
    expect(formatFileSize(5 * 1024 * 1024)).toEqual({ value: 5, unit: 'MB' });
    expect(formatFileSize(1_500_000).unit).toBe('MB');
  });
});
