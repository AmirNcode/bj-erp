import { describe, it, expect } from 'vitest';
import {
  minutesToDecimalDays,
  daysBetween,
  buildBalanceReport,
  buildRequestSummary,
  buildAbsenceByDepartment,
  buildPendingAgeing,
  buildHeadcount,
  tableToCsvRows,
  type EmployeeRow,
  type RequestRow,
} from '@/lib/reports/reports';

const EMPLOYEES: EmployeeRow[] = [
  {
    id: 'e1',
    fullName: 'Ali',
    employeeCode: '1001',
    personnelNo: '1001',
    departmentName: 'Production',
    managerName: 'Sara',
    hireDate: '2026-03-10',
    active: true,
  },
  {
    id: 'e2',
    fullName: 'Reza',
    employeeCode: '1002',
    personnelNo: null,
    departmentName: 'Production',
    managerName: 'Sara',
    hireDate: '2025-01-05',
    active: true,
  },
  {
    id: 'e3',
    fullName: 'Mina',
    employeeCode: '1003',
    personnelNo: '1003',
    departmentName: 'Quality',
    managerName: null,
    hireDate: '2026-06-01',
    active: true,
  },
  {
    id: 'e4',
    fullName: 'Gone',
    employeeCode: '1004',
    personnelNo: '1004',
    departmentName: 'Quality',
    managerName: null,
    hireDate: '2024-01-01',
    active: false,
  },
];

const req = (over: Partial<RequestRow> & { id: string; employeeId: string }): RequestRow => ({
  kind: 'leave',
  status: 'approved',
  startDate: '2026-08-01',
  endDate: '2026-08-02',
  requestedMinutes: 960,
  unpaidMinutes: 0,
  createdAt: '2026-08-01T08:00:00Z',
  leaveTypeName: 'Annual',
  ...over,
});

describe('minutesToDecimalDays', () => {
  it('converts through the configured workday', () => {
    expect(minutesToDecimalDays(480, 8)).toBe(1);
    expect(minutesToDecimalDays(960, 8)).toBe(2);
    expect(minutesToDecimalDays(120, 8)).toBe(0.25);
  });

  it('respects a non-8h day', () => {
    expect(minutesToDecimalDays(360, 6)).toBe(1);
  });

  it('rounds to 2dp so a spreadsheet can total it', () => {
    expect(minutesToDecimalDays(100, 8)).toBe(0.21);
  });

  it('never divides by zero', () => {
    expect(minutesToDecimalDays(480, 0)).toBe(0);
  });
});

describe('daysBetween', () => {
  it('counts whole days', () => {
    expect(daysBetween('2026-08-01', '2026-08-11')).toBe(10);
    expect(daysBetween('2026-08-01', '2026-08-01')).toBe(0);
  });

  it('never returns a negative age', () => {
    expect(daysBetween('2026-08-11', '2026-08-01')).toBe(0);
  });

  it('survives junk input', () => {
    expect(daysBetween('not-a-date', '2026-08-01')).toBe(0);
  });
});

