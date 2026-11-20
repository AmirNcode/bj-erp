import { describe, expect, it } from 'vitest';
import { hasTimeOff, isSecurityOnly, isTestAccount } from '@/lib/auth/timeOff';

describe('FR-76: security-only staff', () => {
  it('security without employee is security-only', () => {
    expect(isSecurityOnly(['security'])).toBe(true);
    expect(hasTimeOff(['security'])).toBe(false);
  });
  it('security with employee keeps time off', () => {
    expect(isSecurityOnly(['security', 'employee'])).toBe(false);
    expect(hasTimeOff(['employee', 'security'])).toBe(true);
  });
  it('nobody else is affected, the admin included', () => {
    expect(hasTimeOff(['admin'])).toBe(true);
    expect(hasTimeOff(['employee'])).toBe(true);
    expect(hasTimeOff([])).toBe(true);
  });
});

describe('FR-95: built-in test roles', () => {
  it('any test- role marks a test account, whatever else is held', () => {
    expect(isTestAccount(['test-emp'])).toBe(true);
    expect(isTestAccount(['employee', 'test-emp'])).toBe(true);
    expect(isTestAccount(['test-mgr'])).toBe(true);
  });
  it('other roles are not test accounts', () => {
    expect(isTestAccount(['employee'])).toBe(false);
    expect(isTestAccount(['manager', 'hr'])).toBe(false);
    expect(isTestAccount([])).toBe(false);
  });
});
