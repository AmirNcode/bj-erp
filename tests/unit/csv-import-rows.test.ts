import { describe, it, expect } from 'vitest';
import {
  IMPORT_COLUMNS,
  templateHeader,
  validateImportRows,
  parseHireDate,
  type ImportContext,
} from '@/lib/csv/import-rows';

const H = [
  'full_name',
  'personnel_no',
  'role',
  'department_code',
  'department_name_fa',
  'department_name_en',
  'supervisor_personnel_no',
  'manager_personnel_no',
  'pto_days',
  'pto_hours',
];

const ctx = (over: Partial<ImportContext> = {}): ImportContext => ({
  departments: [
    { code: 'QC', name_fa: 'کنترل کیفیت', name_en: 'Quality Control', managerPersonnelNo: null },
  ],
  existingEmployees: [],
  hoursPerDay: 8,
  ...over,
});

/** name, pno, role, code, fa, en, sup, mgr, days, hours */
const row = (...cells: string[]) => cells;

describe('template', () => {
  it('puts the latin key in parentheses after the Farsi label', () => {
    const header = templateHeader();
    expect(header).toHaveLength(IMPORT_COLUMNS.length);
    expect(header[0]).toBe('نام کامل (full_name)');
    expect(header).toContain('مانده مرخصی (ساعت) (pto_hours)');
  });

  it('round-trips its own header', () => {
    const r = validateImportRows([templateHeader()], ctx());
    expect(r.errors).toEqual([]);
  });
});

describe('header matching', () => {
  it('reports missing required columns', () => {
    const r = validateImportRows([['full_name', 'department_code']], ctx());
    expect(r.errors.map((e) => e.field)).toEqual(['personnel_no', 'role']);
  });

  it('needs a department code or a department name column', () => {
    const r = validateImportRows([['full_name', 'personnel_no', 'role']], ctx());
    expect(r.errors).toEqual([{ line: 1, field: 'department_code', messageKey: 'missingColumn' }]);
  });

  it('does not confuse manager_personnel_no with personnel_no', () => {
    const r = validateImportRows(
      [
        ['نام کامل (full_name)', 'شماره پرسنلی مدیر (manager_personnel_no)', 'شماره پرسنلی (personnel_no)', 'نقش (role)', 'کد بخش (department_code)'],
        ['Boss', '', '1', 'manager', 'QC'],
        ['Emp', '1', '2', 'employee', 'QC'],
      ],
      ctx()
    );
    expect(r.errors).toEqual([]);
    expect(r.rows[1]).toMatchObject({ personnel_no: '2', manager_personnel_no: '1' });
  });

  it('ignores unknown columns such as name or notes columns', () => {
    const r = validateImportRows(
      [
        [...H, 'نام مدیر (Manager)', 'توضیحات'],
        row('Boss', '1', 'manager', 'QC', '', '', '', '', '', '', 'x', 'note'),
      ],
      ctx()
    );
    expect(r.errors).toEqual([]);
  });
});

describe('rows', () => {
  it('sorts managers before reports', () => {
    const r = validateImportRows(
      [
        H,
        row('Emp', '3', 'employee', 'QC', '', '', '2', '1', '1', '2'),
        row('Sup', '2', 'manager', 'QC', '', '', '', '1', '0', '0'),
        row('Boss', '1', 'manager', 'QC', '', '', '', '', '', ''),
      ],
      ctx()
    );
    expect(r.errors).toEqual([]);
    expect(r.rows.map((x) => x.personnel_no)).toEqual(['1', '2', '3']);
    expect(r.rows[2]).toMatchObject({
      line: 2,
      supervisor_personnel_no: '2',
      manager_personnel_no: '1',
      balance_minutes: (1 * 8 + 2) * 60,
    });
  });

  it('accepts negative balances, including the Unicode minus', () => {
    const r = validateImportRows(
      [H, row('A', '1', 'employee', 'QC', '', '', '', '', '-1', '-4'), row('B', '2', 'employee', 'QC', '', '', '', '', '0', '−2')],
      ctx()
    );
    expect(r.errors).toEqual([]);
    expect(r.rows.map((x) => x.balance_minutes)).toEqual([-(8 + 4) * 60, -120]);
  });

  it('rejects mixed signs, hours of a full day or more, and non-numbers', () => {
    const r = validateImportRows(
      [
        H,
        row('A', '1', 'employee', 'QC', '', '', '', '', '1', '-2'),
        row('B', '2', 'employee', 'QC', '', '', '', '', '0', '8'),
        row('C', '3', 'employee', 'QC', '', '', '', '', '2.5', '0'),
        row('D', '4', 'employee', 'QC', '', '', '', '', '400', '0'),
      ],
      ctx()
    );
    expect(r.errors.map((e) => e.messageKey)).toEqual(['mixedSign', 'hoursTooLarge', 'badBalance', 'badBalance']);
    expect(r.rows).toEqual([]);
  });

  it('converts Persian digits', () => {
    const r = validateImportRows([H, row('A', '۱۲', 'employee', 'QC', '', '', '', '', '۳', '۱')], ctx());
    expect(r.rows[0]).toMatchObject({ personnel_no: '12', balance_minutes: (3 * 8 + 1) * 60 });
  });

  it('rejects duplicates in the file and against the database', () => {
    const r = validateImportRows(
      [H, row('A', '1', 'employee', 'QC', '', '', '', '', '', ''), row('B', '1', 'employee', 'QC', '', '', '', '', '', ''), row('C', '9', 'employee', 'QC', '', '', '', '', '', '')],
      ctx({ existingEmployees: [{ personnelNo: '9', fullName: 'Old', isManager: false }] })
    );
    expect(r.errors.map((e) => [e.line, e.messageKey])).toEqual([
      [3, 'dupInFile'],
      [4, 'dupExisting'],
    ]);
  });

  it('rejects a bad role', () => {
    const r = validateImportRows([H, row('A', '1', 'boss', 'QC', '', '', '', '', '', '')], ctx());
    expect(r.errors[0].messageKey).toBe('badRole');
  });
});

