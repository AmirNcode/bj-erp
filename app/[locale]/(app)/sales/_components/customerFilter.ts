/** FR-94 §16.7: the customer lookup's pure filter (kept apart so a unit test can import it). */

import { nameKey } from '@/lib/sales/inquiry';
import type { CustomerRef } from '@/lib/sales/types';

export const COMBO_MAX = 30;

/**
 * Customers whose name key contains the typed key: exact key first, then keys that
 * start with it, then the rest (each group in list order); at most `max`.
 * Empty typed text lists the first `max` customers.
 */
export function filterCustomers(list: CustomerRef[], typed: string, max = COMBO_MAX): CustomerRef[] {
  const key = nameKey(typed);
  if (!key) return list.slice(0, max);
  const exact: CustomerRef[] = [];
  const prefix: CustomerRef[] = [];
  const inside: CustomerRef[] = [];
  for (const c of list) {
    const k = nameKey(c.name);
    if (k === key) exact.push(c);
    else if (k.startsWith(key)) prefix.push(c);
    else if (k.includes(key)) inside.push(c);
  }
  return [...exact, ...prefix, ...inside].slice(0, max);
}

/** The customer whose name key equals the typed key, if any. */
export function exactCustomer(list: CustomerRef[], typed: string): CustomerRef | null {
  const key = nameKey(typed);
  if (!key) return null;
  return list.find((c) => nameKey(c.name) === key) ?? null;
}
