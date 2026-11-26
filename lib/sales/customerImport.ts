/** FR-98 bulk customer import: template and sheet parsing (pure; the file never leaves the browser as a file). */

import type { CustomerImportCells } from './types';
import type { Cell } from './xlsx';

export const CUSTOMER_IMPORT_COLUMNS = [
  'name', 'name_en', 'kind', 'ceo_name', 'province', 'city', 'address', 'rank', 'category',
  'contact_person', 'contact_title', 'contact_label', 'phone', 'email',
] as const;
export type CustomerImportColumn = (typeof CUSTOMER_IMPORT_COLUMNS)[number];

export const CUSTOMER_IMPORT_MAX_ROWS = 1000;

const text = (c: Cell | undefined): string => (c === null || c === undefined ? '' : String(c).trim());

/** Header row plus one example row, in column order. */
export function templateRows(headers: Record<CustomerImportColumn, string>, example: Record<CustomerImportColumn, string>): Cell[][] {
  return [CUSTOMER_IMPORT_COLUMNS.map((c) => headers[c]), CUSTOMER_IMPORT_COLUMNS.map((c) => example[c])];
}

function matchesHeaders(row: Cell[], headers: Record<CustomerImportColumn, string>): boolean {
  return CUSTOMER_IMPORT_COLUMNS.every((c, i) => text(row[i]) === headers[c].trim());
}

export function parseCustomerSheet(
  rows: Cell[][],
  headersFa: Record<CustomerImportColumn, string>,
  headersEn: Record<CustomerImportColumn, string>,
): { rows: CustomerImportCells[] } | { error: 'empty' | 'tooMany' } {
  const first = rows[0];
  const start = first && (matchesHeaders(first, headersFa) || matchesHeaders(first, headersEn)) ? 1 : 0;
  const out: CustomerImportCells[] = [];
  for (let i = start; i < rows.length; i += 1) {
    const cells = rows[i] ?? [];
    const values = CUSTOMER_IMPORT_COLUMNS.map((_, k) => text(cells[k]));
    if (values.every((v) => v === '')) continue;
    const item: CustomerImportCells = { row: i + 1 };
    CUSTOMER_IMPORT_COLUMNS.forEach((c, k) => { if (values[k] !== '') item[c] = values[k]; });
    out.push(item);
  }
  if (out.length === 0) return { error: 'empty' };
  if (out.length > CUSTOMER_IMPORT_MAX_ROWS) return { error: 'tooMany' };
  return { rows: out };
}
