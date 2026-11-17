'use server';

/**
 * FR-94 ERP › Sales. Every read and write goes through the guarded
 * app_sales_* / app_project_* SECURITY DEFINER functions; the tables have no
 * client policies. Permissions are checked in the database (the caller's caps
 * come back from app_sales_bootstrap, live, not from the token).
 */

import { requireCaller } from '@/lib/auth/context';
import { dbErr, type DbErrorResult } from '@/lib/errors/db-error';
import { invalidateAppCache } from '@/lib/cache/invalidate-app';
import type { Json } from '@/lib/supabase/types';
import type { LedgerRow } from '@/lib/sales/ledger';
import type {
  Bootstrap, DeadlineRow, ImportResult, PriceHistoryRow, RecordDetail, RecordRow,
} from '@/lib/sales/types';

type Read<T> = { ok: true; data: T } | DbErrorResult;
type Write = { ok: true; id?: string } | DbErrorResult;
type Patch = Record<string, unknown>;

const json = (value: unknown) => value as Json;

export async function getSalesBootstrap(): Promise<Read<Bootstrap>> {
  const c = await requireCaller();
  if (!c.ok) return c;
  const { data, error } = await c.supabase.rpc('app_sales_bootstrap');
  if (error) return dbErr(error.message);
  return { ok: true, data: data as unknown as Bootstrap };
}

export async function listSalesRecords(): Promise<Read<RecordRow[]>> {
  const c = await requireCaller();
  if (!c.ok) return c;
  const { data, error } = await c.supabase.rpc('app_sales_list');
  if (error) return dbErr(error.message);
  return { ok: true, data: (data ?? []) as unknown as RecordRow[] };
}

export async function getSalesRecord(id: string): Promise<Read<RecordDetail>> {
  const c = await requireCaller();
  if (!c.ok) return c;
  const { data, error } = await c.supabase.rpc('app_sales_record', { p_id: id });
  if (error) return dbErr(error.message);
  return { ok: true, data: data as unknown as RecordDetail };
}

export async function listSalesDeadlines(includeDone = false): Promise<Read<DeadlineRow[]>> {
  const c = await requireCaller();
  if (!c.ok) return c;
  const { data, error } = await c.supabase.rpc('app_sales_deadlines', { p_include_done: includeDone });
  if (error) return dbErr(error.message);
  return { ok: true, data: (data ?? []) as unknown as DeadlineRow[] };
}

/** A typed record or item number → where it lives; `null` data when nothing matches. */
export async function findSalesNode(code: string): Promise<Read<{ rfp_id: string; node_id: string | null } | null>> {
  const c = await requireCaller();
  if (!c.ok) return c;
  const { data, error } = await c.supabase.rpc('app_sales_find_node', { p_code: code.slice(0, 80) });
  if (error) return dbErr(error.message);
  return { ok: true, data: (data ?? null) as { rfp_id: string; node_id: string | null } | null };
}

export async function getPriceHistory(query: string): Promise<Read<PriceHistoryRow[]>> {
  const c = await requireCaller();
  if (!c.ok) return c;
  const { data, error } = await c.supabase.rpc('app_sales_price_history', { p_q: query.slice(0, 200) });
  if (error) return dbErr(error.message);
  return { ok: true, data: (data ?? []) as unknown as PriceHistoryRow[] };
}

/** Create (`id` null; `patch.flow_kind`, optional `patch.record_no`) or edit a record. */
export async function saveSalesRecord(id: string | null, patch: Patch): Promise<Write> {
  const c = await requireCaller();
  if (!c.ok) return c;
  const { data, error } = await c.supabase.rpc('app_sales_save_record', { p_id: id, p: json(patch) });
  if (error) return dbErr(error.message);
  invalidateAppCache();
  return { ok: true, id: data as string };
}

/** Submit one stage page: only the changed fields, logged with the stage they were made on. */
export async function saveSalesStagePage(id: string, stageId: string, patch: Patch): Promise<Write> {
  const c = await requireCaller();
  if (!c.ok) return c;
  const { error } = await c.supabase.rpc('app_sales_save_record', { p_id: id, p: json(patch), p_stage: stageId });
  if (error) return dbErr(error.message);
  invalidateAppCache();
  return { ok: true, id };
}

export async function moveSalesStage(
  id: string, stageId: string, ownerId: string | null, note: string, submit: Patch | null
): Promise<Write> {
  const c = await requireCaller();
  if (!c.ok) return c;
  const { error } = await c.supabase.rpc('app_sales_move_stage', {
    p_id: id, p_stage: stageId, p_owner: ownerId, p_note: note || null, p_submit: submit ? json(submit) : null,
  });
  if (error) return dbErr(error.message);
  invalidateAppCache();
  return { ok: true };
}

export async function decideSalesBid(id: string, bid: boolean, reason: string): Promise<Write> {
  const c = await requireCaller();
  if (!c.ok) return c;
  const { error } = await c.supabase.rpc('app_sales_decide', { p_id: id, p_bid: bid, p_reason: reason || null });
  if (error) return dbErr(error.message);
  invalidateAppCache();
  return { ok: true };
}

