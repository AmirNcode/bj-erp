/**
 * Pure home-board view-model. Shapes the role-aware cards from already-fetched
 * data. No I/O — unit-tested.
 */

import type { CalendarEntry } from '@/lib/actions/leave/calendar';
import type { LeaveRequestWithType } from '@/lib/actions/leave/requests';
import { returnToWork, type ReturnToWorkSettings } from '@/lib/leave/returnToWork';

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
  canApprove?: boolean;
  requests: LeaveRequestWithType[];
  team: CalendarEntry[];
  directory?: TeamDirectoryMember[];
  pendingCount: number;
  /** Tehran today, Gregorian YYYY-MM-DD. */
  today: string;
  /** Weekends, holidays and working hours for the return-to-work day. */
  workSettings: ReturnToWorkSettings;
  /** Rejected requests the requester removed from Home. */
  dismissedIds?: string[];
}): HomeBoard {
  // hr signs a step of the approval chain too (FR-36), so it gets the queue.
  const showApprovals = input.canApprove ?? (
    input.roles.includes('admin') || input.roles.includes('manager') || input.roles.includes('hr'));
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
    recent: recentOnHome(input.requests, input.today, input.workSettings, input.dismissedIds ?? []),
    directory: (input.directory ?? []).map((member) => ({
      ...member,
      upcomingTimeOff: upcomingByEmployee.get(member.id) ?? [],
    })),
  };
}

/**
 * FR-72: a request stays on Home until the requester is back at work. It leaves
 * on the return-to-work day; when the return falls later the same day (hourly,
 * morning half day) it stays through that day. Cancelled and removed requests
 * leave at once. Without a return day (bad settings) it stays through its end date.
 */
export function recentOnHome(
  requests: LeaveRequestWithType[],
  today: string,
  settings: ReturnToWorkSettings,
  dismissedIds: string[]
): LeaveRequestWithType[] {
  const dismissed = new Set(dismissedIds);
  return requests.filter((r) => {
    if (r.status === 'cancelled' || dismissed.has(r.id)) return false;
    const back = returnToWork(
      { unit: r.unit, dayPart: r.day_part, end: r.end_date, endTime: r.end_time },
      settings
    );
    if (!back) return today <= r.end_date;
    return back.time === null ? today < back.date : today <= back.date;
  });
}
