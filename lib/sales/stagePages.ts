/**
 * Sales stage pages (docs/specs/2026-11-17-sales-stage-pages-design.md). Pure: which
 * page a stage shows, which fields it edits, whether it is editable, the draft patch
 * and whether Next stage is allowed. The database checks every rule again.
 */

import { flowStages } from './stages';
import type { FieldDef, RecordRow, SalesCaps, Stage } from './types';

export type PageKind =
  | 'received' | 'decision' | 'technical' | 'pricing' | 'ready' | 'submitted' | 'closed'
  | 'contract_new' | 'contract_current' | 'contract_hold' | 'generic';

export type PageMode = 'edit' | 'view';

const BY_CODE: Record<string, PageKind> = {
  received: 'received', decision: 'decision', technical: 'technical', pricing: 'pricing', ready: 'ready',
  submitted: 'submitted', new: 'contract_new', current: 'contract_current', hold: 'contract_hold',
};

export function pageKind(stage: Stage): PageKind {
  if (stage.kind !== 'open') return 'closed';
  return (stage.code && BY_CODE[stage.code]) || 'generic';
}

/** Record keys each page edits (spec §7). `buyer` / `client` are written by name. */
export const PAGE_FIELDS: Record<PageKind, string[]> = {
  received: ['title', 'buyer', 'buyer_kind', 'client', 'customer_ref', 'source', 'received_on', 'project_site',
    'description', 'owner_id', 'currency', 'proposal_due', 'needs_quote', 'quote_due', 'needs_bond', 'bond_due'],
  decision: ['decision_reason'],
  technical: [],
  pricing: ['our_price'],
  ready: [],
  submitted: ['submitted_on', 'delivery_method', 'received_by', 'validity_days'],
  closed: ['result_reason', 'winning_bid', 'winner_name'],
  contract_new: ['total_value', 'order_date', 'contract_start', 'delivery_amount', 'delivery_unit', 'delivery_text',
    'delivery_date', 'prepayment', 'prepayment_date', 'addendum', 'owner_id'],
  contract_current: ['delivery_date', 'owner_id'],
  contract_hold: [],
  generic: [],
};

/**
 * Fields shown on a stage page: its own fields, then its `required` keys not already
 * there (custom keys as `custom.<key>`). Received also takes every active custom
 * record field that no other stage requires.
 */
export function pageFields(stage: Stage, stages: Stage[], defs: FieldDef[]): string[] {
  const customKeys = new Set(defs.filter((d) => d.entity === 'rfp').map((d) => d.key));
  const asField = (k: string) => (customKeys.has(k) ? `custom.${k}` : k);
  const kind = pageKind(stage);
  const own = [...PAGE_FIELDS[kind]];
  const req = stage.required.map(asField).filter((k) => !own.includes(k));
  const out = [...own, ...req.filter((k) => !k.startsWith('custom.')), ...req.filter((k) => k.startsWith('custom.'))];
  if (kind === 'received') {
    const elsewhere = new Set(stages.filter((s) => s.id !== stage.id).flatMap((s) => s.required));
    for (const d of defs) {
      if (d.entity === 'rfp' && d.active && !elsewhere.has(d.key) && !out.includes(`custom.${d.key}`)) out.push(`custom.${d.key}`);
    }
  }
  return out;
}

/** Editable unless: a stage not reached yet, a closed record without `decide`, or no edit right. */
export function pageMode(stage: Stage, record: RecordRow, stages: Stage[], caps: SalesCaps): PageMode {
  if (!caps.edit) return 'view';
  if (record.stage_kind !== 'open' && !caps.decide) return 'view';
  const current = stages.find((s) => s.id === record.stage_id);
  if (stage.id === current?.id) return 'edit';
  if (stage.kind !== 'open') return 'view';
  if (current && current.kind === 'open' && stage.flow_id === current.flow_id && stage.position > current.position) return 'view';
  return 'edit';
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Changed keys only. `custom` carries only its changed keys (null = removed): the
 * database merges them, so a colleague's edit to another custom field survives.
 */
export function draftPatch(original: Record<string, unknown>, draft: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(draft)) {
    if (k === 'custom') {
      const a = (original.custom ?? {}) as Record<string, unknown>;
      const b = (draft.custom ?? {}) as Record<string, unknown>;
      const changed: Record<string, unknown> = {};
      for (const x of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (!same(a[x], b[x])) changed[x] = b[x] ?? null;
      }
      if (Object.keys(changed).length) out.custom = changed;
    } else if (!same(original[k], draft[k])) {
      out[k] = draft[k];
    }
  }
  return out;
}