export async function setSalesResult(
  id: string, result: 'won' | 'lost' | 'cancelled', details: { winning_bid?: number | null; winner_name?: string; reason?: string }
): Promise<Write> {
  const c = await requireCaller();
  if (!c.ok) return c;
  const { error } = await c.supabase.rpc('app_sales_result', { p_id: id, p_result: result, p: json(details) });
  if (error) return dbErr(error.message);
  invalidateAppCache();
  return { ok: true };
}

export async function addSalesComment(id: string, text: string): Promise<Write> {
  const c = await requireCaller();
  if (!c.ok) return c;
  const { error } = await c.supabase.rpc('app_sales_comment', { p_id: id, p_text: text });
  if (error) return dbErr(error.message);
  invalidateAppCache();
  return { ok: true };
}

export async function saveSalesBond(rfpId: string, id: string | null, patch: Patch): Promise<Write> {
  const c = await requireCaller();
  if (!c.ok) return c;
  const { data, error } = await c.supabase.rpc('app_sales_save_bond', { p_rfp: rfpId, p_id: id, p: json(patch) });
  if (error) return dbErr(error.message);
  invalidateAppCache();
  return { ok: true, id: data as string };
}

export async function deleteSalesBond(id: string): Promise<Write> {
  const c = await requireCaller();
  if (!c.ok) return c;
  const { error } = await c.supabase.rpc('app_sales_delete_bond', { p_id: id });
  if (error) return dbErr(error.message);
  invalidateAppCache();
  return { ok: true };
}

export async function saveSalesPayment(rfpId: string, id: string | null, patch: Patch): Promise<Write> {
  const c = await requireCaller();
  if (!c.ok) return c;
  const { data, error } = await c.supabase.rpc('app_sales_save_payment', { p_rfp: rfpId, p_id: id, p: json(patch) });
  if (error) return dbErr(error.message);
  invalidateAppCache();
  return { ok: true, id: data as string };
}

export async function deleteSalesPayment(id: string): Promise<Write> {
  const c = await requireCaller();
  if (!c.ok) return c;
  const { error } = await c.supabase.rpc('app_sales_delete_payment', { p_id: id });
  if (error) return dbErr(error.message);
  invalidateAppCache();
  return { ok: true };
}

export async function saveSalesDeadline(rfpId: string, id: string | null, patch: Patch): Promise<Write> {
  const c = await requireCaller();
  if (!c.ok) return c;
  const { data, error } = await c.supabase.rpc('app_sales_save_deadline', { p_rfp: rfpId, p_id: id, p: json(patch) });
  if (error) return dbErr(error.message);
  invalidateAppCache();
  return { ok: true, id: data as string };
}

export async function setSalesDeadlineDone(id: string, done: boolean): Promise<Write> {
  const c = await requireCaller();
  if (!c.ok) return c;
  const { error } = await c.supabase.rpc('app_sales_set_deadline_done', { p_id: id, p_done: done });
  if (error) return dbErr(error.message);
  invalidateAppCache();
  return { ok: true };
}

export async function deleteSalesDeadline(id: string): Promise<Write> {
  const c = await requireCaller();
  if (!c.ok) return c;
  const { error } = await c.supabase.rpc('app_sales_delete_deadline', { p_id: id });
  if (error) return dbErr(error.message);
  invalidateAppCache();
  return { ok: true };
}

export async function saveSalesDocument(rfpId: string, id: string | null, patch: Patch): Promise<Write> {
  const c = await requireCaller();
  if (!c.ok) return c;
  const { data, error } = await c.supabase.rpc('app_sales_save_document', { p_rfp: rfpId, p_id: id, p: json(patch) });
  if (error) return dbErr(error.message);
  invalidateAppCache();
  return { ok: true, id: data as string };
}

export async function deleteSalesDocument(id: string): Promise<Write> {
  const c = await requireCaller();
  if (!c.ok) return c;
  const { error } = await c.supabase.rpc('app_sales_delete_document', { p_id: id });
  if (error) return dbErr(error.message);
  invalidateAppCache();
  return { ok: true };
}

/** Add (`id` null; `parentId` null = a top-level item) or edit an item row. The number is assigned by the database. */
export async function saveProjectNode(
  rfpId: string, id: string | null, parentId: string | null, patch: Patch
): Promise<{ ok: true; id: string; code: string } | DbErrorResult> {
  const c = await requireCaller();
  if (!c.ok) return c;
  const { data, error } = await c.supabase.rpc('app_project_save_node', {
    p_rfp: rfpId, p_id: id, p_parent: parentId, p: json(patch),
  });
  if (error) return dbErr(error.message);
  invalidateAppCache();
  const out = data as { id: string; code: string };
  return { ok: true, id: out.id, code: out.code };
}

