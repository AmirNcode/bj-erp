/**
 * FR-94 §5 (CEO feedback): pure helpers for the Products catalog. A product pre-fills the empty
 * cells of an item row; values are copied, so later product edits never touch a saved row.
 * `applyProductDefaults` mirrors the SQL in `app_project_save_node` (same "empty" rule).
 */

import type { CustomValues, Product } from './types';

/** The shape of an item row's editable values (`ItemsTab`'s draft). */
export type ProductRowValues = {
  product_id?: string | null;
  product_type: string;
  size: string;
  rating: string;
  qty: number | null;
  unit: string;
  custom: CustomValues;
};

/** Language-neutral name stored on the row: English if set, else Persian (as the database does). */
export const productName = (p: Pick<Product, 'name_fa' | 'name_en'>): string => p.name_en || p.name_fa;

/** The name to show in the caller's language, falling back to the other one. */
export const productLabel = (p: Pick<Product, 'name_fa' | 'name_en'>, locale: string): string =>
  (locale === 'fa' ? p.name_fa || p.name_en : p.name_en || p.name_fa);

const blank = (v: unknown) => v === undefined || v === null || v === '';

export function applyProductDefaults<T extends ProductRowValues>(row: T, product: Product): T {
  const out: T = { ...row, custom: { ...row.custom }, product_id: product.id, product_type: productName(product) };
  for (const { field, default: value } of product.fields) {
    if (blank(value)) continue;
    if (field === 'size' || field === 'rating' || field === 'unit') {
      if (blank(out[field])) out[field] = String(value);
    } else if (field === 'qty') {
      if (out.qty === null || out.qty === undefined) out.qty = Number(value);
    } else if (blank(out.custom[field])) {
      out.custom[field] = value as CustomValues[string];
    }
  }
  return out;
}
