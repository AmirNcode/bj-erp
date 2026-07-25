import { describe, it, expect } from 'vitest';
import {
  templateHeader,
  validateImportRows,
  parseHireDate,
  type ImportContext,
} from '@/lib/csv/import-rows';

const ctx: ImportContext = {
  deptCodes: ['prod', 'qc'],
  existingPersonnelNos: ['500'],
};

const header = templateHeader();

function row(overrides: Partial<Record<string, string>> = {}): string[] {
  const base: Record<string, string> = {
    full_name: 'Ali Test',
    personnel_no: '1042',
    hire_date: '1404/04/22',
    department_code: 'prod',
    manager_personnel_no: '',
    role: 'employee',
    job_title: 'جوشکار',
    annual_days: '26',
    sick_days: '10',
  };
  Object.assign(base, overrides);
  return [
    base.full_name, base.personnel_no, base.hire_date, base.department_code,
    base.manager_personnel_no, base.role, base.job_title, base.annual_days, base.sick_days,
  ];
}

describe('parseHireDate', () => {
  it('converts Jalali to Gregorian ISO', () => {
    expect(parseHireDate('1404/04/22')).toBe('2025-07-13');
  });

  it('passes Gregorian through (both separators)', () => {
    expect(parseHireDate('2025-07-13')).toBe('2025-07-13');
    expect(parseHireDate('2025/07/13')).toBe('2025-07-13');
  });

  it('normalizes Persian digits', () => {
    expect(parseHireDate('۱۴۰۴/۰۴/۲۲')).toBe('2025-07-13');
  });

  it('returns null for empty, undefined for garbage', () => {
    expect(parseHireDate('')).toBeNull();
    expect(parseHireDate('yesterday')).toBeUndefined();
    expect(parseHireDate('1404/13/01')).toBeUndefined();
  });
});

describe('validateImportRows', () => {
  it('accepts a clean file and normalizes values', () => {
    const { rows, errors } = validateImportRows([header, row()], ctx);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      personnel_no: '1042',
      hire_date: '2025-07-13',
      department_code: 'prod',
      role: 'employee',
      annual_days: 26,
      sick_days: 10,
    });
  });

  it('normalizes Persian digits in personnel numbers', () => {
    const { rows, errors } = validateImportRows([header, row({ personnel_no: '۱۰۴۲' })], ctx);
    expect(errors).toEqual([]);
    expect(rows[0].personnel_no).toBe('1042');
  });

  it('flags a missing required column', () => {
    const badHeader = header.filter((h) => !h.includes('personnel_no'));
    const { errors } = validateImportRows([badHeader], ctx);
    expect(errors.some((e) => e.messageKey === 'missingColumn')).toBe(true);
  });

  it('flags duplicates within the file and against the DB', () => {
    const { errors } = validateImportRows(
      [header, row(), row({ full_name: 'Other' }), row({ personnel_no: '500' })],
      ctx
    );
    expect(errors.map((e) => e.messageKey)).toEqual(['dupInFile', 'dupExisting']);
    expect(errors.map((e) => e.line)).toEqual([3, 4]);
  });

  it('rejects unknown departments and roles', () => {
    const { errors } = validateImportRows(
      [header, row({ department_code: 'nope', role: 'boss' })],
      ctx
    );
    expect(errors.map((e) => e.messageKey).sort()).toEqual(['badRole', 'unknownDept']);
  });

  it('accepts a manager defined earlier in the file, rejects a later one', () => {
    const mgr = row({ personnel_no: '2000', role: 'manager' });
    const before = row({ personnel_no: '2001', manager_personnel_no: '2000' });
    const forward = row({ personnel_no: '2002', manager_personnel_no: '2003' });

    const ok = validateImportRows([header, mgr, before], ctx);
    expect(ok.errors).toEqual([]);
    expect(ok.rows[1].manager_personnel_no).toBe('2000');

    const bad = validateImportRows([header, forward, row({ personnel_no: '2003' })], ctx);
    expect(bad.errors.map((e) => e.messageKey)).toEqual(['unknownManager']);
  });

  it('accepts an existing employee as manager', () => {
    const { errors } = validateImportRows(
      [header, row({ manager_personnel_no: '500' })],
      ctx
    );
    expect(errors).toEqual([]);
  });

  it('rejects negative or non-numeric day counts', () => {
    const { errors } = validateImportRows(
      [header, row({ annual_days: '-1', sick_days: 'ten' })],
      ctx
    );
    expect(errors.map((e) => e.messageKey)).toEqual(['badDays', 'badDays']);
  });
});