describe('references', () => {
  it('rejects a cycle', () => {
    const r = validateImportRows(
      [H, row('A', '1', 'manager', 'QC', '', '', '', '2', '', ''), row('B', '2', 'manager', 'QC', '', '', '', '1', '', '')],
      ctx()
    );
    expect(r.errors.filter((e) => e.messageKey === 'cycle').map((e) => e.line)).toEqual([2, 3]);
    expect(r.rows).toEqual([]);
  });

  it('rejects a reference to someone who is not a manager', () => {
    const r = validateImportRows(
      [H, row('A', '1', 'employee', 'QC', '', '', '', '', '', ''), row('B', '2', 'employee', 'QC', '', '', '1', '', '', '')],
      ctx()
    );
    expect(r.errors).toEqual([{ line: 3, field: 'supervisor_personnel_no', messageKey: 'refNotManager' }]);
  });

  it('rejects unknown and self references', () => {
    const r = validateImportRows(
      [H, row('A', '1', 'employee', 'QC', '', '', '7', '1', '', '')],
      ctx()
    );
    expect(r.errors.map((e) => e.messageKey)).toEqual(['selfReference', 'unknownSupervisor']);
  });

  it('resolves references to existing managers', () => {
    const r = validateImportRows(
      [H, row('A', '1', 'employee', 'QC', '', '', '', '50', '', '')],
      ctx({ existingEmployees: [{ personnelNo: '50', fullName: 'Old Boss', isManager: true }] })
    );
    expect(r.errors).toEqual([]);
  });

  it('warns when a supervisor reports to a different manager than their team', () => {
    const r = validateImportRows(
      [
        H,
        row('Boss1', '1', 'manager', 'QC', '', '', '', '', '', ''),
        row('Boss2', '2', 'manager', 'QC', '', '', '', '', '', ''),
        row('Sup', '3', 'manager', 'QC', '', '', '', '1', '', ''),
        row('Emp', '4', 'employee', 'QC', '', '', '3', '2', '', ''),
      ],
      ctx()
    );
    expect(r.warnings.find((w) => w.messageKey === 'supervisorManagerMismatch')).toMatchObject({
      line: 5,
      params: { supervisor: 'Sup', manager: 'Boss2' },
    });
  });
});

