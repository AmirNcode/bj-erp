import { describe, it, expect } from 'vitest';
import {
  buildEmployeeCode,
  isValidPersonnelNo,
  normalizePersonnelNo,
} from '@/lib/employees/code';

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
