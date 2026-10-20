'use server';

/**
 * Approved absences on one day (FR-56) — the board for absences read (FR-55:
 * the security and hr presets; the admin implicitly).
 *
 * Security needs to know who is out and that their request is fully approved;
 * it never approves. Only `approved` requests are listed — pending ones never
 * show. Reads through the `leave_requests_select` policy: absences depends on
 * leave_requests read and people read (D6), so this adds no read surface. The
 * reason and the errand location are not selected: the gate needs who and
 * when, not why.
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

export async function getApprovedAbsences(
  date: string
): Promise<{ ok: true; absences: Absence[] } | DbErrorResult> {
  const c = await requireCaller({ perm: ['absences', 'read'] });
  if (!c.ok) return c;
  if (!isValidIsoDate(date)) return dbErr('invalid date');

  const { data, error } = await c.supabase
    .from('leave_requests')
    .select(
      `id, kind, unit, start_date, end_date, start_time, end_time,
       profiles!leave_requests_employee_id_fkey(full_name, personnel_no, departments!profiles_department_id_fkey(name_fa, name_en)),
       leave_types(name_fa, name_en)`
    )
    .eq('status', 'approved')
    .lte('start_date', date)
    .gte('end_date', date)
    .order('start_time', { ascending: true, nullsFirst: true });
  if (error) return dbErr(error.message);

  type Row = {
    id: string;
    kind: Absence['kind'];
    unit: Absence['unit'];
    start_date: string;
    end_date: string;
    start_time: string | null;
    end_time: string | null;
    profiles: {
      full_name: string;
      personnel_no: string | null;
      departments: { name_fa: string; name_en: string | null } | null;
    } | null;
    leave_types: { name_fa: string; name_en: string | null } | null;
  };

  const absences = ((data ?? []) as unknown as Row[])
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      unit: r.unit,
      employeeName: r.profiles?.full_name ?? '—',
      personnelNo: r.profiles?.personnel_no ?? null,
      departmentNameFa: r.profiles?.departments?.name_fa ?? null,
      departmentNameEn: r.profiles?.departments?.name_en ?? null,
      leaveTypeNameFa: r.leave_types?.name_fa ?? null,
      leaveTypeNameEn: r.leave_types?.name_en ?? null,
      startDate: r.start_date,
      endDate: r.end_date,
      startTime: r.start_time,
      endTime: r.end_time,
    }))
    // All-day first, then hourly by start time; names break ties.
    .sort(
      (a, b) =>
        (a.unit === 'hour' ? 1 : 0) - (b.unit === 'hour' ? 1 : 0) ||
        (a.startTime ?? '').localeCompare(b.startTime ?? '') ||
        a.employeeName.localeCompare(b.employeeName, 'fa')
    );

  return { ok: true, absences };
}
