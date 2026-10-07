/**
 * Unit tests for employee action helpers.
 * These test pure logic only — no Supabase calls.
 */
import { describe, it, expect } from 'vitest';
import { allowedProfileFields, generateTempPassword } from '@/lib/actions/employees-helpers';

describe('allowedProfileFields', () => {
  it('admin may send every editable column, job title included', () => {
    expect(allowedProfileFields(['admin'])).toEqual([
      'full_name',
      'department_id',
      'manager_id',
      'hire_date',
      'job_title',
      'active',
      'language_pref',
    ]);
  });

  it('hr may send the FR-51 set: no language, and active goes through setActive', () => {
    expect(allowedProfileFields(['hr', 'employee'])).toEqual([
      'full_name',
      'department_id',
      'manager_id',
      'hire_date',
      'job_title',
    ]);
  });

  it('a manager keeps exactly name and hire date', () => {
    expect(allowedProfileFields(['manager', 'employee'])).toEqual(['full_name', 'hire_date']);
  });

  it('admin wins over any other role it is combined with', () => {
    expect(allowedProfileFields(['manager', 'admin'])).toContain('language_pref');
  });
});

describe('generateTempPassword', () => {
  it('generates a password of ~10 chars', () => {
    const pw = generateTempPassword();
    expect(pw.length).toBeGreaterThanOrEqual(10);
    expect(pw.length).toBeLessThanOrEqual(12);
  });

  it('does not include ambiguous characters (0, O, I, i, l, L, o, 1)', () => {
    // Run 100 times to be confident
    for (let i = 0; i < 100; i++) {
      const pw = generateTempPassword();
      expect(pw).not.toMatch(/[0OILlio1]/);
    }
  });

  it('generates unique passwords', () => {
    const passwords = new Set(Array.from({ length: 20 }, () => generateTempPassword()));
    expect(passwords.size).toBeGreaterThan(15); // at least 75% unique
  });

  it('only uses allowed charset characters', () => {
    // Uppercase: A-H, J-K, M-N, P-Z (excludes I, L, O)
    // Lowercase: a-h, j-k, m-n, p-z (excludes i, l, o)
    // Digits: 2-9 (excludes 0, 1)
    // Symbols: !@#$%^&*
    const allowed = /^[A-HJ-KM-NP-Za-hj-km-np-z2-9!@#$%^&*]+$/;
    for (let i = 0; i < 50; i++) {
      const pw = generateTempPassword();
      expect(pw).toMatch(allowed);
    }
  });
});