describe('departments', () => {
  it('uppercases and matches an existing code', () => {
    const r = validateImportRows([H, row('A', '1', 'employee', 'qc', '', '', '', '', '', '')], ctx());
    expect(r.rows[0].department_code).toBe('QC');
    expect(r.departments).toEqual([
      expect.objectContaining({ code: 'QC', create: false, name_en: 'Quality Control' }),
    ]);
  });

  it('rejects a malformed code', () => {
    const r = validateImportRows([H, row('A', '1', 'employee', 'TOOLONG', 'x', 'y', '', '', '', '')], ctx());
    expect(r.errors[0].messageKey).toBe('badDeptCode');
  });

  it('creates a new department from a new code with both names', () => {
    const r = validateImportRows(
      [H, row('A', '1', 'employee', 'ADM', 'اداری', 'Administration', '', '', '', ''), row('B', '2', 'employee', 'ADM', '', '', '', '', '', '')],
      ctx()
    );
    expect(r.errors).toEqual([]);
    expect(r.departments).toEqual([
      expect.objectContaining({ code: 'ADM', name_fa: 'اداری', name_en: 'Administration', create: true, generated: false }),
    ]);
  });

  it('lets a row use a new department defined on a LATER row (any order)', () => {
    const r = validateImportRows(
      [
        H,
        row('A', '1', 'employee', 'TST', '', '', '', '', '', ''),
        row('B', '2', 'employee', '', '', 'Test Dept', '', '', '', ''),
        row('C', '3', 'employee', 'TST', 'آزمون', 'Test Dept', '', '', '', ''),
      ],
      ctx()
    );
    expect(r.errors).toEqual([]);
    expect(r.rows.map((x) => x.department_code)).toEqual(['TST', 'TST', 'TST']);
    expect(r.departments).toEqual([expect.objectContaining({ code: 'TST', create: true, generated: false })]);
  });

  it('requires both names for an unknown code', () => {
    const r = validateImportRows([H, row('A', '1', 'employee', 'ADM', 'اداری', '', '', '', '', '')], ctx());
    expect(r.errors[0].messageKey).toBe('deptNamesRequired');
  });

  it('rejects one new code given two different names', () => {
    const r = validateImportRows(
      [H, row('A', '1', 'employee', 'MAR', 'تعمیرات', 'Maintenance', '', '', '', ''), row('B', '2', 'employee', 'MAR', 'بازاریاب', 'Marketing', '', '', '', '')],
      ctx()
    );
    expect(r.errors).toEqual([{ line: 3, field: 'department_code', messageKey: 'deptCodeConflict' }]);
  });

  it('matches a blank code by name, else generates one that avoids later explicit codes', () => {
    const r = validateImportRows(
      [
        H,
        row('A', '1', 'employee', '', 'کنترل کیفیت', '', '', '', '', ''),
        row('B', '2', 'employee', '', 'مالی', 'Finance', '', '', '', ''),
        row('C', '3', 'employee', '', '', 'Finance', '', '', '', ''),
        row('D', '4', 'employee', 'FINA', 'فینا', 'Fina Co', '', '', '', ''),
      ],
      ctx()
    );
    expect(r.errors).toEqual([]);
    expect(r.rows.map((x) => x.department_code)).toEqual(['QC', 'FIN2', 'FIN2', 'FINA']);
    expect(r.departments.find((d) => d.code === 'FIN2')).toMatchObject({ create: true, generated: true });
  });

  it('warns once when the file names an existing code differently', () => {
    const r = validateImportRows(
      [H, row('A', '1', 'employee', 'QC', 'بازرسی', '', '', '', '', ''), row('B', '2', 'employee', 'QC', 'بازرسی', '', '', '', '', '')],
      ctx()
    );
    expect(r.warnings.filter((w) => w.messageKey === 'deptNamesDiffer')).toHaveLength(1);
  });

  it('derives the department manager from members who are not themselves managers of others', () => {
    const r = validateImportRows(
      [
        H,
        row('CEO', '1', 'manager', 'EXE', 'ارشد', 'Exec', '', '', '', ''),
        row('Head', '2', 'manager', 'PLN', 'برنامه', 'Planning', '', '1', '', ''),
        row('P1', '3', 'employee', 'PLN', '', '', '', '2', '', ''),
        row('P2', '4', 'employee', 'PLN', '', '', '', '2', '', ''),
        row('Solo', '5', 'manager', 'EPE', 'اجرا', 'Exec Proj', '', '1', '', ''),
      ],
      ctx()
    );
    expect(r.errors).toEqual([]);
    const by = Object.fromEntries(r.departments.map((d) => [d.code, d]));
    // PLN: the head (2) reports to the CEO but is excluded; members report to 2.
    expect(by.PLN).toMatchObject({ manager_personnel_no: '2', managerName: 'Head' });
    // EPE: only its head, so the fallback counts everyone → the CEO.
    expect(by.EPE).toMatchObject({ manager_personnel_no: '1' });
    // EXE: nobody has a manager.
    expect(by.EXE).toMatchObject({ manager_personnel_no: null, managerName: null });
    expect(r.warnings.filter((w) => w.messageKey === 'bothSign')).toEqual([]);
  });

  it('reports a department manager tie', () => {
    const r = validateImportRows(
      [
        H,
        row('M1', '1', 'manager', 'QC', '', '', '', '', '', ''),
        row('M2', '2', 'manager', 'AS', 'مونتاژ', 'Assembly', '', '', '', ''),
        row('A', '3', 'employee', 'QC', '', '', '', '1', '', ''),
        row('B', '4', 'employee', 'QC', '', '', '', '2', '', ''),
      ],
      ctx()
    );
    expect(r.errors).toContainEqual({ line: 2, field: 'manager_personnel_no', messageKey: 'deptManagerTie' });
  });

  it('keeps an existing department manager and warns', () => {
    const r = validateImportRows(
      [H, row('M', '1', 'manager', 'AS', 'مونتاژ', 'Assembly', '', '', '', ''), row('A', '2', 'employee', 'QC', '', '', '', '1', '', '')],
      ctx({
        departments: [{ code: 'QC', name_fa: 'کنترل کیفیت', name_en: 'Quality Control', managerPersonnelNo: '50' }],
        existingEmployees: [{ personnelNo: '50', fullName: 'Old Boss', isManager: true }],
      })
    );
    const qc = r.departments.find((d) => d.code === 'QC');
    expect(qc).toMatchObject({ manager_personnel_no: null, managerName: 'Old Boss', keptExistingManager: true });
    expect(r.warnings.map((w) => w.messageKey)).toContain('deptManagerKept');
    // Old Boss will sign on top of M.
    expect(r.warnings).toContainEqual({ line: 3, messageKey: 'bothSign', params: { departmentManager: 'Old Boss' } });
  });

  it('warns bothSign for a direct report whose manager is not the department manager', () => {
    const r = validateImportRows(
      [
        H,
        row('CEO', '1', 'manager', 'EX', 'ارشد', 'Exec', '', '', '', ''),
        row('Head', '2', 'manager', 'QC', '', '', '', '1', '', ''),
        row('A', '3', 'employee', 'QC', '', '', '', '2', '', ''),
        row('B', '4', 'employee', 'QC', '', '', '', '2', '', ''),
        row('Lawyer', '5', 'employee', 'QC', '', '', '', '1', '', ''),
      ],
      ctx()
    );
    expect(r.warnings).toEqual([{ line: 6, messageKey: 'bothSign', params: { departmentManager: 'Head' } }]);
  });
});

