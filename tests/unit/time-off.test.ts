import { describe, expect, it } from 'vitest';
import { hasTimeOff, isSecurityOnly } from '@/lib/auth/timeOff';

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
