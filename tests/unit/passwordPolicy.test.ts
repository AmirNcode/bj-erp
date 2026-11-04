import { describe, it, expect } from 'vitest';
import {
  validatePassword,
  validateNewPassword,
  toLatinPassword,
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
  PASSWORD_SPECIALS,
  passwordRuleProblem,
} from '@/lib/auth/passwordPolicy';
import { generateTempPassword } from '@/lib/actions/employees-helpers';

describe('toLatinPassword', () => {
  it('leaves an ASCII password untouched', () => {
    expect(toLatinPassword('Admin!2026')).toBe('Admin!2026');
    expect(toLatinPassword('a B~ 1_9')).toBe('a B~ 1_9');
  });

  it('converts Persian and Arabic-Indic digits', () => {
    expect(toLatinPassword('pass۱۲۳')).toBe('pass123');
    expect(toLatinPassword('pass١٢٣')).toBe('pass123');
  });

  it('drops Persian letters typed on a Farsi keyboard', () => {
    expect(toLatinPassword('رمز۱۲۳abc!')).toBe('123abc!');
    expect(toLatinPassword('رمزعبور')).toBe('');
  });

  it('drops other non-printable-ASCII input', () => {
    expect(toLatinPassword('a‏b')).toBe('ab'); // RTL mark
    expect(toLatinPassword('emoji🙂ok')).toBe('emojiok');
  });
});

describe('validatePassword', () => {
  it('requires a current password', () => {
    expect(validatePassword('', 'longenough1!', 'longenough1!')).toEqual({ ok: false, reason: 'empty_current' });
  });
  it('rejects a new password shorter than the minimum', () => {
    expect(validatePassword('old', 'short', 'short')).toEqual({ ok: false, reason: 'too_short' });
    expect('short'.length).toBeLessThan(MIN_PASSWORD_LENGTH);
  });
  it('rejects a confirm mismatch', () => {
    expect(validatePassword('old', 'longenough1!', 'longenough2!')).toEqual({ ok: false, reason: 'mismatch' });
  });
  it('rejects input bcrypt would silently truncate', () => {
    const tooLong = 'a'.repeat(MAX_PASSWORD_LENGTH + 1);
    expect(validatePassword('old', tooLong, tooLong)).toEqual({ ok: false, reason: 'too_long' });
  });
  it('accepts a valid change', () => {
    expect(validatePassword('old', 'longenough1!', 'longenough1!')).toEqual({ ok: true });
  });
});

describe('validateNewPassword (first-login form, FR-50)', () => {
  it('needs no current password', () => {
    expect(validateNewPassword('abcdef1!', 'abcdef1!')).toEqual({ ok: true });
  });
  it('applies the same length and confirm rules', () => {
    const short = 'a'.repeat(MIN_PASSWORD_LENGTH - 1);
    const long = 'a'.repeat(MAX_PASSWORD_LENGTH + 1);
    expect(validateNewPassword(short, short)).toEqual({ ok: false, reason: 'too_short' });
    expect(validateNewPassword(long, long)).toEqual({ ok: false, reason: 'too_long' });
    expect(validateNewPassword('abcdef1!', 'abcdef1?')).toEqual({ ok: false, reason: 'mismatch' });
  });
});

describe('passwordRuleProblem (FR-80: a digit and a special character)', () => {
  it('needs a digit', () => {
    expect(passwordRuleProblem('abcdefg!')).toBe('needs_digit');
  });
  it('needs a special character, and a space does not count', () => {
    expect(passwordRuleProblem('abcdefg1')).toBe('needs_symbol');
    expect(passwordRuleProblem('abcdef 1')).toBe('needs_symbol');
  });
  it('accepts every printable ASCII punctuation mark, as the SQL rule does', () => {
    expect(PASSWORD_SPECIALS).toHaveLength(32);
    for (const ch of PASSWORD_SPECIALS) expect(passwordRuleProblem(`abcdef1${ch}`)).toBeNull();
  });
  it('checks length before the character classes', () => {
    expect(passwordRuleProblem('a1!')).toBe('too_short');
    expect(passwordRuleProblem(`${'a'.repeat(MAX_PASSWORD_LENGTH)}1!`)).toBe('too_long');
  });
  it('every generated temporary password passes', () => {
    for (let i = 0; i < 200; i++) expect(passwordRuleProblem(generateTempPassword())).toBeNull();
  });
  it('forms report the rule problem', () => {
    expect(validateNewPassword('abcdefgh1', 'abcdefgh1')).toEqual({ ok: false, reason: 'needs_symbol' });
    expect(validatePassword('old', 'abcdefgh!', 'abcdefgh!')).toEqual({ ok: false, reason: 'needs_digit' });
  });
});
