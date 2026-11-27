/**
 * FR-94: reading the client's contract ledger ("BJ Contract" sheet) into rows the
 * database import accepts (app_sales_import), and the template that carries the
 * exact headers. Pure; runs in the browser, so the file itself is never uploaded.
 *
 * The ledger repeats three headers (Date, Amount, Bank Guarrenty…) once per
 * guarantee / payment block, so those are read by POSITION after the block's
 * anchor column (% of Guarrenty PBG, % of Down n APG, Payment n).
 */

import { toAsciiDigits } from '@/lib/employees/code';
import { parseUserDate } from '@/lib/leave/parseUserDate';
import { matchCurrency } from './money';
import type { Currency } from './types';
import type { Cell } from './xlsx';

/** Template row 2: the ledger's own header text, in its order. */
export const LEDGER_HEADERS: string[] = [
  'Rec', 'Company', 'Client', 'Government (G) / Contractor ( C )', 'Request No.', 'Project Site',
  'Delivery No.', 'Day', 'Order Issuance Date', 'Contract Starting Date / LOI', 'Pre Payment ( yes ? no )',
  'Pre Payment Date', 'Delivery Date', 'Addendum', 'Description', 'Total Value', 'Currency', 'Status',
  'In Charge Person',
  '% of Guarrenty PBG', 'Bank Guarrenty (Yes?No?Safteh?Cheque)', 'Date', 'Amount',
  '% of Down 1 APG', 'Bank Guarrenty (Yes?No?Safteh?Cheque)', 'Date', 'Amount',
  '% of Down 2 APG', 'Bank Guarrenty (Yes?No?Safteh?Cheque)', 'Date', 'Amount',
  '% of Down 3 APG', 'Bank Guarrenty (Yes?No?Safteh?Cheque)', 'Date', 'Amount',
  '% of Down 4 APG', 'Bank Guarrenty (Yes?No?Safteh?Cheque)', 'Date', 'Amount',
  'Payment 1', 'Date', 'Payment 2', 'Date', 'Payment 3', 'Date', 'Payment 4', 'Date',
];

/** Template row 1: block titles above the guarantee and payment columns (no names). */
export function templateRows(): Cell[][] {
  const groups: Cell[] = LEDGER_HEADERS.map(() => null);
  groups[19] = 'حسن انجام کار (PBG)';
  groups[23] = 'پیش‌پرداخت مرحله اول (APG 1)';
  groups[27] = 'پیش‌پرداخت‌های مرحله دوم، سوم، چهارم (APG 2-4)';
  groups[39] = 'پرداختی‌ها (Payments)';
  return [groups, [...LEDGER_HEADERS]];
}

export type LedgerBond = {
  kind: 'performance' | 'advance_payment';
  seq: number;
  /** A fraction: 0.1 = 10%. */
  percent: number | null;
  form: 'bank' | 'safteh' | 'cheque' | null;
  issued_on: string | null;
  amount: number | null;
  status: 'void' | null;
  note: string | null;
};

export type LedgerRow = {
  rec: number;
  buyer: string | null;
  client: string | null;
  kind: 'government' | 'contractor' | 'private' | null;
  customer_ref: string | null;
  project_site: string | null;
  delivery_amount: number | null;
  delivery_unit: 'day' | 'week' | 'month' | null;
  /** The duration as written, when it is not one number ("4-12"). */
  delivery_text: string | null;
  order_date: string | null;
  contract_start: string | null;
  prepayment: boolean | null;
  prepayment_date: string | null;
  delivery_date: string | null;
  addendum: boolean | null;
  description: string | null;
  total_value: number | null;
  currency: string | null;
  status: string | null;
  in_charge: string | null;
  bonds: LedgerBond[];
  payments: { seq: number; amount: number | null; paid_on: string | null }[];
  /** Values of columns the ledger layout does not know, by header text. */
  custom: Record<string, string>;
};

export type LedgerIssueCode = 'rec_missing' | 'rec_duplicate' | 'bad_date' | 'bad_number' | 'bad_value';
export type LedgerIssue = {
  /** Spreadsheet row number (1-based). */
  row: number;
  column: string;
  value: string;
  /** error: the row is left out. warning: the cell is left empty, the row still imports. */
  level: 'warning' | 'error';
  code: LedgerIssueCode;
};

export type LedgerParse =
  | { ok: true; rows: LedgerRow[]; issues: LedgerIssue[]; unknown: string[]; missing: string[] }
  | { ok: false; reason: 'no_header' };

