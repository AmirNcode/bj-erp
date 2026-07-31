/**
 * Department-code helpers — the client-side mirror of the DB check constraint
 * departments_code_format (migration 20260713120001):
 *   code ~ '^[a-z0-9]{2,6}$'
 *
 * The code used to be the latin prefix of every login code generated for the
 * department (prod → prod-1042). Since 20260730130002 it prefixes nothing:
 * nothing reads it, no human types it, and `createDepartment` generates it.
 * The column stays NOT NULL + unique so the feature can return without a
 * migration (spec 2026-07-30, §6.1 / D12). Keep the regex identical to the SQL.
 */

import { toAsciiDigits } from '@/lib/employees/code';

export const DEPARTMENT_CODE_RE = /^[a-z0-9]{2,6}$/;

/** Trims, lowercases, and converts Persian / Arabic-Indic digits to ASCII. */
export function normalizeDepartmentCode(value: string): string {
  return toAsciiDigits(value.trim()).toLowerCase();
}

/** Mirrors the SQL check: code ~ '^[a-z0-9]{2,6}$'. */
export function isValidDepartmentCode(value: string): boolean {
  return DEPARTMENT_CODE_RE.test(value);
}

/**
 * Suggests a code from the English name — same rule the migration used to
 * backfill pre-existing departments (first 4 latin chars, lowercased).
 * Returns '' when the name yields fewer than 2 usable characters, so the
 * form leaves the field empty rather than proposing an invalid code.
 */
export function suggestDepartmentCode(nameEn: string): string {
  const base = nameEn.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 4);
  return base.length >= 2 ? base : '';
}

/** Longest code the DB constraint accepts. */
const MAX_CODE_LENGTH = 6;

/**
 * Base used when the English name yields fewer than 2 latin characters, so a
 * Farsi-only "English" field still produces a valid code instead of failing.
 */
const FALLBACK_BASE = 'dep';

/**
 * Generates the code `createDepartment` stores. Nobody types it any more
 * (spec 2026-07-30 §6.1), so it must be derived and it must be unique.
 *
 * `taken` is the set of codes already used in the company — passed in by the
 * caller, so this stays pure and unit-testable and does no I/O. It is only an
 * optimistic pre-check: the (company_id, code) unique index is the truth, and
 * `createDepartment` retries on a 23505 race with the loser's code added to
 * `taken`.
 *
 * base = suggestDepartmentCode(nameEn) or 'dep'; on collision an incrementing
 * numeric suffix is appended, truncating the base so the total never exceeds
 * the `^[a-z0-9]{2,6}$` constraint (prod → prod2 … pro100 … pr1000).
 */
export function generateDepartmentCode(nameEn: string, taken: Iterable<string>): string {
  const used = new Set(Array.from(taken, (code) => code.trim().toLowerCase()));
  const base = suggestDepartmentCode(nameEn) || FALLBACK_BASE;
  if (!used.has(base)) return base;

  // Every candidate below is a distinct string, and so is `base`, so among
  // used.size + 1 of them at least one must be free. The loop cannot run away.
  for (let n = 2; n <= used.size + 2; n++) {
    const suffix = String(n);
    const candidate = base.slice(0, Math.max(0, MAX_CODE_LENGTH - suffix.length)) + suffix;
    if (!used.has(candidate)) return candidate;
  }

  // Unreachable by the pigeonhole argument above; if it ever fires, the unique
  // index rejects the insert and createDepartment surfaces a real error.
  return base;
}
