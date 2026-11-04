import { toAsciiDigits } from '@/lib/employees/code';

export const MIN_PASSWORD_LENGTH = 8;
// bcrypt ignores bytes after 72. Passwords are printable ASCII in this app, so
// the same number is also the character limit and no two accepted passwords
// can silently collapse to the same hash input.
export const MAX_PASSWORD_LENGTH = 72;
/**
 * FR-80 (owner, 2026-11-04): at least one digit and one of these. Printable ASCII punctuation; a
 * space is allowed but does not count. Mirrors `private.assert_password_ok` in SQL, which decides.
 */
export const PASSWORD_SPECIALS = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';

/**
 * Passwords are latin. Temp passwords are generated from an ASCII alphabet and
 * employee codes are latin, so a Farsi keyboard silently producing Persian
 * characters only ever yields a password that cannot match — and the user sees
 * bullets, so nothing explains the failure. Persian/Arabic-Indic digits are
 * converted (the user meant 123); anything else outside printable ASCII is
 * dropped.
 *
 * Applied on every password field — login *and* change-password. If only the
 * login field filtered, a password set here with Persian characters could
 * never be typed again.
 */
export function toLatinPassword(value: string): string {
  return toAsciiDigits(value).replace(/[^\x20-\x7E]/g, '');
}

export type PasswordValidation =
  | { ok: true }
  | { ok: false; reason: PasswordProblem };

export type PasswordProblem = 'empty_current' | 'too_short' | 'too_long' | 'needs_digit' | 'needs_symbol' | 'mismatch';

/** The FR-80 rule alone (length, digit, special character), or null when the password passes. */
export function passwordRuleProblem(password: string): 'too_short' | 'too_long' | 'needs_digit' | 'needs_symbol' | null {
  if (password.length < MIN_PASSWORD_LENGTH) return 'too_short';
  if (password.length > MAX_PASSWORD_LENGTH) return 'too_long';
  if (!/[0-9]/.test(password)) return 'needs_digit';
  if (![...password].some((ch) => PASSWORD_SPECIALS.includes(ch))) return 'needs_symbol';
  return null;
}

/** Client-side gate for the change-password form. The SQL fn re-checks the rule + current password. */
export function validatePassword(current: string, next: string, confirm: string): PasswordValidation {
  if (!current) return { ok: false, reason: 'empty_current' };
  return validateNewPassword(next, confirm);
}

/** The first-login form asks only for the new password (FR-50). */
export function validateNewPassword(
  next: string,
  confirm: string
): { ok: true } | { ok: false; reason: Exclude<PasswordProblem, 'empty_current'> } {
  const problem = passwordRuleProblem(next);
  if (problem) return { ok: false, reason: problem };
  if (next !== confirm) return { ok: false, reason: 'mismatch' };
  return { ok: true };
}
