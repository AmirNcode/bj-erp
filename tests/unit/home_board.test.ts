import { describe, it, expect } from 'vitest';
import { buildHomeBoard, recentOnHome } from '@/lib/home/board';
import type { LeaveRequestWithType } from '@/lib/actions/leave/requests';

// 2026-10-23 is a Friday (weekend), 2026-10-27 a holiday.
const settings = {
  weekendDays: [5], biweeklyWeekendDays: [], biweeklyAnchor: null,
  holidays: ['2026-10-27'], workStart: '07:00', workEnd: '15:00',
} as never;
const base = { requests: [], team: [], pendingCount: 3, today: '2026-10-21', workSettings: settings };

describe('buildHomeBoard', () => {
  it('employee: no approvals card', () => {
    expect(buildHomeBoard({ ...base, roles: ['employee'] }).showApprovals).toBe(false);
  });
  it('manager: approvals card with count', () => {
    const b = buildHomeBoard({ ...base, roles: ['manager'] });
    expect(b.showApprovals).toBe(true);
    expect(b.pendingCount).toBe(3);
  });
  it('hr: approvals card (signs a chain step)', () => {
    expect(buildHomeBoard({ ...base, roles: ['hr'] }).showApprovals).toBe(true);
  });
  it('admin: approvals card', () => {
    expect(buildHomeBoard({ ...base, roles: ['admin'] }).showApprovals).toBe(true);
  });
  it('recent: no cap, removed rejected request left out', () => {
    const requests = Array.from({ length: 8 }, (_, i) => req({ id: String(i), status: 'rejected' }));
    expect(buildHomeBoard({ ...base, roles: ['employee'], requests, dismissedIds: ['3'] }).recent.map((r) => r.id))
      .toEqual(['0', '1', '2', '4', '5', '6', '7']);
  });
  it('attaches upcoming time off to each team member for every covered leave day', () => {
    const board = buildHomeBoard({
      ...base,
      roles: ['employee'],
      team: [
        {
          id: 'leave-1',
          kind: 'leave',
          employee_id: 'teammate-1',
          employee_name: 'Teammate One',
          leave_type_name_fa: 'مرخصی استحقاقی',
          leave_type_name_en: 'Annual Leave',
          leave_type_color: '#2563eb',
          start_date: '2026-07-10',
          end_date: '2026-07-13',
          day_part: 'full',
          unit: 'day',
          start_time: null,
          end_time: null,
          status: 'approved',
        },
      ],
      directory: [
        {
          id: 'teammate-1',
          fullName: 'Teammate One',
          employeeCode: 't-1',
          relation: 'teammate',
          roles: ['employee'],
          departmentNameFa: 'تولید',
          departmentNameEn: 'Production',
          managerName: 'Manager One',
        },
      ],
    });

    expect(board.directory[0].upcomingTimeOff).toEqual([
      {
        id: 'leave-1',
        start_date: '2026-07-10',
        end_date: '2026-07-13',
        leave_type_name_fa: 'مرخصی استحقاقی',
        leave_type_name_en: 'Annual Leave',
        leave_type_color: '#2563eb',
        status: 'approved',
      },
    ]);
  });
});


describe('live Home approval capability', () => {
  it('shows the queue to a named employee approver with no manager role', () => {
    expect(buildHomeBoard({ ...base, roles: ['employee'], canApprove: true, pendingCount: 2 }).showApprovals).toBe(true);
  });
  it('honors a live authority loss even while the role hint remains', () => {
    expect(buildHomeBoard({ ...base, roles: ['manager'], canApprove: false, pendingCount: 0 }).showApprovals).toBe(false);
  });
});

function req(over: Partial<LeaveRequestWithType>): LeaveRequestWithType {
  return {
    id: 'r', kind: 'leave', status: 'approved', unit: 'day', day_part: 'full',
    start_date: '2026-10-21', end_date: '2026-10-22', start_time: null, end_time: null, ...over,
  } as LeaveRequestWithType;
}
const shown = (r: LeaveRequestWithType, today: string) => recentOnHome([r], today, settings, []).length === 1;

describe('recentOnHome (FR-72)', () => {
  it('multi-day: shown until the return day, gone on it (weekend skipped)', () => {
    const r = req({ end_date: '2026-10-22' }); // Thu → back Sat 2026-10-24
    expect(shown(r, '2026-10-21')).toBe(true);
    expect(shown(r, '2026-10-23')).toBe(true);
    expect(shown(r, '2026-10-24')).toBe(false);
  });
  it('holiday after the trip pushes the return day', () => {
    const r = req({ end_date: '2026-10-26' }); // Mon, Tue holiday → back Wed 2026-10-28
    expect(shown(r, '2026-10-27')).toBe(true);
    expect(shown(r, '2026-10-28')).toBe(false);
  });
  it('hourly: stays through the day itself, gone the next day', () => {
    const r = req({ unit: 'hour', start_date: '2026-10-21', end_date: '2026-10-21', start_time: '08:00', end_time: '10:00' });
    expect(shown(r, '2026-10-21')).toBe(true);
    expect(shown(r, '2026-10-22')).toBe(false);
  });
  it('pending and rejected follow the same rule', () => {
    expect(shown(req({ status: 'pending' }), '2026-10-22')).toBe(true);
    expect(shown(req({ status: 'rejected' }), '2026-10-22')).toBe(true);
    expect(shown(req({ status: 'rejected' }), '2026-10-24')).toBe(false);
  });
  it('cancelled leaves at once', () => {
    expect(shown(req({ status: 'cancelled' }), '2026-10-21')).toBe(false);
  });
  it('removed request leaves at once', () => {
    expect(recentOnHome([req({ id: 'x', status: 'rejected' })], '2026-10-21', settings, ['x'])).toEqual([]);
  });
  it('no return day: stays through the end date', () => {
    const allOff = { weekendDays: [1, 2, 3, 4, 5, 6, 7], holidays: [], workStart: '07:00', workEnd: '15:00' };
    const r = req({ end_date: '2026-10-22' });
    expect(recentOnHome([r], '2026-10-22', allOff, [])).toHaveLength(1);
    expect(recentOnHome([r], '2026-10-23', allOff, [])).toHaveLength(0);
  });
});
