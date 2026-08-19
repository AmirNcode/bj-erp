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

  it('rejects a day that does not exist, instead of rolling it forward', () => {
    // The bug this replaced: `DateObject.isValid` NORMALISES an out-of-range day
    // and still reports true, so these were accepted and stored as a DIFFERENT
    // date — silently, with nothing shown back to the person importing.
    //
    //   2026-02-30  became 2026-03-02
    //   1405/07/31  became 1405/08/01   (Mehr has 30 days)
    //   1405/12/30  became 1406/01/01   (Esfand has 29 days in 1405 — a whole
    //                                    Persian YEAR crossed)
    //
    // It mattered because `accrue_leave` skips months ending before the hire date
    // and pro-rates the hire month by the days left in it, so a rolled date moves
    // earned leave. The row now reports `badDate` with its line number, like any
    // other bad cell.
    expect(parseHireDate('2026-02-30')).toBeUndefined();
    expect(parseHireDate('2026-04-31')).toBeUndefined();
    expect(parseHireDate('1405/07/31')).toBeUndefined();
    expect(parseHireDate('1405/12/30')).toBeUndefined();
  });

  it('still accepts genuine month-end dates, in both calendars', () => {
    // A naive "reject day > 30" would break all of these. 1403 is a Persian leap
    // year so 30 Esfand exists; Shahrivar always has 31 days.
    expect(parseHireDate('1403/12/30')).toBe('2025-03-20');
    expect(parseHireDate('1405/06/31')).toBe('2026-09-22');
    expect(parseHireDate('2024-02-29')).toBe('2024-02-29');
    expect(parseHireDate('2026-01-31')).toBe('2026-01-31');
  });

  it('accepts hire dates long before the app’s calendar table starts', () => {
    // `jalali_months` covers 1400-1450, but that table bounds which months leave
    // can be ACCRUED for — it is not consulted here. Someone with decades of
    // service must still be enterable. Verified end to end against the database:
    // an employee hired 1355/01/01 was created and accrued correctly.
    expect(parseHireDate('1380/05/15')).toBe('2001-08-06');
    expect(parseHireDate('1355/01/01')).toBe('1976-03-21');
    expect(parseHireDate('1300/01/01')).toBe('1921-03-21');
  });

  it('flags a rolled date as badDate on its row, not silently', () => {
    const header = templateHeader();
    const { rows, errors } = validateImportRows(
      [
        header,
        ['نام', '9990000001', '1405/12/30', 'prod', '', 'employee', '', '0', '0'],
      ],
      { deptCodes: ['prod'], existingPersonnelNos: [] }
    );
    expect(rows).toEqual([]);
    expect(errors).toContainEqual({ line: 2, field: 'hire_date', messageKey: 'badDate' });
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
