import { describe, it, expect } from 'vitest';
import {
  buildEmployeeCode,
  isValidLoginCode,
  displayPersonnelNo,
  isValidPersonnelNo,
  normalizePersonnelNo,
  toLatinCode,
} from '@/lib/employees/code';

describe('toLatinCode', () => {
  it('leaves a real login code untouched', () => {
    expect(toLatinCode('prod-1042')).toBe('prod-1042');
    expect(toLatinCode('admin')).toBe('admin');
  });

  it('converts Persian and Arabic-Indic digits', () => {
    expect(toLatinCode('prod-۱۰۴۲')).toBe('prod-1042');
    expect(toLatinCode('prod-١٠٤٢')).toBe('prod-1042');
  });

  it('drops Persian letters typed on a Farsi keyboard', () => {
    expect(toLatinCode('مدیر')).toBe('');
    expect(toLatinCode('prodمdash-7')).toBe('proddash-7');
  });

  it('drops spaces — codes never contain one', () => {
    expect(toLatinCode(' prod-1042 ')).toBe('prod-1042');
    expect(toLatinCode('prod 1042')).toBe('prod1042');
  });
});

describe('normalizePersonnelNo', () => {
  it('trims whitespace', () => {
    expect(normalizePersonnelNo('  1042 ')).toBe('1042');
  });

  it('converts Persian digits', () => {
    expect(normalizePersonnelNo('۱۰۴۲')).toBe('1042');
  });

  it('converts Arabic-Indic digits', () => {
    expect(normalizePersonnelNo('١٠٤٢')).toBe('1042');
  });
});

describe('isValidPersonnelNo', () => {
  it('accepts 1-10 digits', () => {
    expect(isValidPersonnelNo('1')).toBe(true);
    expect(isValidPersonnelNo('1042')).toBe(true);
    expect(isValidPersonnelNo('9999999999')).toBe(true);
  });

  it('rejects empty, letters, and >10 digits', () => {
    expect(isValidPersonnelNo('')).toBe(false);
    expect(isValidPersonnelNo('10a2')).toBe(false);
    expect(isValidPersonnelNo('19999999999')).toBe(false);
    expect(isValidPersonnelNo('10 42')).toBe(false);
  });

  it('lets the admin enter any text of 1-64 characters', () => {
    expect(isValidPersonnelNo('SEC-001#', true)).toBe(true);
    expect(isValidPersonnelNo('حراست ۱', true)).toBe(true);
    expect(isValidPersonnelNo('a'.repeat(64), true)).toBe(true);
    expect(isValidPersonnelNo('', true)).toBe(false);
    expect(isValidPersonnelNo(' a', true)).toBe(false);
    expect(isValidPersonnelNo('a'.repeat(65), true)).toBe(false);
  });
});

describe('displayPersonnelNo', () => {
  const fmt = (n: number) => `#${n}`;
  it('formats a digits-only number and leaves any other text as typed', () => {
    expect(displayPersonnelNo('1042', fmt)).toBe('#1042');
    expect(displayPersonnelNo('SEC001', fmt)).toBe('SEC001');
  });
});

describe('buildEmployeeCode', () => {
  // Since 20260730130002 the code IS the personnel number — no department
  // prefix. Old accounts keep prod-1042; only new ones are bare.
  it('is the personnel number alone', () => {
    expect(buildEmployeeCode('1042')).toBe('1042');
    expect(buildEmployeeCode('7')).toBe('7');
  });

  it('mirrors the SQL btrim', () => {
    expect(buildEmployeeCode(' 1042 ')).toBe('1042');
  });
});

describe('isValidLoginCode (mirrors private.valid_login_code)', () => {
  it('takes letters, digits and email-safe symbols', () => {
    expect(isValidLoginCode('1042')).toBe(true);
    expect(isValidLoginCode("Ali.R-1!#$%&'*+/=?^_`{|}~")).toBe(true);
  });
  it('rejects spaces, @, bad dots, non-ASCII and over 64 characters', () => {
    for (const bad of ['', 'a b', 'a@b', '.ab', 'ab.', 'a..b', 'علی', 'a"b', 'a,b', 'a'.repeat(65)]) {
      expect(isValidLoginCode(bad)).toBe(false);
    }
    expect(isValidLoginCode('a'.repeat(64))).toBe(true);
  });
});
