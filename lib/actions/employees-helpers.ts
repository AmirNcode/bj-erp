/**
 * Pure helper functions for employee actions.
 * No Supabase imports — safe to import in unit tests without env vars.
 */

import { randomInt } from 'node:crypto';

/**
 * Employee codes become the synthetic auth email local-part
 * (`code@bj-app.internal`), so they must stay within safe email characters.
 * Mirrors the in-DB check in app_create_employee (migration 20260702120001).
 */
export const EMPLOYEE_CODE_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export function normalizeEmployeeCode(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidEmployeeCode(code: string): boolean {
  return EMPLOYEE_CODE_RE.test(code);
}

/**
 * Returns the profile columns a caller may update.
 * Admin gets all writable columns; a non-admin manager gets a restricted subset.
 * RLS already restricts WHICH rows each role can update — this restricts WHICH columns.
 */
export function allowedProfileFields(isAdmin: boolean): string[] {
  if (isAdmin) {
    return [
      'full_name',
      'department_id',
      'manager_id',
      'hire_date',
      'active',
      'language_pref',
      'calendar_pref',
    ];
  }
  return ['full_name', 'hire_date'];
}

/**
 * Generates a readable ~10-char temporary password.
 * Excludes ambiguous characters: 0, O, I, i, l, L, o, 1 to avoid confusion when
 * the admin hands the code off verbally or on a printed slip.
 */
export function generateTempPassword(): string {
  // Charset: uppercase (no O, I), lowercase (no i, l, o — ambiguous), digits (no 0, 1), symbols
  const upper = 'ABCDEFGHJKMNPQRSTUVWXYZ'; // 23 chars
  const lower = 'abcdefghjkmnpqrstuvwxyz'; // 23 chars (no i, l, o — ambiguous)
  const digits = '23456789'; // 8 chars
  const symbols = '!@#$%^&*';
  const all = upper + lower + digits + symbols;

  // CSPRNG — these are real credentials handed to employees; Math.random()
  // output is predictable.
  const pick = (pool: string) => pool[randomInt(pool.length)];
  const required = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  const extra = Array.from({ length: 6 }, () => pick(all));
  const raw = [...required, ...extra];

  // Fisher–Yates shuffle
  for (let i = raw.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [raw[i], raw[j]] = [raw[j], raw[i]];
  }
  return raw.join('');
}
