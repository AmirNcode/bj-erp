import { describe, expect, it } from 'vitest';
import { canEditKey, draftFrom, draftPatch, isDirty, nextGate, pageFields, pageKind, pageMode, rebaseDraft, toRecordPatch } from '@/lib/sales/stagePages';
import type { FieldDef, RecordRow, SalesCaps, Stage } from '@/lib/sales/types';

const stage = (code: string | null, position: number, extra: Partial<Stage> = {}): Stage => ({
  id: code ?? `s${position}`, flow_id: 'bid', position, name_fa: String(code), name_en: String(code), kind: 'open',
  action: null, code, owner_role_id: null, required: [], active: true, ...extra,
});
const bid = [
  stage('received', 1), stage('decision', 2, { action: 'decide' }), stage('technical', 3),
  stage('pricing', 4, { action: 'quote' }), stage('ready', 5), stage('submitted', 6, { action: 'submit' }),
  stage('lost', 7, { kind: 'lost' }), stage('no_bid', 8, { kind: 'no_bid' }), stage('cancelled', 9, { kind: 'cancelled' }),
];
const contract = [
  stage('new', 1, { flow_id: 'con' }), stage('current', 2, { flow_id: 'con' }), stage('hold', 3, { flow_id: 'con' }),
  stage('finish', 4, { flow_id: 'con', kind: 'done' }), stage('cancel', 5, { flow_id: 'con', kind: 'cancelled' }),
];
const caps = (extra: Partial<SalesCaps> = {}): SalesCaps => ({
  edit: true, prices: false, prices_edit: false, bonds: false, bonds_edit: false, decide: false,
  reports: false, settings: false, items: false, items_edit: false, remove_records: false,
  customers: false, customers_import: false, ...extra,
});
const rec = (extra: Partial<RecordRow>): RecordRow => ({
  stage_id: 'technical', stage_kind: 'open', flow_id: 'bid', flow_kind: 'bid', bid_decision: 'bid', needs_quote: true,
  custom: {}, received_by: null, ...extra,
} as RecordRow);

describe('pageKind', () => {
  it('maps seeded codes, closed kinds and code-less stages', () => {
    expect(bid.slice(0, 6).map(pageKind)).toEqual(['received', 'decision', 'technical', 'pricing', 'ready', 'submitted']);
    expect(pageKind(bid[6])).toBe('closed');
    expect(contract.map(pageKind)).toEqual(['contract_new', 'contract_current', 'contract_hold', 'closed', 'closed']);
    expect(pageKind(stage(null, 10))).toBe('generic');
  });
});

describe('pageMode', () => {
  it('future stages are view-only, past stages editable', () => {
    expect(pageMode(bid[4], rec({}), bid, caps())).toBe('view');
    expect(pageMode(bid[0], rec({}), bid, caps())).toBe('edit');
    expect(pageMode(bid[2], rec({}), bid, caps())).toBe('edit');
  });
  it('closed records need decide; read-only callers never edit', () => {
    const closed = rec({ stage_id: 'lost', stage_kind: 'lost' });
    expect(pageMode(bid[0], closed, bid, caps())).toBe('view');
    expect(pageMode(bid[0], closed, bid, caps({ decide: true }))).toBe('edit');
    expect(pageMode(bid[0], rec({}), bid, caps({ edit: false }))).toBe('view');
  });
});

describe('pageFields', () => {
  const defs = [
    { key: 'x_a', entity: 'rfp', active: true } as FieldDef,
    { key: 'x_b', entity: 'rfp', active: true } as FieldDef,
    { key: 'x_i', entity: 'item', active: true } as FieldDef,
  ];
  const stages = bid.map((s) => (s.code === 'ready' ? { ...s, required: ['x_b', 'received_by'] } : s));
  it('custom record fields go on Received unless a stage requires them', () => {
    expect(pageFields(stages[0], stages, defs)).toContain('custom.x_a');
    expect(pageFields(stages[0], stages, defs)).not.toContain('custom.x_b');
    expect(pageFields(stages[4], stages, defs)).toEqual(['received_by', 'custom.x_b']);
    expect(pageFields(stages[5], stages, defs)).toEqual(['submitted_on', 'delivery_method', 'received_by', 'validity_days']);
  });
  it('a code-less stage shows its required fields', () => {
    expect(pageFields(stage(null, 10, { required: ['description'] }), bid, defs)).toEqual(['description']);
  });
});