describe('parseHireDate', () => {
  it('reads Jalali and Gregorian and rejects nonsense', () => {
    expect(parseHireDate('1404/04/22')).toBe('2025-07-13');
    expect(parseHireDate('2025-07-13')).toBe('2025-07-13');
    expect(parseHireDate('')).toBeNull();
    expect(parseHireDate('soon')).toBeUndefined();
  });
});

describe('modes (FR-49)', () => {
  const existing = ctx({
    departments: [
      { code: 'QC', name_fa: 'کیوسی', name_en: 'QC', managerPersonnelNo: '50', managerActive: true },
    ],
    existingEmployees: [
      { personnelNo: '50', fullName: 'Old Boss', isManager: true },
      { personnelNo: '2', fullName: 'Worker', isManager: false },
    ],
  });
  const file = [
    H,
    row('Boss', '1', 'manager', 'QC', 'کنترل کیفیت', 'Quality Control', '', '', '', ''),
    row('Worker', '2', 'employee', 'QC', '', '', '', '1', '', ''),
    row('Other', '3', 'employee', 'QC', '', '', '', '1', '', ''),
  ];

  it('add: an existing personnel number is an error', () => {
    const r = validateImportRows(file, existing, 'add');
    expect(r.errors).toEqual([{ line: 3, field: 'personnel_no', messageKey: 'dupExisting' }]);
  });

  it('update: an existing personnel number is marked existing, not an error', () => {
    const r = validateImportRows(file, existing, 'update');
    expect(r.errors).toEqual([]);
    expect(r.rows.find((x) => x.personnel_no === '2')?.existing).toBe(true);
    expect(r.rows.find((x) => x.personnel_no === '3')?.existing).toBe(false);
  });

  it('update: the file overwrites department names and manager without warnings', () => {
    const r = validateImportRows(file, existing, 'update');
    expect(r.departments[0]).toMatchObject({
      code: 'QC',
      create: false,
      rename: true,
      name_fa: 'کنترل کیفیت',
      name_en: 'Quality Control',
      manager_personnel_no: '1',
      managerChange: true,
      keptExistingManager: false,
    });
    expect(r.warnings.map((w) => w.messageKey)).not.toContain('deptManagerKept');
    expect(r.warnings.map((w) => w.messageKey)).not.toContain('deptNamesDiffer');
  });

  it('add: a deactivated department manager counts as none, so the file manager is assigned', () => {
    const inactive = ctx({
      departments: [
        { code: 'QC', name_fa: 'کنترل کیفیت', name_en: 'Quality Control', managerPersonnelNo: '50', managerActive: false },
      ],
      existingEmployees: [{ personnelNo: '50', fullName: 'Maryam', isManager: true }],
    });
    const r = validateImportRows(
      [H, row('Boss', '1', 'manager', 'QC', '', '', '', '', '', ''), row('A', '2', 'employee', 'QC', '', '', '', '1', '', '')],
      inactive,
      'add'
    );
    expect(r.departments[0]).toMatchObject({ manager_personnel_no: '1', keptExistingManager: false, managerName: 'Boss' });
    expect(r.warnings).toEqual([]);
  });
});
