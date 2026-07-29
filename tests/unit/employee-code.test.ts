import { describe, it, expect } from 'vitest';
import {
  buildEmployeeCode,
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
});

describe('buildEmployeeCode', () => {
  it('joins department code and personnel number with a dash', () => {
    expect(buildEmployeeCode('prod', '1042')).toBe('prod-1042');
  });

  it('mirrors the DB: lowercases the department code', () => {
    expect(buildEmployeeCode('PROD', '7')).toBe('prod-7');
  });
});
