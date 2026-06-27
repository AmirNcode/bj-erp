import { describe, it, expect } from 'vitest';
import { validatePassword, MIN_PASSWORD_LENGTH } from '@/lib/auth/passwordPolicy';

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
  it('accepts a valid change', () => {
    expect(validatePassword('old', 'longenough1', 'longenough1')).toEqual({ ok: true });
  });
});
