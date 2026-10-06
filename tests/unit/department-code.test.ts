import { describe, it, expect } from 'vitest';
import {
  generateDepartmentCode,
  isValidDepartmentCode,
  normalizeDepartmentCode,
  suggestDepartmentCode,
} from '@/lib/departments/code';
import { buildEmployeeCode } from '@/lib/employees/code';

describe('normalizeDepartmentCode', () => {
  it('trims and uppercases', () => {
    expect(normalizeDepartmentCode('  prod ')).toBe('PROD');
  });

  it('converts Persian / Arabic-Indic digits', () => {
    expect(normalizeDepartmentCode('t۱')).toBe('T1');
    expect(normalizeDepartmentCode('t١')).toBe('T1');
  });
});

describe('isValidDepartmentCode', () => {
  it('accepts 2-4 uppercase latin letters or digits', () => {
    expect(isValidDepartmentCode('QC')).toBe(true);
    expect(isValidDepartmentCode('PROD')).toBe(true);
    expect(isValidDepartmentCode('AS1')).toBe(true);
  });

  it('rejects too short, too long, lowercase, and non-latin', () => {
    expect(isValidDepartmentCode('Q')).toBe(false);
    expect(isValidDepartmentCode('MANT1')).toBe(false);
    expect(isValidDepartmentCode('prod')).toBe(false);
    expect(isValidDepartmentCode('تولید')).toBe(false);
    expect(isValidDepartmentCode('PR D')).toBe(false);
    expect(isValidDepartmentCode('PR-D')).toBe(false);
    expect(isValidDepartmentCode('')).toBe(false);
  });
});

describe('suggestDepartmentCode', () => {
  it('takes the first 4 latin characters, uppercased', () => {
    expect(suggestDepartmentCode('Production Line B')).toBe('PROD');
    expect(suggestDepartmentCode('Finance')).toBe('FINA');
  });

  it('strips spaces and punctuation', () => {
    expect(suggestDepartmentCode('R & D')).toBe('RD');
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

describe('generateDepartmentCode', () => {
  it('uses the suggestion when nothing is taken', () => {
    expect(generateDepartmentCode('Finance', [])).toBe('FINA');
    expect(generateDepartmentCode('R & D', [])).toBe('RD');
  });

  it('falls back to "DEP" when the English name has fewer than 2 latin chars', () => {
    expect(generateDepartmentCode('انبار', [])).toBe('DEP');
    expect(generateDepartmentCode('A', [])).toBe('DEP');
    expect(generateDepartmentCode('', [])).toBe('DEP');
  });

  it('appends an incrementing numeric suffix on collision, staying within 4 chars', () => {
    expect(generateDepartmentCode('Finance', ['FINA'])).toBe('FIN2');
    expect(generateDepartmentCode('Finance', ['FINA', 'FIN2'])).toBe('FIN3');
    expect(generateDepartmentCode('انبار', ['DEP'])).toBe('DEP2');
  });

  it('ignores case and surrounding space in the taken set', () => {
    expect(generateDepartmentCode('Finance', [' fina '])).toBe('FIN2');
  });

  it('truncates the base so the suffix always fits in 4 characters', () => {
    const taken = ['FINA'];
    for (let n = 2; n <= 120; n++) {
      taken.push(generateDepartmentCode('Finance', taken));
    }
    // FIN2…FIN9, then FI10…FI99, then F100…
    expect(taken).toContain('FIN9');
    expect(taken).toContain('FI10');
    expect(taken).toContain('F100');
    expect(new Set(taken).size).toBe(taken.length);
  });

  it('always generates a code the validator and the DB constraint accept', () => {
    const taken: string[] = [];
    for (const name of ['Production Line B', 'Finance', 'R & D', 'انبار', 'A', 'Warehouse 2']) {
      for (let i = 0; i < 15; i++) {
        const code = generateDepartmentCode(name, taken);
        expect(isValidDepartmentCode(code)).toBe(true);
        expect(taken).not.toContain(code);
        taken.push(code);
      }
    }
  });
});

describe('department code no longer feeds the employee code', () => {
  it('stays a valid department code while the login code is the bare number', () => {
    const code = normalizeDepartmentCode(' FIN ');
    expect(isValidDepartmentCode(code)).toBe(true);
    expect(buildEmployeeCode('1042')).toBe('1042');
  });
});
