export const MIN_PASSWORD_LENGTH = 8;

export type PasswordValidation =
  | { ok: true }
  | { ok: false; reason: 'empty_current' | 'too_short' | 'mismatch' };

/** Client-side gate for the change-password form. The SQL fn re-checks length + current password. */
export function validatePassword(current: string, next: string, confirm: string): PasswordValidation {
  if (!current) return { ok: false, reason: 'empty_current' };
  if (next.length < MIN_PASSWORD_LENGTH) return { ok: false, reason: 'too_short' };
  if (next !== confirm) return { ok: false, reason: 'mismatch' };
  return { ok: true };
}