/**
 * The record changed under an open page (a refresh, someone else's write, this page's
 * own list rows): keys the user has not touched take the new stored value; what they
 * typed stays. Custom values per key.
 */
export function rebaseDraft(before: Record<string, unknown>, after: Record<string, unknown>,
  draft: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...draft };
  for (const k of Object.keys(after)) {
    if (k === 'custom') {
      const b = (before.custom ?? {}) as Record<string, unknown>;
      const a = (after.custom ?? {}) as Record<string, unknown>;
      const d = (draft.custom ?? {}) as Record<string, unknown>;
      const merged: Record<string, unknown> = {};
      for (const x of new Set([...Object.keys(a), ...Object.keys(b), ...Object.keys(d)])) {
        const v = same(d[x], b[x]) ? a[x] : d[x];
        if (v !== undefined && v !== null) merged[x] = v;
      }
      out.custom = merged;
    } else if (same(draft[k], before[k])) {
      out[k] = after[k];
    }
  }
  return out;
}

const PRICE_KEYS = new Set(['our_price', 'winning_bid', 'winner_name', 'total_value']);

/**
 * Whether this caller may type into a key: prices need `prices_edit` (our price is the
 * item sum once items are priced), the reasons need `decide`, and the company type is
 * fixed once the company has one (it belongs to the company, not to this record).
 */
export function canEditKey(key: string, caps: SalesCaps, record: RecordRow, pricedByItems: boolean): boolean {
  if (PRICE_KEYS.has(key) && !(caps.prices && caps.prices_edit)) return false;
  if (key === 'our_price' && pricedByItems) return false;
  if ((key === 'decision_reason' || key === 'result_reason') && !caps.decide) return false;
  if (key === 'buyer_kind' && record.buyer_kind) return false;
  return true;
}

export function isDirty(original: Record<string, unknown>, draft: Record<string, unknown>): boolean {
  return Object.keys(draftPatch(original, draft)).length > 0;
}

export type NextGate = { target: Stage | null; blocked: null | 'dirty' | 'required' | 'right' | 'end'; missing: string[] };

/**
 * Where Next stage goes and what stops it. Pricing is skipped without a quote, contract
 * Hold is never a Next step, and Submitted / contract Current end in their own actions.
 * Required fields are checked on the stored record, so edits must be submitted first.
 */
export function nextGate(record: RecordRow, stages: Stage[], caps: SalesCaps, dirty: boolean): NextGate {
  if (!caps.edit || record.stage_kind !== 'open') return { target: null, blocked: 'right', missing: [] };
  const current = stages.find((s) => s.id === record.stage_id);
  const target = current
    ? flowStages(stages, current.flow_id).find((s) => s.position > current.position && s.kind === 'open'
        && s.code !== 'hold' && (record.needs_quote || s.action !== 'quote')) ?? null
    : null;
  if (!current || !target || current.action === 'submit') return { target: null, blocked: 'end', missing: [] };
  if (dirty) return { target, blocked: 'dirty', missing: [] };
  const values = record as unknown as Record<string, unknown>;
  const missing = current.required.filter((k) => {
    const v = values[k] ?? record.custom?.[k];
    return v === null || v === undefined || v === '';
  });
  if (missing.length) return { target, blocked: 'required', missing };
  return { target, blocked: null, missing: [] };
}

/** The page's draft, read off the record: customers by name, custom values as one object. */
export function draftFrom(record: RecordRow, fields: string[]): Record<string, unknown> {
  const values = record as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of fields) {
    if (k.startsWith('custom.')) out.custom = { ...(record.custom ?? {}) };
    else if (k === 'buyer') out.buyer = record.buyer_name ?? '';
    else if (k === 'client') out.client = record.client_name ?? '';
    else out[k] = values[k] ?? null;
  }
  return out;
}

/** The database reads the company type only together with the company name. */
export function withBuyer(patch: Record<string, unknown>, draft: Record<string, unknown>): Record<string, unknown> {
  return 'buyer_kind' in patch && !('buyer' in patch) ? { ...patch, buyer: draft.buyer } : patch;
}