describe('buildBalanceReport', () => {
  const leaveTypes = [
    { id: 't1', name: 'Annual' },
    { id: 't2', name: 'Sick' },
  ];

  it('gives one column per leave type and one row per ACTIVE employee', () => {
    const table = buildBalanceReport({
      employees: EMPLOYEES,
      ledger: [],
      leaveTypes,
      hoursPerDay: 8,
      labels: { name: 'Name', code: 'Code', department: 'Dept', manager: 'Manager' },
    });
    expect(table.columns).toEqual(['Name', 'Code', 'Dept', 'Manager', 'Annual', 'Sick']);
    expect(table.rows).toHaveLength(3); // the inactive employee is excluded
    expect(table.rows.map((r) => r[0])).toEqual(['Ali', 'Reza', 'Mina']);
  });

  it('takes the latest balance by seq, not by order or created_at', () => {
    // Accrual writes several months in one transaction where now() is frozen, so
    // created_at ties — seq is the only correct discriminator.
    const table = buildBalanceReport({
      employees: [EMPLOYEES[0]],
      ledger: [
        { employeeId: 'e1', leaveTypeId: 't1', balanceAfterMinutes: 4800, seq: 9 },
        { employeeId: 'e1', leaveTypeId: 't1', balanceAfterMinutes: 999, seq: 2 },
        { employeeId: 'e1', leaveTypeId: 't1', balanceAfterMinutes: 111, seq: 7 },
      ],
      leaveTypes,
      hoursPerDay: 8,
      labels: { name: 'Name', code: 'Code', department: 'Dept', manager: 'Manager' },
    });
    expect(table.rows[0][4]).toBe(10); // 4800 min / 480 = 10 days
  });

  it('shows zero for a type the employee has no ledger row for', () => {
    const table = buildBalanceReport({
      employees: [EMPLOYEES[0]],
      ledger: [{ employeeId: 'e1', leaveTypeId: 't1', balanceAfterMinutes: 480, seq: 1 }],
      leaveTypes,
      hoursPerDay: 8,
      labels: { name: 'Name', code: 'Code', department: 'Dept', manager: 'Manager' },
    });
    expect(table.rows[0][5]).toBe(0);
  });

  it('falls back to the employee code when there is no personnel number', () => {
    const table = buildBalanceReport({
      employees: [EMPLOYEES[1]],
      ledger: [],
      leaveTypes,
      hoursPerDay: 8,
      labels: { name: 'Name', code: 'Code', department: 'Dept', manager: 'Manager' },
    });
    expect(table.rows[0][1]).toBe('1002');
  });
});

describe('buildRequestSummary', () => {
  const labels = {
    kind: 'Kind',
    status: 'Status',
    count: 'Count',
    days: 'Days',
    unpaidDays: 'Unpaid',
    kindLeave: 'Leave',
    kindErrand: 'Errand',
    statuses: { pending: 'Pending', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled' },
  };

  it('groups by kind and status, summing days and unpaid days', () => {
    const table = buildRequestSummary({
      requests: [
        req({ id: 'a', employeeId: 'e1', requestedMinutes: 480 }),
        req({ id: 'b', employeeId: 'e2', requestedMinutes: 960, unpaidMinutes: 480 }),
        req({ id: 'c', employeeId: 'e1', status: 'rejected', requestedMinutes: 480 }),
      ],
      hoursPerDay: 8,
      labels,
    });
    expect(table.rows).toEqual([
      ['Leave', 'Approved', 2, 3, 1],
      ['Leave', 'Rejected', 1, 1, 0],
    ]);
  });

  it('keeps a stable kind/status order regardless of input order', () => {
    // Two runs of the same report should be diffable.
    const rows = buildRequestSummary({
      requests: [
        req({ id: 'a', employeeId: 'e1', kind: 'errand', status: 'pending' }),
        req({ id: 'b', employeeId: 'e1', status: 'approved' }),
      ],
      hoursPerDay: 8,
      labels,
    }).rows;
    expect(rows.map((r) => r[0])).toEqual(['Leave', 'Errand']);
  });

  it('omits combinations with no data rather than printing zero rows', () => {
    const table = buildRequestSummary({ requests: [], hoursPerDay: 8, labels });
    expect(table.rows).toEqual([]);
  });
});

describe('buildAbsenceByDepartment', () => {
  const labels = { department: 'Dept', people: 'People', requests: 'Requests', days: 'Days' };

  it('counts only APPROVED LEAVE — an errand is work, not absence', () => {
    const table = buildAbsenceByDepartment({
      requests: [
        req({ id: 'a', employeeId: 'e1', requestedMinutes: 480 }),
        req({ id: 'b', employeeId: 'e1', kind: 'errand', requestedMinutes: 480 }),
        req({ id: 'c', employeeId: 'e2', status: 'pending', requestedMinutes: 480 }),
      ],
      employees: EMPLOYEES,
      hoursPerDay: 8,
      labels,
    });
    expect(table.rows).toEqual([['Production', 1, 1, 1]]);
  });

  it('counts distinct people, not requests', () => {
    const table = buildAbsenceByDepartment({
      requests: [
        req({ id: 'a', employeeId: 'e1', requestedMinutes: 480 }),
        req({ id: 'b', employeeId: 'e1', requestedMinutes: 480 }),
        req({ id: 'c', employeeId: 'e2', requestedMinutes: 480 }),
      ],
      employees: EMPLOYEES,
      hoursPerDay: 8,
      labels,
    });
    expect(table.rows[0]).toEqual(['Production', 2, 3, 3]);
  });

  it('sorts the worst-hit department first', () => {
    const table = buildAbsenceByDepartment({
      requests: [
        req({ id: 'a', employeeId: 'e1', requestedMinutes: 480 }),
        req({ id: 'b', employeeId: 'e3', requestedMinutes: 4800 }),
      ],
      employees: EMPLOYEES,
      hoursPerDay: 8,
      labels,
    });
    expect(table.rows.map((r) => r[0])).toEqual(['Quality', 'Production']);
  });
});

describe('buildPendingAgeing', () => {
  const labels = {
    name: 'Name',
    department: 'Dept',
    submitted: 'Submitted',
    waitingDays: 'Waiting',
    days: 'Days',
    waitingOn: 'Waiting on',
    stepLabels: { manager: 'Manager', hr: 'HR' },
  };

  it('lists only pending requests, oldest first', () => {
    const table = buildPendingAgeing({
      requests: [
        req({ id: 'a', employeeId: 'e1', status: 'pending', createdAt: '2026-08-10T08:00:00Z' }),
        req({ id: 'b', employeeId: 'e2', status: 'pending', createdAt: '2026-08-01T08:00:00Z' }),
        req({ id: 'c', employeeId: 'e3', status: 'approved' }),
      ],
      employees: EMPLOYEES,
      today: '2026-08-18',
      hoursPerDay: 8,
      labels,
    });
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0][0]).toBe('Reza'); // 17 days, older
    expect(table.rows[0][3]).toBe(17);
    expect(table.rows[1][3]).toBe(8);
  });

  it('names who the request is waiting on, from the approval chain', () => {
    const table = buildPendingAgeing({
      requests: [
        req({ id: 'a', employeeId: 'e1', status: 'pending', outstanding: ['hr'] }),
        req({ id: 'b', employeeId: 'e2', status: 'pending', outstanding: ['manager', 'hr'] }),
      ],
      employees: EMPLOYEES,
      today: '2026-08-18',
      hoursPerDay: 8,
      labels,
    });
    const waitingOn = table.rows.map((r) => r[5]);
    expect(waitingOn).toContain('HR');
    expect(waitingOn).toContain('Manager + HR');
  });

  it('shows a dash when nothing is outstanding', () => {
    const table = buildPendingAgeing({
      requests: [req({ id: 'a', employeeId: 'e1', status: 'pending' })],
      employees: EMPLOYEES,
      today: '2026-08-18',
      hoursPerDay: 8,
      labels,
    });
    expect(table.rows[0][5]).toBe('—');
  });
});