type Field =
  | 'rec' | 'buyer' | 'client' | 'kind' | 'customer_ref' | 'project_site' | 'delivery_amount' | 'delivery_unit'
  | 'order_date' | 'contract_start' | 'prepayment' | 'prepayment_date' | 'delivery_date' | 'addendum'
  | 'description' | 'total_value' | 'currency' | 'status' | 'in_charge';

/** Header text reduced to lower-case letters and digits. */
function headerKey(cell: Cell): string {
  return toAsciiDigits(String(cell ?? '')).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

const NAMED: Record<string, Field> = {
  rec: 'rec',
  company: 'buyer',
  client: 'client',
  governmentgcontractorc: 'kind',
  requestno: 'customer_ref',
  projectsite: 'project_site',
  deliveryno: 'delivery_amount',
  day: 'delivery_unit',
  orderissuancedate: 'order_date',
  contractstartingdateloi: 'contract_start',
  prepaymentyesno: 'prepayment',
  prepaymentdate: 'prepayment_date',
  deliverydate: 'delivery_date',
  addendum: 'addendum',
  description: 'description',
  totalvalue: 'total_value',
  currency: 'currency',
  status: 'status',
  inchargeperson: 'in_charge',
};

const FIELD_LABEL: Record<Field, string> = {
  rec: 'Rec', buyer: 'Company', client: 'Client', kind: 'Government (G) / Contractor ( C )',
  customer_ref: 'Request No.', project_site: 'Project Site', delivery_amount: 'Delivery No.',
  delivery_unit: 'Day', order_date: 'Order Issuance Date', contract_start: 'Contract Starting Date / LOI',
  prepayment: 'Pre Payment ( yes ? no )', prepayment_date: 'Pre Payment Date', delivery_date: 'Delivery Date',
  addendum: 'Addendum', description: 'Description', total_value: 'Total Value', currency: 'Currency',
  status: 'Status', in_charge: 'In Charge Person',
};

type Block = { kind: 'performance' | 'advance_payment' | 'payment'; seq: number; label: string };
type Column =
  | { type: 'field'; field: Field; label: string }
  | { type: 'block'; block: Block; part: 'percent' | 'form' | 'date' | 'amount'; label: string }
  | { type: 'unknown'; label: string };

function mapColumns(header: Cell[]): Column[] {
  let block: Block | null = null;
  return header.map((cell): Column => {
    const label = String(cell ?? '').replace(/\s+/g, ' ').trim();
    const key = headerKey(cell);
    if (!key) return { type: 'unknown', label: '' };
    if (NAMED[key]) return { type: 'field', field: NAMED[key], label };
    if (key === 'ofguarrentypbg' || key === 'ofguaranteepbg') {
      block = { kind: 'performance', seq: 1, label: 'PBG' };
      return { type: 'block', block, part: 'percent', label };
    }
    const apg = key.match(/^ofdown(\d)apg$/);
    if (apg) {
      block = { kind: 'advance_payment', seq: Number(apg[1]), label: `APG ${apg[1]}` };
      return { type: 'block', block, part: 'percent', label };
    }
    const pay = key.match(/^payment(\d)$/);
    if (pay) {
      block = { kind: 'payment', seq: Number(pay[1]), label: `Payment ${pay[1]}` };
      return { type: 'block', block, part: 'amount', label };
    }
    if (block) {
      if (key.startsWith('bankguarrenty') || key.startsWith('bankguarantee')) {
        return { type: 'block', block, part: 'form', label: `${block.label} · ${label}` };
      }
      if (key === 'date') return { type: 'block', block, part: 'date', label: `${block.label} · Date` };
      if (key === 'amount') return { type: 'block', block, part: 'amount', label: `${block.label} · Amount` };
    }
    return { type: 'unknown', label };
  });
}

const EMPTY = new Set(['', '-', '–', '—', '?', '؟']);

function text(cell: Cell): string | null {
  if (cell === null) return null;
  const value = typeof cell === 'number' ? String(cell) : cell.replace(/\s+/g, ' ').trim();
  return EMPTY.has(value) ? null : value;
}

/** A number, null for empty, or undefined when the cell holds something else. */
function number(cell: Cell): number | null | undefined {
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : undefined;
  const value = text(cell);
  if (value === null) return null;
  const cleaned = toAsciiDigits(value).replace(/[,،٬\s]/g, '').replace(/٫/g, '.');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return undefined;
  return Number(cleaned);
}

function yesNo(value: string): boolean | undefined {
  const v = value.toLowerCase();
  if (/^(y|yes|بله|دارد)$/.test(v)) return true;
  if (/^(n|no|خیر|ندارد)$/.test(v)) return false;
  return undefined;
}

/** The guarantee form cell: "Yes" means a bank guarantee, "No" none. */
function bondForm(value: string): { form: LedgerBond['form']; status: 'void' | null; note: string | null } | undefined {
  const v = value.toLowerCase();
  const status = /باطل|void|cancel/.test(v) ? 'void' : null;
  const note = status ? value : null;
  if (/^(n|no|خیر|ندارد)$/.test(v)) return { form: null, status: null, note: null };
  if (/safteh|سفته/.test(v)) return { form: 'safteh', status, note };
  if (/cheque|check|چک/.test(v)) return { form: 'cheque', status, note };
  if (/^(y|yes|بله)\b/.test(v) || /^yes/.test(v) || /bank|ضمانت/.test(v)) return { form: 'bank', status, note };
  return undefined;
}

const isBlank = (row: Cell[]) => row.every((c) => text(c) === null);

/**
 * Reads the sheet's rows. The header row is the first of the first five rows whose
 * first filled cell is "Rec". Rows without a usable Rec, and repeats of a Rec, are
 * errors and left out; anything else unreadable is a warning and that cell stays empty.
 */
export function parseLedger(sheet: Cell[][], currencies: Currency[]): LedgerParse {
  const headerIndex = sheet.slice(0, 5).findIndex((row) => headerKey(row.find((c) => text(c) !== null) ?? null) === 'rec');
  if (headerIndex < 0) return { ok: false, reason: 'no_header' };
  const columns = mapColumns(sheet[headerIndex]);
  const present = new Set(columns.flatMap((c) => (c.type === 'field' ? [c.field] : [])));
  const missing = (Object.keys(FIELD_LABEL) as Field[]).filter((f) => !present.has(f)).map((f) => FIELD_LABEL[f]);
  const unknown = [...new Set(columns.flatMap((c) => (c.type === 'unknown' && c.label ? [c.label] : [])))];

  const rows: LedgerRow[] = [];
  const issues: LedgerIssue[] = [];
  const seen = new Set<number>();

  for (let i = headerIndex + 1; i < sheet.length; i += 1) {
    const cells = sheet[i] ?? [];
    if (isBlank(cells)) continue;
    const rowNo = i + 1;
    const rowIssues: LedgerIssue[] = [];
    const warn = (column: string, cell: Cell, code: LedgerIssueCode) =>
      rowIssues.push({ row: rowNo, column, value: String(cell ?? ''), level: 'warning', code });

    const row: LedgerRow = {
      rec: 0, buyer: null, client: null, kind: null, customer_ref: null, project_site: null,
      delivery_amount: null, delivery_unit: null, delivery_text: null, order_date: null, contract_start: null,
      prepayment: null, prepayment_date: null, delivery_date: null, addendum: null, description: null,
      total_value: null, currency: null, status: null, in_charge: null, bonds: [], payments: [], custom: {},
    };
    let rec: number | null | undefined = null;
    let recCell: Cell = null;
    const blocks = new Map<string, { block: Block; percent: number | null; form: LedgerBond['form']; status: 'void' | null; note: string | null; date: string | null; amount: number | null }>();
    const blockOf = (block: Block) => {
      const id = `${block.kind}:${block.seq}`;
      let entry = blocks.get(id);
      if (!entry) {
        entry = { block, percent: null, form: null, status: null, note: null, date: null, amount: null };
        blocks.set(id, entry);
      }
      return entry;
    };
    const date = (label: string, cell: Cell): string | null => {
      const value = text(cell);
      if (value === null) return null;
      const iso = typeof cell === 'number' ? undefined : parseUserDate(value);
      if (iso) return iso;
      warn(label, cell, 'bad_date');
      return null;
    };

    columns.forEach((column, c) => {
      const cell = cells[c] ?? null;
      const value = text(cell);
      if (column.type === 'unknown') {
        if (column.label && value !== null) row.custom[column.label] = value;
        return;
      }
      if (column.type === 'block') {
        if (value === null) return;
        const entry = blockOf(column.block);
        if (column.part === 'date') entry.date = date(column.label, cell);
        else if (column.part === 'form') {
          const form = bondForm(value);
          if (form) Object.assign(entry, form);
          else warn(column.label, cell, 'bad_value');
        } else {
          const n = number(cell);
          if (n === undefined || n === null || n < 0) {
            if (n !== null) warn(column.label, cell, 'bad_number');
          } else if (column.part === 'percent') {
            // The ledger keeps fractions (0.1); a typed "10" means 10%.
            if (n <= 1) entry.percent = n;
            else if (n <= 100) entry.percent = n / 100;
            else warn(column.label, cell, 'bad_number');
          } else entry.amount = n;
        }
        return;
      }
      switch (column.field) {
        case 'rec':
          rec = number(cell);
          recCell = cell;
          break;
        case 'buyer': case 'client': case 'customer_ref': case 'project_site': case 'description':
        case 'status': case 'in_charge':
          row[column.field] = value;
          break;
        case 'kind': {
          if (value === null) break;
          const v = value.toLowerCase();
          if (v === 'g' || v.startsWith('gov')) row.kind = 'government';
          else if (v === 'c' || v.startsWith('con')) row.kind = 'contractor';
          else if (v === 'p' || v.startsWith('pri')) row.kind = 'private';
          else warn(column.label, cell, 'bad_value');
          break;
        }
        case 'delivery_amount': {
          if (value === null) break;
          const n = number(cell);
          if (typeof n === 'number' && n >= 0) row.delivery_amount = n;
          else row.delivery_text = value.slice(0, 100);
          break;
        }
        case 'delivery_unit': {
          if (value === null) break;
          const v = value.toLowerCase().replace(/s$/, '');
          if (v === 'day' || v === 'روز') row.delivery_unit = 'day';
          else if (v === 'week' || v === 'هفته') row.delivery_unit = 'week';
          else if (v === 'month' || v === 'mounth' || v === 'ماه') row.delivery_unit = 'month';
          else warn(column.label, cell, 'bad_value');
          break;
        }
        case 'order_date': case 'contract_start': case 'prepayment_date': case 'delivery_date':
          row[column.field] = date(column.label, cell);
          break;
        case 'prepayment': case 'addendum': {
          if (value === null) break;
          const yn = yesNo(value);
          if (yn === undefined) warn(column.label, cell, 'bad_value');
          else row[column.field] = yn;
          break;
        }
        case 'total_value': {
          const n = number(cell);
          if (typeof n === 'number' && n >= 0) row.total_value = n;
          else if (n !== null) warn(column.label, cell, 'bad_number');
          break;
        }
        case 'currency': {
          if (value === null) break;
          const code = matchCurrency(value, currencies);
          if (code) row.currency = code;
          else warn(column.label, cell, 'bad_value');
          break;
        }
      }
    });

    if (typeof rec !== 'number' || !Number.isInteger(rec) || rec < 1 || rec > 2147483647) {
      issues.push({ row: rowNo, column: 'Rec', value: String(recCell ?? ''), level: 'error', code: 'rec_missing' });
      continue;
    }
    if (seen.has(rec)) {
      issues.push({ row: rowNo, column: 'Rec', value: String(rec), level: 'error', code: 'rec_duplicate' });
      continue;
    }
    seen.add(rec);
    row.rec = rec;
    for (const entry of blocks.values()) {
      if (entry.block.kind === 'payment') {
        if ((entry.amount ?? 0) > 0 || entry.date) {
          row.payments.push({ seq: entry.block.seq, amount: entry.amount, paid_on: entry.date });
        }
      } else if (entry.percent !== null || entry.form !== null || entry.status || (entry.amount ?? 0) > 0) {
        // The Amount cells are formulas (% × total): a 0 with nothing else is not a guarantee.
        row.bonds.push({
          kind: entry.block.kind, seq: entry.block.seq, percent: entry.percent, form: entry.form,
          issued_on: entry.date, amount: entry.amount, status: entry.status, note: entry.note,
        });
      }
    }
    issues.push(...rowIssues);
    rows.push(row);
  }
  return { ok: true, rows, issues, unknown, missing };
}

/** Distinct in-charge names of the parsed rows, for the preview's name → employee mapping. */
export function inChargeNames(rows: LedgerRow[]): string[] {
  return [...new Set(rows.flatMap((r) => (r.in_charge ? [r.in_charge] : [])))].sort((a, b) => a.localeCompare(b));
}
