import { describe, it, expect } from 'vitest';
import { validateImportRows, type ImportContext, type ImportMode } from '@/lib/csv/import-rows';
import {
  buildImportPlan,
  DEFAULT_CHOICES,
  type ExistingDepartment,
  type ExistingEmployee,
  type ImportChoices,
} from '@/lib/csv/import-plan';

const H = ['full_name', 'personnel_no', 'role', 'department_code', 'department_name_fa', 'department_name_en', 'supervisor_personnel_no', 'manager_personnel_no'];

const emp = (over: Partial<ExistingEmployee> & { id: string; fullName: string }): ExistingEmployee => ({
  personnelNo: null,
  active: true,
  isAdmin: false,
  isManager: false,
  managerId: null,
  departmentCode: 'QC',
  pendingRequests: 0,
  ...over,
});

// App today: admin, an old QC manager (50), a worker in the file (2), a person the
// file leaves out (60) who reports to 50, and a renamed twin of file row 3 (70).
const employees: ExistingEmployee[] = [
  emp({ id: 'admin', fullName: 'Admin', isAdmin: true, departmentCode: null }),
  emp({ id: 'm50', fullName: 'Old Boss', personnelNo: '50', isManager: true }),
  emp({ id: 'w2', fullName: 'Worker', personnelNo: '2', managerId: 'm50', pendingRequests: 2 }),
  emp({ id: 'p60', fullName: 'Left Out', personnelNo: '60', managerId: 'm50', pendingRequests: 1 }),
  emp({ id: 'p70', fullName: 'علي رضايي', personnelNo: '70' }),
  emp({ id: 'gone', fullName: 'Inactive', personnelNo: '80', active: false }),
];
const departments: ExistingDepartment[] = [
  { code: 'QC', managerPersonnelNo: '50', memberCount: 5 },
  { code: 'OLD', managerPersonnelNo: null, memberCount: 0 },
  { code: 'HOLD', managerPersonnelNo: null, memberCount: 1 },
];
const ctx: ImportContext = {
  departments: [{ code: 'QC', name_fa: 'کنترل کیفیت', name_en: 'Quality Control', managerPersonnelNo: '50', managerActive: true }],
  existingEmployees: employees
    .filter((e) => e.personnelNo)
    .map((e) => ({ personnelNo: e.personnelNo!, fullName: e.fullName, isManager: e.isManager })),
  hoursPerDay: 8,
};
const csv = [
  H,
  ['Boss', '1', 'manager', 'QC', '', '', '', ''],
  ['Worker', '2', 'employee', 'QC', '', '', '', '1'],
  ['علی رضایی', '3', 'employee', 'QC', '', '', '', '1'],
  ['Back Again', '80', 'employee', 'QC', '', '', '', '1'],
];

const plan = (mode: ImportMode, choices: Partial<ImportChoices> = {}) =>
  buildImportPlan({
    result: validateImportRows(csv, ctx, mode),
    mode,
    employees,
    departments,
    choices: { ...DEFAULT_CHOICES, ...choices },
  });

describe('buildImportPlan — modes', () => {
  it('add: nothing outside the file, existing numbers never reach the plan', () => {
    const p = plan('add');
    expect(p.updates).toEqual([]);
    expect(p.missing).toEqual([]);
    expect(p.deleteDepartments).toEqual([]);
    expect(p.conflicts).toEqual([]);
  });

  it('update: splits creates and updates, reactivates inactive people in the file', () => {
    const p = plan('update');
    expect(p.creates.map((r) => r.personnel_no).sort()).toEqual(['1', '3']);
    expect(p.updates.map((r) => r.personnel_no).sort()).toEqual(['2', '80']);
    expect(p.reactivations.map((r) => r.personnel_no)).toEqual(['80']);
    expect(p.missing).toEqual([]);
    expect(p.departments[0]).toMatchObject({ code: 'QC', manager_personnel_no: '1', managerChange: true });
  });

  it('replace: lists active non-admin people the file leaves out, default deactivate', () => {
    const p = plan('replace');
    expect(p.missing.map((m) => m.id).sort()).toEqual(['m50', 'p60', 'p70']);
    expect(p.deactivate.sort()).toEqual(['m50', 'p60', 'p70']);
    expect(p.conflicts).toEqual([]);
    expect(p.ready).toBe(true);
  });

  it('replace: deletes only empty unused departments', () => {
    const p = plan('replace');
    expect(p.deleteDepartments).toEqual(['OLD']);
    expect(p.keptDepartments).toEqual(['HOLD']);
  });

  it('counts pending requests whose signers change', () => {
    // w2 moves from Old Boss to Boss (2 pending); QC's manager changes too.
    expect(plan('update').pendingSignerChanges).toBeGreaterThanOrEqual(2);
  });

  it('is idempotent: answers for people no longer in conflict are ignored', () => {
    const p = plan('replace', { resolutions: { 'sameName:nobody': 'keepBoth' } });
    expect(p.conflicts).toEqual([]);
  });
});

