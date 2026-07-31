import { describe, it, expect } from 'vitest';
import {
  generateDepartmentCode,
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

describe('generateDepartmentCode', () => {
  it('uses the suggestion when nothing is taken', () => {
    expect(generateDepartmentCode('Finance', [])).toBe('fina');
    expect(generateDepartmentCode('R & D', [])).toBe('rd');
  });

  it('falls back to "dep" when the English name has fewer than 2 latin chars', () => {
    expect(generateDepartmentCode('انبار', [])).toBe('dep');
    expect(generateDepartmentCode('A', [])).toBe('dep');
    expect(generateDepartmentCode('', [])).toBe('dep');
  });

  it('appends an incrementing numeric suffix on collision', () => {
    expect(generateDepartmentCode('Finance', ['fina'])).toBe('fina2');
    expect(generateDepartmentCode('Finance', ['fina', 'fina2'])).toBe('fina3');
    expect(generateDepartmentCode('انبار', ['dep'])).toBe('dep2');
  });

  it('ignores case and surrounding space in the taken set', () => {
    expect(generateDepartmentCode('Finance', [' FINA '])).toBe('fina2');
  });

  it('truncates the base so the suffix always fits in 6 characters', () => {
    const taken = ['fina'];
    for (let n = 2; n <= 120; n++) {
      taken.push(generateDepartmentCode('Finance', taken));
    }
    // fina2…fina9, then fina10…fina99, then fin100…
    expect(taken).toContain('fina9');
    expect(taken).toContain('fina10');
    expect(taken).toContain('fin100');
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
