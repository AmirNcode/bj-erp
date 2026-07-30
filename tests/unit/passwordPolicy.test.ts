import { describe, it, expect } from 'vitest';
import {
  validatePassword,
  toLatinPassword,
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
} from '@/lib/auth/passwordPolicy';

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
    expect(validatePassword('', 'longenough1', 'longenough1')).toEqual({ ok: false, reason: 'empty_current' });
  });
  it('rejects a new password shorter than the minimum', () => {
    expect(validatePassword('old', 'short', 'short')).toEqual({ ok: false, reason: 'too_short' });
    expect('short'.length).toBeLessThan(MIN_PASSWORD_LENGTH);
  });
  it('rejects a confirm mismatch', () => {
    expect(validatePassword('old', 'longenough1', 'longenough2')).toEqual({ ok: false, reason: 'mismatch' });
  });
  it('rejects input bcrypt would silently truncate', () => {
    const tooLong = 'a'.repeat(MAX_PASSWORD_LENGTH + 1);
    expect(validatePassword('old', tooLong, tooLong)).toEqual({ ok: false, reason: 'too_long' });
  });
  it('accepts a valid change', () => {
    expect(validatePassword('old', 'longenough1', 'longenough1')).toEqual({ ok: true });
  });
});
