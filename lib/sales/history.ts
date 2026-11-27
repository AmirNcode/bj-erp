/**
 * FR-99: pure helpers behind the History tabs and the Sales › Activity page. A row is either a
 * `sales_audit` row (customer / product / settings / import) or a record event (`source: 'record'`).
 * Every key returned is a full key under the `sales` message namespace. No React.
 */

import { todayInAppTz } from '../appDate';
import type { HistoryChange, HistoryRow } from './types';

const str = (v: unknown): string => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** True when the reader lacks `sales_customers` and some private value was removed from this row's body. */
export function isPrivateChanged(row: Pick<HistoryRow, 'body'>): boolean {
  return row.body?.private_changed === true;
}

/**
 * A change whose values the database removed for this reader (`{field, private: true}` only).
 * Holders get private changes too, flagged `private` but with their `from` / `to`.
 */
export function isStrippedChange(c: HistoryChange): boolean {
  return c.private === true && c.from === undefined && c.to === undefined;
}

/**
 * The Tehran calendar day (YYYY-MM-DD) of a timestamp. The database sends timestamps in UTC, so the
 * first 10 characters are the UTC day: wrong between 00:00 and 03:30 Tehran time.
 */
export function tehranDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : todayInAppTz(d);
}

/** True when the rows hold this customer's own creation (by hand, a record form or an import). */
export function hasCreationRow(rows: Pick<HistoryRow, 'action' | 'entity_id'>[], entityId?: string): boolean {
  return rows.some((r) => (r.action === 'created' || r.action === 'imported_created') && (!entityId || r.entity_id === entityId));
}

/** The change lines of a row's body (`changes: [{field, from, to}]`); private ones have no from / to. */
export function changeList(row: Pick<HistoryRow, 'body'>): HistoryChange[] {
  const raw = row.body?.changes;
  if (!Array.isArray(raw)) return [];
  const out: HistoryChange[] = [];
  for (const item of raw) {
    const c = obj(item);
    if (typeof c.field !== 'string') continue;
    const change: HistoryChange = { field: c.field };
    if ('from' in c) change.from = c.from;
    if ('to' in c) change.to = c.to;
    if (c.private === true) change.private = true;
    if (c.hidden === true) change.hidden = true;
    for (const k of ['added', 'removed', 'changed'] as const) if (typeof c[k] === 'number') change[k] = c[k] as number;
    out.push(change);
  }
  return out;
}

export type HistoryLine = { key: string; values: Record<string, string> };

/** Audit actions whose message takes `{name}` from the body. */
const NAMED = new Set(['currency', 'stage', 'field', 'category', 'city', 'title']);
const FILED = new Set(['ledger_import', 'inquiry_import', 'customer_import', 'batch_removed']);
const PLAIN = ['created', 'edited', 'deleted', 'imported_created', 'imported_updated', 'removed_by_import_undo', 'stage_order', 'general'];

function recordLine(row: HistoryRow): HistoryLine {
  const b = row.body ?? {};
  switch (row.action) {
    case 'created': case 'import': case 'archived': case 'deleted': case 'restored':
      return { key: `event.${row.action}`, values: {} };
    case 'comment':
      return { key: 'history.recordComment', values: { text: str(b.text) } };
    case 'stage':
      return { key: 'history.recordStage', values: {} };
    case 'decision':
      return { key: b.bid ? 'event.decisionBid' : 'event.decisionNoBid', values: {} };
    case 'result':
      // `result` is the raw code (won / lost / cancelled): the renderer translates it with `result.<code>`.
      return { key: 'event.result', values: { result: str(b.result) } };
    case 'items': {
      const a = str(b.action);
      if (a === 'product') return { key: 'event.item_product', values: { code: str(b.code), product: str(b.product) } };
      if (a === 'columns') return { key: 'event.itemColumns', values: {} };
      if (a === 'added' || a === 'changed' || a === 'removed') return { key: `event.item_${a}`, values: { code: str(b.code) } };
      return { key: 'history.recordOther', values: {} };
    }
    case 'file':
      return { key: b.action === 'delete' ? 'event.file_delete' : 'event.file_add', values: { name: str(b.name) } };
    case 'finance': {
      const what = str(b.what);
      const a = str(b.action);
      if ((what === 'guarantee' || what === 'payment') && (a === 'added' || a === 'changed' || a === 'removed')) {
        return { key: `event.finance_${what}_${a}`, values: {} };
      }
      return { key: 'history.recordOther', values: {} };
    }
    case 'edit': {
      if (b.deadline && typeof b.done === 'boolean') {
        // A1: `name` is the label; with no label the renderer translates `deadline.kind.<kind>`.
        const d = obj(b.deadline);
        return { key: b.done ? 'event.deadlineDone' : 'event.deadlineUndone', values: { name: str(d.label), kind: str(d.kind) } };
      }
      const count = Array.isArray(b.changes) ? b.changes.length : Array.isArray(b.fields) ? b.fields.length : 1;
      return { key: 'event.edit', values: { count: String(count) } };
    }
    default:
      return { key: 'history.recordOther', values: {} };
  }
}

