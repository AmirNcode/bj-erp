'use server';

/**
 * Viewer-scoped time-off for the calendar (FR-22). Reads the reason-less
 * `team_leave_calendar` view, which scopes rows by viewer (own + same team for
 * employees, everyone for manager/security/admin). `reason` is never selected.
 */

import { requireCaller } from '@/lib/auth/context';
import { dbErr } from '@/lib/errors/db-error';
import type { Database } from '@/lib/supabase/types';
import type { DayPart } from './shared';

export type CalendarEntry = {
  id: string;
  /**
   * 'errand' rows are work trips. `errand_location` is deliberately NOT here:
   * the view omits it, so teammates see that someone is out, not where (FR-25).
   */
  kind: Database['public']['Enums']['request_kind'];
  employee_id: string;
  employee_name: string;
  leave_type_name_fa: string;
  leave_type_name_en: string | null;
  leave_type_color: string | null;
  start_date: string;
  end_date: string;
  day_part: DayPart;
  unit: Database['public']['Enums']['leave_unit'];
  start_time: string | null;
  end_time: string | null;
  status: 'pending' | 'approved';
};

export async function getCalendarEntries(
  rangeStart: string,
  rangeEnd: string
): Promise<{ ok: true; entries: CalendarEntry[] } | { ok: false; error: string }> {
  const c = await requireCaller();
  if (!c.ok) return c;

  // Overlap test: an entry intersects [rangeStart, rangeEnd] when it starts on
  // or before rangeEnd AND ends on or after rangeStart.
  const { data, error } = await c.supabase
    .from('team_leave_calendar')
    .select(
      'id, kind, employee_id, employee_name, leave_type_name_fa, leave_type_name_en, leave_type_color, start_date, end_date, day_part, unit, start_time, end_time, status'
    )
    .lte('start_date', rangeEnd)
    .gte('end_date', rangeStart)
    .order('start_date', { ascending: true });

  if (error) return dbErr(error.message);

  const entries: CalendarEntry[] = (data ?? []).map((r) => ({
    id: r.id ?? '',
    kind: r.kind ?? 'leave',
    employee_id: r.employee_id ?? '',
    employee_name: r.employee_name ?? '—',
    // An errand has no leave type, so the LEFT JOIN leaves these null.
    leave_type_name_fa: r.leave_type_name_fa ?? '—',
    leave_type_name_en: r.leave_type_name_en ?? null,
    leave_type_color: r.leave_type_color ?? null,
    start_date: r.start_date ?? '',
    end_date: r.end_date ?? '',
    day_part: (r.day_part ?? 'full') as DayPart,
    unit: (r.unit ?? 'day') as Database['public']['Enums']['leave_unit'],
    start_time: r.start_time ?? null,
    end_time: r.end_time ?? null,
    status: (r.status ?? 'pending') as 'pending' | 'approved',
  }));

  return { ok: true, entries };
}
