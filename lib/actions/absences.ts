'use server';

/**
 * Approved absences (FR-56) for absence watchers (FR-75: a per-person list on Manage ›
 * Approval steps; the admin sees everything without a row).
 *
 * Only `approved` requests are listed — pending ones never show. Rows come from the
 * `watched_absences` definer function, which keeps only the request types the caller
 * follows (none without a row) and returns who and when, never the reason or the errand
 * location — so a watcher needs no leave_requests or people read.
 */

import { requireCaller } from '@/lib/auth/context';
import { dbErr, type DbErrorResult } from '@/lib/errors/db-error';
import { isValidIsoDate } from '@/lib/leave/settings-validation';
import type { Database } from '@/lib/supabase/types';

export type Absence = {
  id: string;
  kind: Database['public']['Enums']['request_kind'];
  unit: Database['public']['Enums']['leave_unit'];
  employeeName: string;
  personnelNo: string | null;
  departmentNameFa: string | null;
  departmentNameEn: string | null;
  leaveTypeNameFa: string | null;
  leaveTypeNameEn: string | null;
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
};

type Row = Database['public']['Functions']['watched_absences']['Returns'][number];

const toAbsence = (r: Row): Absence => ({
  id: r.id,
  kind: r.kind,
  unit: r.unit,
  employeeName: r.employee_name ?? '—',
  personnelNo: r.personnel_no,
  departmentNameFa: r.department_name_fa,
  departmentNameEn: r.department_name_en,
  leaveTypeNameFa: r.leave_type_name_fa,
  leaveTypeNameEn: r.leave_type_name_en,
  startDate: r.start_date,
  endDate: r.end_date,
  startTime: r.start_time,
  endTime: r.end_time,
});

// All-day first, then hourly by start time; names break ties.
const byDayThenTime = (a: Absence, b: Absence) =>
  (a.unit === 'hour' ? 1 : 0) - (b.unit === 'hour' ? 1 : 0) ||
  (a.startTime ?? '').localeCompare(b.startTime ?? '') ||
  a.employeeName.localeCompare(b.employeeName, 'fa');

export async function getApprovedAbsences(
  date: string
): Promise<{ ok: true; absences: Absence[] } | DbErrorResult> {
  if (!isValidIsoDate(date)) return dbErr('invalid date');
  const r = await watchedAbsences(date, date);
  return r.ok ? { ok: true, absences: r.absences.sort(byDayThenTime) } : r;
}

/**
 * Approved absences that overlap [from, to] — the 30-day look-ahead (Home card,
 * admin's Absences page), so HR can enter leave into the attendance
 * (fingerprint) system. Ordered by start date, then as on the day board.
 */
export async function getUpcomingAbsences(
  from: string,
  to: string
): Promise<{ ok: true; absences: Absence[] } | DbErrorResult> {
  if (!isValidIsoDate(from) || !isValidIsoDate(to)) return dbErr('invalid date');
  const r = await watchedAbsences(from, to);
  return r.ok
    ? { ok: true, absences: r.absences.sort((a, b) => a.startDate.localeCompare(b.startDate) || byDayThenTime(a, b)) }
    : r;
}

// Overlap with [from, to], so an absence already under way on `from` is listed too.
async function watchedAbsences(
  from: string,
  to: string
): Promise<{ ok: true; absences: Absence[] } | DbErrorResult> {
  const c = await requireCaller();
  if (!c.ok) return c;
  const { data, error } = await c.supabase.rpc('watched_absences', { p_from: from, p_to: to });
  if (error) return dbErr(error.message);
  return { ok: true, absences: (data ?? []).map(toAbsence) };
}