/** The one-line description of a row: a message key (full, under `sales`) plus its ICU values. */
export function historyLine(row: HistoryRow): HistoryLine {
  if (row.source === 'record' || row.entity === 'record') return recordLine(row);
  const b = row.body ?? {};
  const a = row.action;
  const key = `history.action.${a}`;
  if (a === 'renamed') return { key, values: { from: str(b.from), to: str(b.to) } };
  if (a === 'merged_into') return { key, values: { name: str(b.into_name) } };
  if (a === 'merged_from') return { key, values: { name: str(b.from_name) } };
  if (a === 'alias_added' || a === 'alias_removed') return { key, values: { name: str(b.name ?? b.alias) } };
  if (a === 'name_match') return { key, values: { name: str(b.name), profile: str(b.profile_name) } };
  if (FILED.has(a)) return { key, values: { file: str(b.file ?? row.entity_label) } };
  if (NAMED.has(a)) return { key, values: { name: str(b.name ?? row.entity_label) } };
  return { key: PLAIN.includes(a) ? key : 'history.action.edited', values: {} };
}

/** Settings rows: `created | edited | hidden | shown | deleted` (message `history.op.<op>`), else null. */
export function historyOp(row: Pick<HistoryRow, 'body'>): string | null {
  const op = row.body?.op;
  return typeof op === 'string' && ['created', 'edited', 'hidden', 'shown', 'deleted'].includes(op) ? op : null;
}

/** Where a created customer came from (`history.source.<name>`), else null. */
export function historySource(row: Pick<HistoryRow, 'body'>): 'record' | 'ledger_import' | 'inquiry_import' | 'import' | null {
  const s = row.body?.source;
  return s === 'record' || s === 'ledger_import' || s === 'inquiry_import' || s === 'import' ? s : null;
}

/** A phone-book entry of a history snapshot as one line: "Name · Title · numbers · email". */
export function personText(p: unknown): string {
  const o = obj(p);
  const title = typeof o.title === 'string' ? o.title : obj(o.title).name;
  const phones = Array.isArray(o.phones) ? o.phones.map((x) => str(obj(x).phone)).filter((x) => x !== '') : [];
  return [str(o.name), str(title), ...phones, str(o.email)].filter((x) => x !== '').join(' · ');
}

/**
 * A change value as plain text: `{id, name}` refs show the name, lists join with `، `, grades read
 * "rank · category", empty is `labels.empty` (default —). Booleans take the given labels.
 */
export function formatChangeValue(v: unknown, labels: { yes: string; no: string; empty?: string } = { yes: 'yes', no: 'no' }): string {
  const empty = labels.empty ?? '—';
  if (v === null || v === undefined || v === '') return empty;
  if (typeof v === 'boolean') return v ? labels.yes : labels.no;
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return empty;
    return v
      .map((x) => {
        const o = obj(x);
        if ('rank' in o && 'category' in o) return `${str(o.rank)} · ${str(obj(o.category).name ?? o.category)}`;
        return formatChangeValue(x, labels);
      })
      .join('، ');
  }
  const o = obj(v);
  if ('name' in o) return str(o.name) || empty;
  return JSON.stringify(v);
}
