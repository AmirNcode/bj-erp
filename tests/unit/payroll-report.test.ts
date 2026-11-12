import { describe, it, expect } from 'vitest';
import { groupPayroll, payrollCsv, type PayrollItem } from '@/lib/reports/payroll';

const item = (over: Partial<PayrollItem>): PayrollItem => ({
  employeeId: 'a',
  fullName: 'Ali',
  personnelNo: '101',
  department: 'QC',
  source: 'unpaid_type',
  ref: 'L-1',
  onDate: '1405/01/02',
  leaveType: 'Unpaid',
  unpaidMinutes: 480,
  ...over,
});

describe('groupPayroll', () => {
  it('merges items of one person and keeps first-seen order', () => {
    const people = groupPayroll(
      [
        item({ employeeId: 'b', fullName: 'Bita' }),
        item({ employeeId: 'a', unpaidMinutes: 100 }),
        item({ employeeId: 'b', fullName: 'Bita', unpaidMinutes: 20, source: 'conversion', ref: null }),
      ],
      { a: -60, b: 300 }
    );
    expect(people.map((p) => p.employeeId)).toEqual(['b', 'a']);
    expect(people[0].unpaidMinutes).toBe(500);
    expect(people[0].items).toHaveLength(2);
    expect(people[0].balanceMinutes).toBe(300);
    expect(people[1].balanceMinutes).toBe(-60);
  });

  it('gives null balance when none is known', () => {
    expect(groupPayroll([item({})], {})[0].balanceMinutes).toBeNull();
  });
});

describe('payrollCsv', () => {
  it('writes one row per item with decimal days and the source label', () => {
    const people = groupPayroll(
      [item({ unpaidMinutes: 720 }), item({ source: 'conversion', ref: null, unpaidMinutes: 480 })],
      { a: 480 }
    );
    const t = payrollCsv(
      people,
      {
        columns: ['n', 'p', 'd', 's', 'r', 'dt', 't', 'u', 'b'],
        source: { unpaid_type: 'U', unpaid_part: 'P', conversion: 'C' },
      },
      480
    );
    expect(t.columns).toEqual(['n', 'p', 'd', 's', 'r', 'dt', 't', 'u', 'b']);
    expect(t.rows).toHaveLength(2);
    expect(t.rows[0]).toEqual(['Ali', '101', 'QC', 'U', 'L-1', '1405/01/02', 'Unpaid', 1.5, 1]);
    expect(t.rows[1][3]).toBe('C');
    expect(t.rows[1][4]).toBe('');
  });
});