describe('buildHeadcount', () => {
  const labels = { department: 'Dept', headcount: 'Headcount', joiners: 'Joiners' };

  it('counts active employees per department and joiners inside the range', () => {
    const table = buildHeadcount({
      employees: EMPLOYEES,
      rangeStart: '2026-01-01',
      rangeEnd: '2026-12-31',
      labels,
    });
    expect(table.rows).toEqual([
      ['Production', 2, 1], // Ali joined 2026-03-10; Reza in 2025
      ['Quality', 1, 1], // Mina joined 2026-06-01; the inactive one is excluded
    ]);
  });

  it('ignores an employee with no hire date rather than counting them as a joiner', () => {
    const table = buildHeadcount({
      employees: [{ ...EMPLOYEES[0], hireDate: null }],
      rangeStart: '2026-01-01',
      rangeEnd: '2026-12-31',
      labels,
    });
    expect(table.rows[0]).toEqual(['Production', 1, 0]);
  });
});

describe('tableToCsvRows', () => {
  it('puts the header first and stringifies every cell', () => {
    const rows = tableToCsvRows({ columns: ['A', 'B'], rows: [['x', 2]] });
    expect(rows).toEqual([
      ['A', 'B'],
      ['x', '2'],
    ]);
    // Everything must be a string for buildCsv's escaper.
    expect(rows.every((r) => r.every((c) => typeof c === 'string'))).toBe(true);
  });
});
