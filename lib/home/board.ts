/**
 * Pure home-board view-model. Shapes the role-aware cards from already-fetched
 * data. No I/O — unit-tested.
 */

import type { CalendarEntry } from '@/lib/actions/leave/calendar';
import type { LeaveRequestWithType } from '@/lib/actions/leave/requests';

export type TeamDirectoryMember = {
  id: string;
  fullName: string;
  employeeCode: string;
  relation: 'manager' | 'teammate';
  roles: string[];
  departmentNameFa: string | null;
  departmentNameEn: string | null;
  managerName: string | null;
};

export type TeamUpcomingTimeOff = {
  id: string;
  start_date: string;
  end_date: string;
  leave_type_name_fa: string;
  leave_type_name_en: string | null;
  leave_type_color: string | null;
  status: 'pending' | 'approved';
};

export type TeamDirectoryMemberWithUpcoming = TeamDirectoryMember & {
  upcomingTimeOff: TeamUpcomingTimeOff[];
};

export type HomeBoard = {
  showApprovals: boolean;
  pendingCount: number;
  recent: LeaveRequestWithType[];
  directory: TeamDirectoryMemberWithUpcoming[];
};

export function buildHomeBoard(input: {
  roles: string[];
  requests: LeaveRequestWithType[];
  team: CalendarEntry[];
  directory?: TeamDirectoryMember[];
  pendingCount: number;
}): HomeBoard {
  // hr signs a step of the approval chain too (FR-36), so it gets the queue.
  const showApprovals =
    input.roles.includes('admin') || input.roles.includes('manager') || input.roles.includes('hr');
  const upcomingByEmployee = new Map<string, TeamUpcomingTimeOff[]>();

  for (const entry of input.team) {
    const list = upcomingByEmployee.get(entry.employee_id) ?? [];
    list.push({
      id: entry.id,
      start_date: entry.start_date,
      end_date: entry.end_date,
      leave_type_name_fa: entry.leave_type_name_fa,
      leave_type_name_en: entry.leave_type_name_en,
      leave_type_color: entry.leave_type_color,
      status: entry.status,
    });
    upcomingByEmployee.set(entry.employee_id, list);
  }

  return {
    showApprovals,
    pendingCount: input.pendingCount,
    recent: input.requests.slice(0, 5),
    directory: (input.directory ?? []).map((member) => ({
      ...member,
      upcomingTimeOff: upcomingByEmployee.get(member.id) ?? [],
    })),
  };
}