export async function deleteProjectNode(id: string): Promise<Write> {
  const c = await requireCaller();
  if (!c.ok) return c;
  const { error } = await c.supabase.rpc('app_project_delete_node', { p_id: id });
  if (error) return dbErr(error.message);
  invalidateAppCache();
  return { ok: true };
}

export async function setProjectColumns(rfpId: string, columns: Record<string, string[]>): Promise<Write> {
  const c = await requireCaller();
  if (!c.ok) return c;
  const { error } = await c.supabase.rpc('app_project_set_columns', { p_rfp: rfpId, p_columns: json(columns) });
  if (error) return dbErr(error.message);
  invalidateAppCache();
  return { ok: true };
}

export async function setSalesItemPrice(nodeId: string, price: number | null): Promise<Write> {
  const c = await requireCaller();
  if (!c.ok) return c;
  const { error } = await c.supabase.rpc('app_sales_set_item_price', { p_node: nodeId, p_price: price });
  if (error) return dbErr(error.message);
  invalidateAppCache();
  return { ok: true };
}

export async function saveSalesField(id: string | null, patch: Patch): Promise<Write> {
  const c = await requireCaller();
  if (!c.ok) return c;
  const { data, error } = await c.supabase.rpc('app_sales_save_field', { p_id: id, p: json(patch) });
  if (error) return dbErr(error.message);
  invalidateAppCache();
  return { ok: true, id: data as string };
}

export async function saveSalesStage(id: string | null, flowId: string | null, patch: Patch): Promise<Write> {
  const c = await requireCaller();
  if (!c.ok) return c;
  const { data, error } = await c.supabase.rpc('app_sales_save_stage', { p_id: id, p_flow: flowId, p: json(patch) });
  if (error) return dbErr(error.message);
  invalidateAppCache();
  return { ok: true, id: data as string };
}

export async function orderSalesStages(flowId: string, ids: string[]): Promise<Write> {
  const c = await requireCaller();
  if (!c.ok) return c;
  const { error } = await c.supabase.rpc('app_sales_order_stages', { p_flow: flowId, p_ids: ids });
  if (error) return dbErr(error.message);
  invalidateAppCache();
  return { ok: true };
}

export async function saveSalesSettings(patch: Patch): Promise<Write> {
  const c = await requireCaller();
  if (!c.ok) return c;
  const { error } = await c.supabase.rpc('app_sales_save_settings', { p: json(patch) });
  if (error) return dbErr(error.message);
  invalidateAppCache();
  return { ok: true };
}

/** Most rows one import call carries (next.config.ts raises the action body limit for it). */
const IMPORT_MAX_ROWS = 3000;

/**
 * Import ledger rows parsed in the browser (lib/sales/ledger.ts); the database
 * function checks every row again. `fields`: extra headers to keep as record
 * fields. `people`: ledger in-charge name → employee id, chosen in the preview.
 */
export async function importSalesLedger(
  fileName: string, rows: LedgerRow[], fields: string[], people: Record<string, string>
): Promise<Read<ImportResult>> {
  const c = await requireCaller();
  if (!c.ok) return c;
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > IMPORT_MAX_ROWS) return dbErr('sales: invalid input');
  const { data, error } = await c.supabase.rpc('app_sales_import', {
    p_file: fileName, p_rows: json(rows), p_fields: json(fields), p_people: json(people),
  });
  if (error) return dbErr(error.message);
  invalidateAppCache();
  return { ok: true, data: data as unknown as ImportResult };
}

export async function removeSalesBatch(batchId: string): Promise<Read<{ deleted: number; kept: number }>> {
  const c = await requireCaller();
  if (!c.ok) return c;
  const { data, error } = await c.supabase.rpc('app_sales_remove_batch', { p_batch: batchId });
  if (error) return dbErr(error.message);
  invalidateAppCache();
  return { ok: true, data: data as { deleted: number; kept: number } };
}

/**
 * Engineering adds a column while filling the Items table: the column joins the
 * company's column library and is shown at once at this depth of this record.
 * `columns`: the record's per-depth columns as they should be without the new one.
 */
export async function createItemColumn(
  rfpId: string, depth: number, columns: Record<string, string[]>,
  field: { label_fa: string; label_en: string; type: string }
): Promise<Write> {
  const c = await requireCaller();
  if (!c.ok) return c;
  const made = await c.supabase.rpc('app_sales_save_field', { p_id: null, p: json({ entity: 'item', ...field }) });
  if (made.error) return dbErr(made.error.message);
  const boot = await c.supabase.rpc('app_sales_bootstrap');
  if (boot.error) return dbErr(boot.error.message);
  const key = (boot.data as unknown as Bootstrap).fields.find((f) => f.id === made.data)?.key;
  if (!key) return dbErr('sales: not found');
  const next = { ...columns, [String(depth)]: [...(columns[String(depth)] ?? []), key] };
  const { error } = await c.supabase.rpc('app_project_set_columns', { p_rfp: rfpId, p_columns: json(next) });
  if (error) return dbErr(error.message);
  invalidateAppCache();
  return { ok: true, id: made.data as string };
}
