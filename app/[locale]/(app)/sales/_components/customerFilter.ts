/** FR-94 §16.7 / FR-98 §6: the customer lookup's pure filter (kept apart so a unit test can import it). */

import { nameKey } from '@/lib/sales/inquiry';
import { filterByWords } from '@/lib/sales/customerSearch';
import type { CustomerRef } from '@/lib/sales/types';

export const COMBO_MAX = 30;

/**
 * Customers whose Farsi or English name holds every typed word (any order): exact name first,
 * then names that start with the text, then the rest (each group in list order); at most `max`.
 * Empty typed text lists the first `max` customers.
 */
export function filterCustomers(list: CustomerRef[], typed: string, max = COMBO_MAX): CustomerRef[] {
  return filterByWords(list, typed, max);
}

/** The customer whose Farsi or English name key equals the typed key, if any. */
export function exactCustomer(list: CustomerRef[], typed: string): CustomerRef | null {
  const key = nameKey(typed);
  if (!key) return null;
  return list.find((c) => nameKey(c.name) === key || (!!c.name_en && nameKey(c.name_en) === key)) ?? null;
}
