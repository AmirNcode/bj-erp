/** FR-94 §16.7: pure helpers behind the Customers tab (search, sort, year labels). */

import DateObject from 'react-date-object';
import gregorian from 'react-date-object/calendars/gregorian';
import gregorian_en from 'react-date-object/locales/gregorian_en';
import persian from 'react-date-object/calendars/persian';
import persian_en from 'react-date-object/locales/persian_en';
import { nameKey } from './inquiry';
import { CURRENCIES, type CustomerFilters, type CustomerSummary, type ResultFilter } from './types';

export type CustomerSortKey =
  | 'name' | 'records' | 'open' | 'won' | 'lost' | 'no_bid' | 'archived'
  | 'win_rate' | 'first_inquiry' | 'last_inquiry' | 'next_deadline' | 'main_owner_name'
  | `sales:${string}` | `quoted:${string}`;

/** The sort value of a row: a per-currency money key reads that currency's sum (missing = null). */
function sortValue(r: CustomerSummary, key: CustomerSortKey): string | number | null {
  if (key.startsWith('sales:')) return r.sales?.[key.slice(6)] ?? null;
  if (key.startsWith('quoted:')) return r.quoted?.[key.slice(7)] ?? null;
  return r[key as keyof CustomerSummary] as string | number | null;
}

/** Currencies present in the rows' `sales` or `quoted` sums: the known order first, others by code. */
export function presentCurrencies(rows: CustomerSummary[], field: 'sales' | 'quoted'): string[] {
  const seen = new Set<string>();
  for (const r of rows) for (const cur of Object.keys(r[field] ?? {})) seen.add(cur);
  const known = CURRENCIES.filter((c) => seen.has(c)) as string[];
  const rest = [...seen].filter((c) => !(CURRENCIES as readonly string[]).includes(c)).sort();
  return [...known, ...rest];
}

/**
 * Gregorian ISO dates of 1 Farvardin of the Persian year holding `todayIso` and of the year before.
 * Computed with the calendar library, never hardcoded (Nowruz is 20 or 21 March).
 */
export function persianYearStarts(todayIso: string): { yearStart: string; prevYearStart: string } {
  const [year, month, day] = todayIso.split('-').map(Number);
  const py = new DateObject({ calendar: gregorian, locale: gregorian_en, year, month, day })
    .convert(persian, persian_en).year;
  const start = (y: number) =>
    new DateObject({ calendar: persian, locale: persian_en, year: y, month: 1, day: 1 })
      .convert(gregorian, gregorian_en).format('YYYY-MM-DD');
  return { yearStart: start(py), prevYearStart: start(py - 1) };
}

/** Customers whose name key contains the typed key (empty search keeps everyone). */
export function searchCustomers(rows: CustomerSummary[], typed: string): CustomerSummary[] {
  const key = nameKey(typed);
  return key ? rows.filter((r) => nameKey(r.name).includes(key)) : rows;
}

/** Sorted copy; a missing value (no win rate, no deadline) always goes last. Ties by name. */
export function sortCustomers(rows: CustomerSummary[], key: CustomerSortKey, dir: 'asc' | 'desc'): CustomerSummary[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = sortValue(a, key);
    const y = sortValue(b, key);
    if (x === null && y === null) return a.name.localeCompare(b.name, 'fa');
    if (x === null) return 1;
    if (y === null) return -1;
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'fa');
    return c !== 0 ? sign * c : a.name.localeCompare(b.name, 'fa');
  });
}

/**
 * The Persian year that holds most of Gregorian year `y` (Jan to 20 March is the
 * previous Persian year, the other ~286 days belong to y − 621).
 */
export function persianYearOf(y: number): number {
  return y - 621;
}

/** Bar width in percent of the largest total (at least 2 so a small bar stays visible). */
export function barPercent(total: number, max: number): number {
  if (max <= 0 || total <= 0) return 0;
  return Math.max(2, Math.round((total / max) * 100));
}

export const RESULTS: ResultFilter[] = ['won', 'lost', 'no_bid', 'cancelled', 'open', 'archived'];

/** Reads the filter params from a Next searchParams object; unknown values are dropped. */
export function parseCustomerFilters(sp: Record<string, string | string[] | undefined>, opts: { kind: boolean }): CustomerFilters {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
  const date = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  const result = one(sp.result) as ResultFilter;
  const kind = one(sp.kind);
  const owner = one(sp.owner);
  return {
    from: date(one(sp.from)),
    to: date(one(sp.to)),
    result: RESULTS.includes(result) ? result : undefined,
    owner: /^[0-9a-f-]{36}$/i.test(owner) ? owner : undefined,
    kind: opts.kind && (kind === 'government' || kind === 'contractor') ? kind : undefined,
  };
}

