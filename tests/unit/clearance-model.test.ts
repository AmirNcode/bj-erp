import { describe, expect, it } from 'vitest';
import {
  canSignFinance,
  canSignRow,
  draftRowsFromUnits,
  isSeparationReason,
  rowsPayload,
  type DraftRow,
  type SignoffRow,
  type UnitRow,
} from '@/lib/clearance/model';

const unit = (over: Partial<UnitRow>): UnitRow => ({
  id: 'u',
  kind: 'person',
  nameFa: 'ن',
  nameEn: 'n',
  departmentId: null,
  signerId: null,
  sortOrder: 1,
  active: true,
  ...over,
});

const row = (over: Partial<SignoffRow>): SignoffRow => ({
  id: 'r',
  isHr: false,
  nameFa: 'ن',
  nameEn: 'n',
  departmentId: null,
  signerId: 'it',
  signerName: 'IT',
  sortOrder: 1,
  signedBy: null,
  signedByName: null,
  signedAt: null,
  note: null,
  ...over,
});

describe('isSeparationReason', () => {
  it('accepts the five paper reasons only', () => {
    for (const r of ['resignation', 'dismissal', 'contract_end', 'abandonment', 'redundancy']) {
      expect(isSeparationReason(r)).toBe(true);
    }
    expect(isSeparationReason('holiday')).toBe(false);
    expect(isSeparationReason(null)).toBe(false);
  });
});

describe('draftRowsFromUnits', () => {
  const managers = new Map<string, string | null>([
    ['d1', 'boss1'],
    ['d2', null],
    ['own', 'ownBoss'],
    ['leaverDept', 'leaver'],
  ]);

  it('puts the HR row first and skips inactive units, keeping order', () => {
    const rows = draftRowsFromUnits(
      [
        unit({ id: 'b', sortOrder: 2, nameEn: 'B' }),
        unit({ id: 'hr', kind: 'hr', sortOrder: 0, nameEn: 'HR' }),
        unit({ id: 'x', sortOrder: 1, nameEn: 'off', active: false }),
        unit({ id: 'a', sortOrder: 1, nameEn: 'A' }),
      ],
      { leaverId: 'leaver', leaverDepartmentId: null, departmentManagers: managers }
    );
    expect(rows.map((r) => r.nameEn)).toEqual(['HR', 'A', 'B']);
    expect(rows[0].isHr).toBe(true);
    expect(rows[0].signerId).toBeNull();
  });

  it('adds a default HR row when the company has none', () => {
    const rows = draftRowsFromUnits([], { leaverId: 'l', leaverDepartmentId: null, departmentManagers: managers });
    expect(rows).toHaveLength(1);
    expect(rows[0].isHr).toBe(true);
  });

  it('resolves department rows to the department manager, or unassigned', () => {
    const rows = draftRowsFromUnits(
      [
        unit({ id: 'd1', kind: 'department', departmentId: 'd1' }),
        unit({ id: 'd2', kind: 'department', departmentId: 'd2', sortOrder: 2 }),
      ],
      { leaverId: 'leaver', leaverDepartmentId: null, departmentManagers: managers }
    );
    expect(rows.slice(1).map((r) => [r.departmentId, r.signerId])).toEqual([
      ['d1', 'boss1'],
      ['d2', null],
    ]);
  });

  it('resolves the own-department row to the leaver’s department manager', () => {
    const rows = draftRowsFromUnits([unit({ kind: 'own_department' })], {
      leaverId: 'leaver',
      leaverDepartmentId: 'own',
      departmentManagers: managers,
    });
    expect([rows[1].departmentId, rows[1].signerId]).toEqual(['own', 'ownBoss']);
  });

  it('never makes the leaver a signer', () => {
    const rows = draftRowsFromUnits(
      [unit({ kind: 'own_department' }), unit({ id: 'p', signerId: 'leaver', sortOrder: 2 })],
      { leaverId: 'leaver', leaverDepartmentId: 'leaverDept', departmentManagers: managers }
    );
    expect(rows.slice(1).map((r) => r.signerId)).toEqual([null, null]);
  });

  it('copies a person row signer', () => {
    const rows = draftRowsFromUnits([unit({ signerId: 'it' })], {
      leaverId: 'leaver',
      leaverDepartmentId: null,
      departmentManagers: managers,
    });
    expect(rows[1].signerId).toBe('it');
  });
});

describe('rowsPayload', () => {
  it('drops the HR row and empty optionals, keeps ids', () => {
    const rows: DraftRow[] = [
      { key: 'h', id: 'hrRow', isHr: true, nameFa: 'م', nameEn: 'HR', departmentId: null, signerId: null, signed: false },
      { key: 'a', id: 'x', isHr: false, nameFa: ' الف ', nameEn: ' A ', departmentId: 'd', signerId: 's', signed: true },
      { key: 'b', isHr: false, nameFa: 'ب', nameEn: 'B', departmentId: null, signerId: null, signed: false },
    ];
    expect(rowsPayload(rows)).toEqual([
      { id: 'x', name_fa: 'الف', name_en: 'A', department_id: 'd', signer_id: 's' },
      { name_fa: 'ب', name_en: 'B' },
    ]);
  });
});

describe('canSignRow', () => {
  const me = { id: 'it', roles: ['employee'] };
  it('lets the named signer sign an open row', () => {
    expect(canSignRow(row({}), me, 'leaver', 'in_progress')).toBe(true);
  });
  it('refuses someone else, a signed row, a closed form, an unassigned row', () => {
    expect(canSignRow(row({ signerId: 'other' }), me, 'leaver', 'in_progress')).toBe(false);
    expect(canSignRow(row({ signedAt: '2026-10-07T10:00:00Z' }), me, 'leaver', 'in_progress')).toBe(false);
    expect(canSignRow(row({}), me, 'leaver', 'awaiting_finance')).toBe(false);
    expect(canSignRow(row({ signerId: null }), me, 'leaver', 'in_progress')).toBe(false);
  });
  it('lets hr or admin sign the HR row', () => {
    const hrRow = row({ isHr: true, signerId: null });
    expect(canSignRow(hrRow, { id: 'h', roles: ['hr'] }, 'leaver', 'in_progress')).toBe(true);
    expect(canSignRow(hrRow, { id: 'a', roles: ['admin'] }, 'leaver', 'in_progress')).toBe(true);
    expect(canSignRow(hrRow, me, 'leaver', 'in_progress')).toBe(false);
  });
  it('never lets the leaver sign their own form', () => {
    const hrRow = row({ isHr: true, signerId: null });
    expect(canSignRow(hrRow, { id: 'leaver', roles: ['hr'] }, 'leaver', 'in_progress')).toBe(false);
  });
});

describe('canSignFinance', () => {
  it('needs the finance role, the awaiting status, and not the leaver', () => {
    expect(canSignFinance({ id: 'f', roles: ['finance'] }, 'leaver', 'awaiting_finance')).toBe(true);
    expect(canSignFinance({ id: 'f', roles: ['finance'] }, 'leaver', 'in_progress')).toBe(false);
    expect(canSignFinance({ id: 'h', roles: ['hr'] }, 'leaver', 'awaiting_finance')).toBe(false);
    expect(canSignFinance({ id: 'leaver', roles: ['finance'] }, 'leaver', 'awaiting_finance')).toBe(false);
  });
});
