import { describe, it, expect } from 'vitest';
import type { CalendarEntry } from '@/lib/actions/leave/calendar';
import { buildBalanceUsage, buildTodayPulse, daysAgo, shortStaffedOthers } from '@/lib/home/pulse';

const entry = (over: Partial<CalendarEntry>): CalendarEntry => ({
  id: Math.random().toString(36),
  kind: 'leave',
  employee_id: 'a',
  employee_name: 'A',
  leave_type_name_fa: 'استحقاقی',
  leave_type_name_en: 'Annual',
  leave_type_color: null,
  start_date: '2026-10-05',
  end_date: '2026-10-05',
  day_part: 'full',
  unit: 'day',
  start_time: null,
  end_time: null,
  status: 'approved',
  ...over,
});

const profiles = [
  { id: 'a', department_id: 'd1' },
  { id: 'b', department_id: 'd1' },
  { id: 'c', department_id: 'd1' },
  { id: 'd', department_id: 'd2' },
  { id: 'e', department_id: null },
];

describe('buildTodayPulse', () => {
  const today = '2026-10-05';

  it('counts only approved entries covering today, for people in scope', () => {
    const p = buildTodayPulse({
      today,
      profiles,
      entries: [
        entry({ employee_id: 'a' }),
        entry({ employee_id: 'b', status: 'pending' }),
        entry({ employee_id: 'c', start_date: '2026-10-06', end_date: '2026-10-07' }),
        entry({ employee_id: 'outsider' }),
      ],
    });
    expect(p.total).toBe(5);
    expect(p.present).toBe(4);
    expect(p.onLeave).toBe(1);
    expect(p.absentByDepartment).toEqual({ d1: 1 });
    expect(p.headcountByDepartment).toEqual({ d1: 3, d2: 1, '': 1 });
  });

  it('splits errands into daily and hourly; hourly and half-day stay present', () => {
    const p = buildTodayPulse({
      today,
      profiles,
      entries: [
        entry({ employee_id: 'a', kind: 'errand' }),
        entry({ employee_id: 'b', kind: 'errand', unit: 'hour' }),
        entry({ employee_id: 'c', day_part: 'am' }),
      ],
    });
    expect(p.errandDaily).toBe(1);
    expect(p.errandHourly).toBe(1);
    expect(p.onLeave).toBe(1);
    expect(p.present).toBe(4);
  });

  it('breaks leave down by type, largest first, one count per person', () => {
    const p = buildTodayPulse({
      today,
      profiles,
      entries: [
        entry({ employee_id: 'a', leave_type_name_fa: 'استعلاجی', leave_type_name_en: 'Sick' }),
        entry({ employee_id: 'b' }),
        entry({ employee_id: 'c' }),
        entry({ employee_id: 'c', start_date: '2026-10-01', end_date: '2026-10-09' }),
      ],
    });
    expect(p.onLeaveByType.map((t) => [t.name_en, t.count])).toEqual([
      ['Annual', 2],
      ['Sick', 1],
    ]);
  });
});

describe('shortStaffedOthers', () => {
  const pulse = {
    absentByDepartment: { d1: 2 },
    headcountByDepartment: { d1: 5, d2: 10 },
    absentIds: ['a', 'b'],
  };
  it('reports others absent at or above the threshold', () => {
    expect(shortStaffedOthers({ departmentId: 'd1', employeeId: 'z', pulse })).toBe(2);
  });
  it('does not count the requester themself', () => {
    // 'a' is one of the two absent: one other out of five is still 20%.
    expect(shortStaffedOthers({ departmentId: 'd1', employeeId: 'a', pulse })).toBe(1);
    expect(
      shortStaffedOthers({
        departmentId: 'd1',
        employeeId: 'a',
        pulse: { ...pulse, headcountByDepartment: { d1: 6 } },
      })
    ).toBeNull();
  });
  it('is null without a department or with nobody absent', () => {
    expect(shortStaffedOthers({ departmentId: null, employeeId: 'z', pulse })).toBeNull();
    expect(shortStaffedOthers({ departmentId: 'd2', employeeId: 'z', pulse })).toBeNull();
  });
});

describe('daysAgo', () => {
  it('counts whole days and never goes negative', () => {
    expect(daysAgo('2026-10-01T23:59:00Z', '2026-10-05')).toBe(4);
    expect(daysAgo('2026-10-05', '2026-10-05')).toBe(0);
    expect(daysAgo('2026-10-09', '2026-10-05')).toBe(0);
  });
});

describe('buildBalanceUsage', () => {
  const types = [
    { id: 'annual', name_fa: 'استحقاقی', name_en: 'Annual', affects_balance: true },
    { id: 'unpaid', name_fa: 'بدون حقوق', name_en: 'Unpaid', affects_balance: false },
  ];
  it('entitled = left + used; reversals give time back', () => {
    const [annual] = buildBalanceUsage({
      types,
      balances: { annual: 4800 },
      ledger: [
        { leave_type_id: 'annual', entry_type: 'allocation', delta_minutes: 6000 },
        { leave_type_id: 'annual', entry_type: 'consumption', delta_minutes: -1920 },
        { leave_type_id: 'annual', entry_type: 'reversal', delta_minutes: 480 },
      ],
      unpaidRequests: [],
    });
    expect(annual).toMatchObject({ hasBalance: true, leftMinutes: 4800, usedMinutes: 1440, entitledMinutes: 6240 });
  });
  it('unpaid types report only used, from approved requests', () => {
    const [, unpaid] = buildBalanceUsage({
      types,
      balances: {},
      ledger: [],
      unpaidRequests: [
        { leave_type_id: 'unpaid', requested_minutes: 480 },
        { leave_type_id: 'unpaid', requested_minutes: 240 },
      ],
    });
    expect(unpaid).toMatchObject({ hasBalance: false, usedMinutes: 720 });
  });
});
