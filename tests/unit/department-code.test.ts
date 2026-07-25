import { describe, it, expect } from 'vitest';
import {
  isValidDepartmentCode,
  normalizeDepartmentCode,
  suggestDepartmentCode,
} from '@/lib/departments/code';
import { buildEmployeeCode } from '@/lib/employees/code';

describe('normalizeDepartmentCode', () => {
  it('trims and lowercases', () => {
    expect(normalizeDepartmentCode('  PROD ')).toBe('prod');
  });

  it('converts Persian / Arabic-Indic digits', () => {
    expect(normalizeDepartmentCode('t۱')).toBe('t1');
    expect(normalizeDepartmentCode('t١')).toBe('t1');
  });
});

describe('isValidDepartmentCode', () => {
  it('accepts 2-6 latin letters or digits', () => {
    expect(isValidDepartmentCode('qc')).toBe(true);
    expect(isValidDepartmentCode('prod')).toBe(true);
    expect(isValidDepartmentCode('mant12')).toBe(true);
  });

  it('rejects too short, too long, uppercase, and non-latin', () => {
    expect(isValidDepartmentCode('q')).toBe(false);
    expect(isValidDepartmentCode('toolong')).toBe(false);
    expect(isValidDepartmentCode('PROD')).toBe(false);
    expect(isValidDepartmentCode('تولید')).toBe(false);
    expect(isValidDepartmentCode('pr od')).toBe(false);
    expect(isValidDepartmentCode('pr-od')).toBe(false);
    expect(isValidDepartmentCode('')).toBe(false);
  });
});

describe('suggestDepartmentCode', () => {
  it('takes the first 4 latin characters, lowercased', () => {
    expect(suggestDepartmentCode('Production Line B')).toBe('prod');
    expect(suggestDepartmentCode('Finance')).toBe('fina');
  });

  it('strips spaces and punctuation', () => {
    expect(suggestDepartmentCode('R & D')).toBe('rd');
  });

  it('returns empty when fewer than 2 usable characters remain', () => {
    expect(suggestDepartmentCode('انبار')).toBe('');
    expect(suggestDepartmentCode('A')).toBe('');
  });

  it('always suggests a code the validator accepts', () => {
    for (const name of ['Production Line B', 'Finance', 'R & D', 'Warehouse 2']) {
      expect(isValidDepartmentCode(suggestDepartmentCode(name))).toBe(true);
    }
  });
});

describe('new department code feeds the employee code', () => {
  it('composes the login code the DB will generate', () => {
    const code = normalizeDepartmentCode(' FIN ');
    expect(isValidDepartmentCode(code)).toBe(true);
    expect(buildEmployeeCode(code, '1042')).toBe('fin-1042');
  });
});
