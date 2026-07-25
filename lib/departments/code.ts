/**
 * Department-code helpers — the client-side mirror of the DB check constraint
 * departments_code_format (migration 20260713120001):
 *   code ~ '^[a-z0-9]{2,6}$'
 * The code is the latin prefix of every login code generated for the
 * department (prod → prod-1042), so it is validated in the form, in the server
 * action, and in Postgres. Keep the regex identical to the SQL.
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
