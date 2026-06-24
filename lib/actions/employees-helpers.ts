/**
 * Pure helper functions for employee actions.
 * No Supabase imports — safe to import in unit tests without env vars.
 */

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
 * Excludes ambiguous characters: 0, O, I, l, 1 to avoid confusion when
 * the admin hands the code off verbally or on a printed slip.
 */
export function generateTempPassword(): string {
  // Charset: uppercase (no O, I), lowercase (no l), digits (no 0, 1), symbols
  const upper = 'ABCDEFGHJKMNPQRSTUVWXYZ'; // 23 chars
  const lower = 'abcdefghjkmnpqrstuvwxyz'; // 23 chars (no l)
  const digits = '23456789'; // 8 chars
  const symbols = '!@#$%^&*';
  const all = upper + lower + digits + symbols;

  // Guarantee at least one from each category
  const pick = (pool: string) => pool[Math.floor(Math.random() * pool.length)];
  const required = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  const extra = Array.from({ length: 6 }, () => pick(all));
  const raw = [...required, ...extra];

  // Shuffle
  for (let i = raw.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [raw[i], raw[j]] = [raw[j], raw[i]];
  }
  return raw.join('');
}