describe('draft', () => {
  it('sends changed keys only', () => {
    expect(draftPatch({ a: 1, b: 2 }, { a: 1, b: 3 })).toEqual({ b: 3 });
    expect(draftPatch({ a: 1, custom: { x: '1' } }, { a: 1, custom: { x: '1', y: '2' } })).toEqual({ custom: { y: '2' } });
    expect(draftPatch({ custom: { x: '1', y: '2' } }, { custom: { y: '2' } })).toEqual({ custom: { x: null } });
    expect(draftPatch({ a: 1, custom: { x: '1' } }, { a: 1, custom: { x: '1' } })).toEqual({});
  });
  it('is dirty when anything differs', () => {
    expect(isDirty({ a: '' }, { a: '' })).toBe(false);
    expect(isDirty({ a: '' }, { a: 'x' })).toBe(true);
  });
});

describe('nextGate', () => {
  it('unsaved edits block Next', () => {
    expect(nextGate(rec({}), bid, caps(), true).blocked).toBe('dirty');
  });
  it('skips Pricing without a quote', () => {
    expect(nextGate(rec({ needs_quote: false }), bid, caps(), false).target?.code).toBe('ready');
    expect(nextGate(rec({}), bid, caps(), false)).toEqual({ target: bid[3], blocked: null, missing: [] });
  });
  it('checks required fields against the stored record', () => {
    const stages = bid.map((s) => (s.code === 'technical' ? { ...s, required: ['received_by', 'x_c'] } : s));
    const g = nextGate(rec({ custom: { x_c: 'y' } }), stages, caps(), false);
    expect(g.blocked).toBe('required');
    expect(g.missing).toEqual(['received_by']);
  });
  it('Submitted and contract Current end with their own actions; contract Next skips Hold', () => {
    expect(nextGate(rec({ stage_id: 'submitted' }), bid, caps(), false).blocked).toBe('end');
    const c = rec({ stage_id: 'new', flow_id: 'con', flow_kind: 'contract' });
    expect(nextGate(c, contract, caps(), false).target?.code).toBe('current');
    expect(nextGate({ ...c, stage_id: 'current' }, contract, caps(), false).blocked).toBe('end');
  });
  it('no edit right, or a closed record, blocks Next', () => {
    expect(nextGate(rec({}), bid, caps({ edit: false }), false).blocked).toBe('right');
    expect(nextGate(rec({ stage_id: 'lost', stage_kind: 'lost' }), bid, caps({ decide: true }), false).blocked).toBe('right');
  });
});

describe('draftFrom', () => {
  it('reads page fields off the record; customers by id, custom whole', () => {
    const r = rec({ buyer_id: 'c1', buyer_name: 'NIOC', client_id: null, proposal_due: '2026-11-15', custom: { x_a: 'v' } });
    expect(draftFrom(r, ['buyer', 'client', 'proposal_due', 'custom.x_a'])).toEqual({
      buyer: 'c1', client: '', proposal_due: '2026-11-15', custom: { x_a: 'v' },
    });
  });
  it('customer fields go to the database as ids; the company type is never sent', () => {
    expect(toRecordPatch({ buyer: 'c1', client: '', buyer_kind: 'contractor', title: 't' }))
      .toEqual({ buyer_id: 'c1', client_id: null, title: 't' });
  });
});

describe('rebaseDraft', () => {
  it('takes the new stored value for untouched keys and keeps what the user typed', () => {
    const before = { a: '1', b: '1', custom: { x: '1', y: '1' } };
    const after = { a: '2', b: '2', custom: { x: '2', y: '2' } };
    const draft = { a: '1', b: 'typed', custom: { x: '1', y: 'typed' } };
    expect(rebaseDraft(before, after, draft)).toEqual({ a: '2', b: 'typed', custom: { x: '2', y: 'typed' } });
  });
  it('after a Submit the draft equals the record again', () => {
    const before = { a: '1' }; const draft = { a: 'new' }; const after = { a: 'new' };
    expect(isDirty(after, rebaseDraft(before, after, draft))).toBe(false);
  });
});

describe('canEditKey', () => {
  const allCaps = caps({ prices: true, prices_edit: true, decide: true });
  it('prices need prices_edit; our price is fixed when items are priced; reasons need decide', () => {
    expect(canEditKey('our_price', caps({ prices: true }), rec({}), false)).toBe(false);
    expect(canEditKey('our_price', allCaps, rec({}), true)).toBe(false);
    expect(canEditKey('decision_reason', caps(), rec({}), false)).toBe(false);
    expect(canEditKey('title', caps(), rec({}), false)).toBe(true);
  });
});