describe('buildImportPlan — conflicts for kept people', () => {
  it('sameName: a kept person with a file row of the same (folded) name', () => {
    const p = plan('replace', { missingDefault: 'keep', overrides: { m50: 'keep' } });
    const c = p.conflicts.find((x) => x.kind === 'sameName');
    expect(c).toMatchObject({ personId: 'p70', options: ['deactivateOld', 'keepBoth'], choice: null });
    expect(p.ready).toBe(false);
  });

  it('sameName → deactivateOld deactivates them and clears their other conflicts', () => {
    const p = plan('replace', {
      missingDefault: 'keep',
      resolutions: { 'sameName:p70': 'deactivateOld', 'deptManagerReplaced:m50': 'fileReplaces' },
    });
    expect(p.deactivate).toContain('p70');
    expect(p.ready).toBe(true);
  });

  it('managerDeactivated cascades: deactivating a manager asks about their kept reports', () => {
    const p = plan('replace', { missingDefault: 'keep', overrides: { m50: 'deactivate' }, resolutions: { 'sameName:p70': 'keepBoth' } });
    const c = p.conflicts.find((x) => x.kind === 'managerDeactivated');
    expect(c).toMatchObject({ personId: 'p60', params: { manager: 'Old Boss' } });
    expect(p.ready).toBe(false);
  });

  it('managerDeactivated → noManager / pickManager / deactivateToo', () => {
    const base = { missingDefault: 'keep' as const, overrides: { m50: 'deactivate' as const } };
    const keepBoth = { 'sameName:p70': 'keepBoth' as const };
    expect(plan('replace', { ...base, resolutions: { ...keepBoth, 'managerDeactivated:p60': 'noManager' } }).reassign).toEqual([
      { id: 'p60', managerPersonnelNo: null },
    ]);
    const picked = plan('replace', {
      ...base,
      resolutions: { ...keepBoth, 'managerDeactivated:p60': 'pickManager' },
      pickedManagers: { 'managerDeactivated:p60': '1' },
    });
    expect(picked.reassign).toEqual([{ id: 'p60', managerPersonnelNo: '1' }]);
    expect(picked.ready).toBe(true);
    // pickManager without a person is not ready; a non-manager is not accepted.
    expect(plan('replace', { ...base, resolutions: { ...keepBoth, 'managerDeactivated:p60': 'pickManager' } }).ready).toBe(false);
    expect(
      plan('replace', { ...base, resolutions: { ...keepBoth, 'managerDeactivated:p60': 'pickManager' }, pickedManagers: { 'managerDeactivated:p60': '2' } }).ready
    ).toBe(false);
    expect(plan('replace', { ...base, resolutions: { ...keepBoth, 'managerDeactivated:p60': 'deactivateToo' } }).deactivate).toContain('p60');
  });

  it('deptManagerReplaced: a kept department manager the file replaces', () => {
    const p = plan('replace', { missingDefault: 'keep', resolutions: { 'sameName:p70': 'keepBoth' } });
    const c = p.conflicts.find((x) => x.kind === 'deptManagerReplaced');
    expect(c).toMatchObject({ personId: 'm50', params: { code: 'QC', newManager: 'Boss' } });
    const kept = plan('replace', {
      missingDefault: 'keep',
      resolutions: { 'sameName:p70': 'keepBoth', 'deptManagerReplaced:m50': 'keepAsManager' },
    });
    expect(kept.departments[0]).toMatchObject({ code: 'QC', manager_personnel_no: null, managerChange: false });
    expect(kept.ready).toBe(true);
  });

  it('admins are never listed or deactivated', () => {
    const p = plan('replace');
    expect(p.missing.some((m) => m.id === 'admin')).toBe(false);
    expect(p.deactivate).not.toContain('admin');
  });
});
