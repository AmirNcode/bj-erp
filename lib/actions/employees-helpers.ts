/**
 * Pure helper functions for employee actions.
 * No Supabase imports — safe to import in unit tests without env vars.
 */

import { randomInt } from 'node:crypto';

/**
 * Returns the profile columns a caller may send through `updateEmployee`.
 * Admin: every writable column. hr (FR-51): name, hire date, department,
 * manager, job title — `active` goes through `setActive`. Manager: name and hire
 * date. The profile guard trigger enforces the same per target row (an hr caller
 * gets nothing on an admin or on themselves); this restricts WHICH columns.
 */
export function allowedProfileFields(roles: string[]): string[] {
  if (roles.includes('admin')) {
    return [
      'full_name',
      'department_id',
      'manager_id',
      'hire_date',
      'job_title',
      'active',
      'language_pref',
    ];
  }
  if (roles.includes('hr')) {
    return ['full_name', 'department_id', 'manager_id', 'hire_date', 'job_title'];
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
