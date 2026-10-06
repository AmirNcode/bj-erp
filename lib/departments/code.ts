/**
 * Department-code helpers — the client-side mirror of the DB check constraint
 * departments_code_format (migration 20261005120001, FR-46):
 *   code ~ '^[A-Z0-9]{2,4}$'
 *
 * The code used to be the latin prefix of every login code generated for the
 * department (prod → prod-1042). Since 20260730130002 it prefixes nothing.
 * Since 2026-10-05 it is the key the bulk employee import matches departments
 * on, so it is short, uppercase and shown read-only on the Departments page.
 * Nobody types it in the app: `createDepartment` and the import generate it
 * when it is missing. Keep the regex identical to the SQL.
 */

import { toAsciiDigits } from '@/lib/employees/code';

export const DEPARTMENT_CODE_RE = /^[A-Z0-9]{2,4}$/;

/** Trims, uppercases, and converts Persian / Arabic-Indic digits to ASCII. */
export function normalizeDepartmentCode(value: string): string {
  return toAsciiDigits(value.trim()).toUpperCase();
}

/** Mirrors the SQL check: code ~ '^[A-Z0-9]{2,4}$'. */
export function isValidDepartmentCode(value: string): boolean {
  return DEPARTMENT_CODE_RE.test(value);
}

/**
 * Suggests a code from the English name — same rule the migration uses to
 * regenerate codes that do not fit (first 4 latin chars, uppercased).
 * Returns '' when the name yields fewer than 2 usable characters, so the
 * form leaves the field empty rather than proposing an invalid code.
 */
export function suggestDepartmentCode(nameEn: string): string {
  const base = nameEn.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  return base.length >= 2 ? base : '';
}

/** Longest code the DB constraint accepts. */
const MAX_CODE_LENGTH = 4;

/**
 * Base used when the English name yields fewer than 2 latin characters, so a
 * Farsi-only "English" field still produces a valid code instead of failing.
 */
const FALLBACK_BASE = 'DEP';

/**
 * Generates the code `createDepartment` and the bulk import store when none is
 * given, so it must be derived and it must be unique.
 *
 * `taken` is the set of codes already used in the company — passed in by the
 * caller, so this stays pure and unit-testable and does no I/O. It is only an
 * optimistic pre-check: the (company_id, code) unique index is the truth, and
 * `createDepartment` retries on a 23505 race with the loser's code added to
 * `taken`.
 *
 * base = suggestDepartmentCode(nameEn) or 'DEP'; on collision an incrementing
 * numeric suffix is appended, truncating the base so the total never exceeds
 * the `^[A-Z0-9]{2,4}$` constraint (FINA → FIN2 … FI10 … F100).
 */
export function generateDepartmentCode(nameEn: string, taken: Iterable<string>): string {
  const used = new Set(Array.from(taken, (code) => code.trim().toUpperCase()));
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
