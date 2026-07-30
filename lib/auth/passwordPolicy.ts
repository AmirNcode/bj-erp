import { toAsciiDigits } from '@/lib/employees/code';

export const MIN_PASSWORD_LENGTH = 8;
// bcrypt ignores bytes after 72. Passwords are printable ASCII in this app, so
// the same number is also the character limit and no two accepted passwords
// can silently collapse to the same hash input.
export const MAX_PASSWORD_LENGTH = 72;

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
  | { ok: false; reason: 'empty_current' | 'too_short' | 'too_long' | 'mismatch' };

/** Client-side gate for the change-password form. The SQL fn re-checks length + current password. */
export function validatePassword(current: string, next: string, confirm: string): PasswordValidation {
  if (!current) return { ok: false, reason: 'empty_current' };
  if (next.length < MIN_PASSWORD_LENGTH) return { ok: false, reason: 'too_short' };
  if (next.length > MAX_PASSWORD_LENGTH) return { ok: false, reason: 'too_long' };
  if (next !== confirm) return { ok: false, reason: 'mismatch' };
  return { ok: true };
}
