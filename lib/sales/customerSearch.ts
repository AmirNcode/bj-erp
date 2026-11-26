/**
 * FR-98 §6: one search rule for customers and the Records list. Words are split on white space
 * and folded with `nameKey` (the SQL twin is private.sales_word_key — keep them equal).
 * - matchAllWords: every typed word occurs in at least one field (picker, Customers tab, Records).
 * - matchAnyWords: how many meaningful typed words occur (the registration duplicate list).
 * Pure: imported by client components and unit tests.
 */

import { nameKey } from './inquiry';

/** The folded, non-empty words of a typed text. */
export function searchWords(typed: string): string[] {
  return typed.split(/\s+/).map(nameKey).filter((w) => w !== '');
}

/** Generic company words that say nothing about which company is meant (folded). */
export const GENERIC_WORDS: ReadonlySet<string> = new Set(
  ['شرکت', 'سهامی', 'خاص', 'عام', 'گروه', 'company', 'co', 'ltd', 'inc', 'group', 'و'].map(nameKey),
);

/** True when every typed word occurs in some field. No words → true. */
export function matchAllWords(fields: (string | null | undefined)[], typed: string): boolean {
  const words = searchWords(typed);
  if (words.length === 0) return true;
  const keys = fields.filter((f): f is string => !!f).map(nameKey);
  return words.every((w) => keys.some((k) => k.includes(w)));
}

/** Number of meaningful typed words (≥ 2 letters, not generic) found in some field. */
export function countAnyWords(fields: (string | null | undefined)[], typed: string): number {
  const words = [...new Set(searchWords(typed))].filter((w) => w.length >= 2 && !GENERIC_WORDS.has(w));
  const keys = fields.filter((f): f is string => !!f).map(nameKey);
  return words.filter((w) => keys.some((k) => k.includes(w))).length;
}

type Named = { name: string; name_en?: string | null };

/**
 * Customers whose names hold every typed word: exact name first, then names that start with
 * the typed text, then the rest (each group in list order); at most `max`. Empty text → first `max`.
 */
export function filterByWords<T extends Named>(list: T[], typed: string, max = Infinity): T[] {
  const key = nameKey(typed);
  if (!key) return list.slice(0, max);
  const exact: T[] = [];
  const prefix: T[] = [];
  const inside: T[] = [];
  for (const c of list) {
    if (!matchAllWords([c.name, c.name_en], typed)) continue;
    const keys = [nameKey(c.name), nameKey(c.name_en ?? '')];
    if (keys.includes(key)) exact.push(c);
    else if (keys.some((k) => k && k.startsWith(key))) prefix.push(c);
    else inside.push(c);
  }
  return [...exact, ...prefix, ...inside].slice(0, max);
}

/** Existing customers that share a meaningful word with the typed name(s), most words first; at most `max`. */
export function similarByWords<T extends Named>(list: T[], typed: string, max = 8): T[] {
  return list
    .map((c) => ({ c, n: countAnyWords([c.name, c.name_en], typed) }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, max)
    .map((x) => x.c);
}
