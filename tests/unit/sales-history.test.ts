import { describe, expect, it } from 'vitest';
import {
  changeList, formatChangeValue, historyLine, historyOp, historySource, isPrivateChanged, personText,
} from '@/lib/sales/history';
import type { HistoryRow } from '@/lib/sales/types';

const row = (o: Partial<HistoryRow>): HistoryRow => ({
  id: '1', at: '2026-11-27T10:00:00Z', actor_id: 'u', actor_name: 'A', entity: 'customer', entity_id: 'c', entity_label: 'X',
  action: 'edited', body: {}, ...o,
});

describe('historyLine', () => {
  it('renamed carries from and to', () => {
    expect(historyLine(row({ action: 'renamed', body: { from: 'الف', to: 'ب' } }))).toEqual({
      key: 'history.action.renamed', values: { from: 'الف', to: 'ب' },
    });
  });
  it('merge rows name the other customer', () => {
    expect(historyLine(row({ action: 'merged_into', body: { into_name: 'B' } }))).toEqual({ key: 'history.action.merged_into', values: { name: 'B' } });
    expect(historyLine(row({ action: 'merged_from', body: { from_name: 'A' } }))).toEqual({ key: 'history.action.merged_from', values: { name: 'A' } });
  });
  it('settings and import rows read their name or file', () => {
    expect(historyLine(row({ entity: 'settings', action: 'title', body: { op: 'created', name: 'مدیر' } })).values).toEqual({ name: 'مدیر' });
    expect(historyLine(row({ entity: 'import', action: 'customer_import', body: { file: 'a.xlsx' } }))).toEqual({
      key: 'history.action.customer_import', values: { file: 'a.xlsx' },
    });
    expect(historyLine(row({ entity: 'settings', action: 'name_match', body: { name: 'n', profile_name: 'p' } })).values).toEqual({ name: 'n', profile: 'p' });
  });
  it('an unknown audit action falls back to Edited', () => {
    expect(historyLine(row({ action: 'something_new' })).key).toBe('history.action.edited');
  });
  it('record rows use event.* keys', () => {
    const r = (action: string, body: Record<string, unknown> = {}) => row({ source: 'record', entity: 'record', action, body });
    expect(historyLine(r('created'))).toEqual({ key: 'event.created', values: {} });
    expect(historyLine(r('stage'))).toEqual({ key: 'history.recordStage', values: {} });
    expect(historyLine(r('comment', { text: 'hi' }))).toEqual({ key: 'history.recordComment', values: { text: 'hi' } });
    expect(historyLine(r('decision', { bid: true })).key).toBe('event.decisionBid');
    expect(historyLine(r('result', { result: 'won' })).values).toEqual({ result: 'won' });
    expect(historyLine(r('items', { action: 'added', code: '1.2' }))).toEqual({ key: 'event.item_added', values: { code: '1.2' } });
    expect(historyLine(r('finance', { what: 'payment', action: 'changed' })).key).toBe('event.finance_payment_changed');
    expect(historyLine(r('file', { action: 'delete', name: 'f' }))).toEqual({ key: 'event.file_delete', values: { name: 'f' } });
    expect(historyLine(r('edit', { changes: [{}, {}] }))).toEqual({ key: 'event.edit', values: { count: '2' } });
    expect(historyLine(r('mystery')).key).toBe('history.recordOther');
  });
  it('a deadline event (A1) renders done / reopened', () => {
    const body = (done: boolean, label: string | null) => ({ side: 'deadline_done', deadline: { label, kind: 'bond_due' }, done });
    const r = (b: Record<string, unknown>) => row({ source: 'record', entity: 'record', action: 'edit', body: b });
    expect(historyLine(r(body(true, 'x')))).toEqual({ key: 'event.deadlineDone', values: { name: 'x', kind: 'bond_due' } });
    expect(historyLine(r(body(false, null)))).toEqual({ key: 'event.deadlineUndone', values: { name: '', kind: 'bond_due' } });
  });
});

describe('changeList / isPrivateChanged', () => {
  it('a stripped people change keeps only the flag', () => {
    expect(changeList(row({ body: { changes: [{ field: 'people', private: true }], private_changed: true } }))).toEqual([{ field: 'people', private: true }]);
  });
  it('returns plain changes with from and to', () => {
    expect(changeList(row({ body: { changes: [{ field: 'name', from: 'a', to: 'b' }, { field: 'x', hidden: true }, { nofield: 1 }] } }))).toEqual([
      { field: 'name', from: 'a', to: 'b' }, { field: 'x', hidden: true },
    ]);
  });
  it('keeps people counts for readers who may see them', () => {
    expect(changeList(row({ body: { changes: [{ field: 'people', private: true, added: 1, removed: 0, changed: 2, from: [], to: [] }] } }))[0])
      .toMatchObject({ added: 1, removed: 0, changed: 2 });
  });
  it('no changes array gives an empty list', () => expect(changeList(row({ body: {} }))).toEqual([]));
  it('isPrivateChanged reads body.private_changed', () => {
    expect(isPrivateChanged(row({ body: { private_changed: true } }))).toBe(true);
    expect(isPrivateChanged(row({ body: {} }))).toBe(false);
  });
});

describe('small helpers', () => {
  it('historyOp and historySource accept only known words', () => {
    expect(historyOp(row({ body: { op: 'hidden' } }))).toBe('hidden');
    expect(historyOp(row({ body: { op: 'zzz' } }))).toBeNull();
    expect(historySource(row({ body: { source: 'ledger_import' } }))).toBe('ledger_import');
    expect(historySource(row({ body: {} }))).toBeNull();
  });
  it('personText joins name, title, numbers and email', () => {
    expect(personText({ name: 'Ali', title: 'QC', email: 'a@b.c', phones: [{ label: 'mobile', phone: '0912' }, { label: 'fax', phone: '021' }] }))
      .toBe('Ali · QC · 0912 · 021 · a@b.c');
    expect(personText({ title: { id: 't', name: 'CEO' }, phones: [] })).toBe('CEO');
  });
  it('formatChangeValue shows names of refs, lists and booleans', () => {
    const yn = { yes: 'Y', no: 'N' };
    expect(formatChangeValue(null, yn)).toBe('—');
    expect(formatChangeValue(true, yn)).toBe('Y');
    expect(formatChangeValue({ id: 'c', name: 'Tehran' }, yn)).toBe('Tehran');
    expect(formatChangeValue([{ rank: 2, category: { id: 'k', name: 'Roads' } }, { rank: 3, category: { id: 'j', name: 'Water' } }], yn)).toBe('2 · Roads، 3 · Water');
    expect(formatChangeValue(5, yn)).toBe('5');
  });
});
