'use server';

/**
 * Company reference data the request and settings forms read: active leave
 * types, work settings with holidays, and the employee list.
 */

import { requireCaller } from '@/lib/auth/context';
import { dbErr } from '@/lib/errors/db-error';

/**
 * Fetches active leave types for the caller's company.
 */
export type LeaveType = {
  id: string;
  name_fa: string;
  name_en: string | null;
  allow_half_day: boolean;
  /** Gates the hourly screen's type list; the SQL re-checks it on submit. */
  allow_hourly: boolean;
  affects_balance: boolean;
  is_paid: boolean;
  color: string | null;
};

export async function getActiveLeaveTypes(): Promise<{
  ok: true;
  types: LeaveType[];
} | { ok: false; error: string }> {
  const c = await requireCaller({ company: true });
  if (!c.ok) return c;

  const { data, error } = await c.supabase
    .from('leave_types')
    .select('id, name_fa, name_en, allow_half_day, allow_hourly, affects_balance, is_paid, color')
    .eq('company_id', c.companyId)
    .eq('active', true)
    .order('name_fa');

  if (error) return dbErr(error.message);

  return { ok: true, types: (data ?? []) as LeaveType[] };
}

/**
 * Fetches work settings (weekend_days) and holidays for the caller's company.
 * Used by the live preview to compute working days client-side.
 */
export type WorkSettings = {
  weekendDays: number[];
  /** FR-41: ISO weekdays off every OTHER week. Empty when unused. */
  biweeklyWeekendDays: number[];
  /** FR-41: a date whose week is an off week. Null when unused. */
  biweeklyAnchor: string | null;
  holidays: string[]; // YYYY-MM-DD strings
  /** What one day of leave means, in hours. Drives every days<->minutes render. */
  hoursPerDay: number;
  /** Company work-hours window; hourly requests must fall inside it (D8). */
  workStart: string;
  workEnd: string;
  /** Per-day cap on hourly leave, in minutes (D7). */
  maxHourlyMinutesPerDay: number;
};

export async function getWorkSettings(): Promise<{
  ok: true;
  settings: WorkSettings;
} | { ok: false; error: string }> {
  const c = await requireCaller({ company: true });
  if (!c.ok) return c;

  const [{ data: ws, error: wsError }, { data: hols, error: holsError }] = await Promise.all([
    c.supabase
      .from('work_settings')
      .select(
        'weekend_days, biweekly_weekend_days, biweekly_anchor, hours_per_day, work_start, work_end, max_hourly_minutes_per_day'
      )
      .eq('company_id', c.companyId)
      .maybeSingle(),
    c.supabase
      .from('holidays')
      .select('holiday_date')
      .eq('company_id', c.companyId),
  ]);

  if (wsError) return dbErr(wsError.message);
  if (holsError) return dbErr(holsError.message);

  return {
    ok: true,
    settings: {
      weekendDays: ws?.weekend_days ?? [5], // default Fri only to match SQL compute_requested_minutes
      biweeklyWeekendDays: ws?.biweekly_weekend_days ?? [],
      biweeklyAnchor: ws?.biweekly_anchor ?? null,
      holidays: (hols ?? []).map((h) => h.holiday_date),
      hoursPerDay: ws?.hours_per_day ?? 8, // matches the work_settings column default
      workStart: ws?.work_start ?? '07:00',
      workEnd: ws?.work_end ?? '15:00',
      maxHourlyMinutesPerDay: ws?.max_hourly_minutes_per_day ?? 240,
    },
  };
}

/**
 * Fetches all employees for admin use (allocation UI).
 */
export type EmployeeOption = {
  id: string;
  full_name: string;
  employee_code: string;
};

export async function getAllEmployees(): Promise<{
  ok: true;
  employees: EmployeeOption[];
} | { ok: false; error: string }> {
  const c = await requireCaller({ anyOf: ['admin'] });
  if (!c.ok) return c;

  const { data, error } = await c.supabase
    .from('profiles')
    .select('id, full_name, employee_code')
    .eq('active', true)
    .order('full_name');

  if (error) return dbErr(error.message);

  return { ok: true, employees: (data ?? []) as EmployeeOption[] };
}
