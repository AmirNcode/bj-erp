import { describe, it, expect } from 'vitest';
import { buildHomeBoard } from '@/lib/home/board';

const base = { requests: [], balances: [], team: [], pendingCount: 3 };

describe('buildHomeBoard', () => {
  it('employee: no approvals card', () => {
    expect(buildHomeBoard({ ...base, roles: ['employee'] }).showApprovals).toBe(false);
  });
  it('manager: approvals card with count', () => {
    const b = buildHomeBoard({ ...base, roles: ['manager'] });
    expect(b.showApprovals).toBe(true);
    expect(b.pendingCount).toBe(3);
  });
  it('admin: approvals card', () => {
    expect(buildHomeBoard({ ...base, roles: ['admin'] }).showApprovals).toBe(true);
  });
  it('recent caps at 5', () => {
    const requests = Array.from({ length: 8 }, (_, i) => ({ id: String(i) })) as never[];
    expect(buildHomeBoard({ ...base, roles: ['employee'], requests }).recent).toHaveLength(5);
  });
  it('attaches upcoming time off to each team member for every covered leave day', () => {
    const board = buildHomeBoard({
      ...base,
      roles: ['employee'],
      team: [
        {
          id: 'leave-1',
          employee_id: 'teammate-1',
          employee_name: 'Teammate One',
          leave_type_name_fa: 'مرخصی استحقاقی',
          leave_type_name_en: 'Annual Leave',
          leave_type_color: '#2563eb',
          start_date: '2026-07-10',
          end_date: '2026-07-13',
          day_part: 'full',
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
