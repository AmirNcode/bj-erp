'use server';

/**
 * HR report data (FR-37).
 *
 * Everything here is a plain SELECT through existing RLS — no new policy and no
 * new SECURITY DEFINER surface. `can_read_all` (which gained `hr` in
 * 20260818130002) is what makes these reads company-wide; an `employee` calling
 * this would see only themselves even if they got past the role check.
 *
 * The role check below is therefore a fast, localized refusal, not the boundary.
 */

import { createClient } from '@/lib/supabase/server';
import { getCachedUser, getCachedRoles, getCachedProfile } from '@/lib/auth/context';
import { dbErr } from '@/lib/errors/db-error';
import { todayInAppTz } from '@/lib/appDate';
import { outstandingSteps, type SignedStep, type StepRole } from '@/lib/leave/approvals';
import { getApprovalConfig } from '@/lib/actions/leave';
import type { EmployeeRow, LedgerRow, LeaveTypeRow, RequestRow } from '@/lib/reports/reports';

export type ReportData = {
  employees: EmployeeRow[];
  ledger: LedgerRow[];
  leaveTypes: LeaveTypeRow[];
  requests: RequestRow[];
  hoursPerDay: number;
  today: string;
  rangeStart: string;
  rangeEnd: string;
};

export type JalaliMonthOption = {
  gregorianStart: string;
  gregorianEnd: string;
  jalaliYear: number;
  jalaliMonth: number;
};

/**
 * Selectable Jalali months for the period filter — the current Jalali year and
 * the one before it.
 *
 * Read from the `jalali_months` table rather than converted in JS: that table is
 * the calendar dimension the whole accrual and serial system already joins
 * against, so the report's idea of "Mordad 1405" cannot drift from the ledger's.
 */
export async function getReportMonths(): Promise<JalaliMonthOption[]> {
  const supabase = await createClient();
  const today = todayInAppTz();

  const { data: current } = await supabase
    .from('jalali_months')
    .select('jalali_year')
    .lte('gregorian_start', today)
    .gte('gregorian_end', today)
    .maybeSingle();

  const year = current?.jalali_year;
  if (!year) return [];

  const { data } = await supabase
    .from('jalali_months')
    .select('jalali_year, jalali_month, gregorian_start, gregorian_end')
    .gte('jalali_year', year - 1)
    .lte('jalali_year', year)
    .order('gregorian_start');

  return (data ?? []).map((m) => ({
    gregorianStart: m.gregorian_start,
    gregorianEnd: m.gregorian_end,
    jalaliYear: m.jalali_year,
    jalaliMonth: m.jalali_month,
  }));
}

export async function getReportData(
  rangeStart: string,
  rangeEnd: string
): Promise<{ ok: true; data: ReportData } | { ok: false; error: string }> {
  const supabase = await createClient();
  const user = await getCachedUser();
  if (!user) return dbErr('not authenticated');

  const [roles, profile] = await Promise.all([
    getCachedRoles(user.id),
    getCachedProfile(user.id),
  ]);
  if (!roles.includes('hr') && !roles.includes('admin')) {
    return dbErr('not allowed to review requests');
  }
  const companyId = profile?.company_id;
  if (!companyId) return dbErr('no profile for caller');

  const [
    { data: employees, error: empError },
    { data: ledger, error: ledgerError },
    { data: leaveTypes },
    { data: requests, error: reqError },
    { data: ws },
  ] = await Promise.all([
    // `manager_id` is resolved in memory below rather than embedded. PostgREST
    // refused the self-referential embed here ("Could not find a relationship
    // between 'profiles' and 'profiles'") even with the correct constraint hint,
    // and since every profile is already in this result set, the join buys
    // nothing but a failure mode.
    supabase
      .from('profiles')
      .select(
        `id, full_name, employee_code, personnel_no, hire_date, active, manager_id,
         departments!profiles_department_id_fkey(name_fa, name_en)`
      )
      .eq('company_id', companyId)
      .order('full_name'),
    supabase.from('leave_ledger').select('employee_id, leave_type_id, balance_after_minutes, seq'),
    supabase
      .from('leave_types')
      .select('id, name_fa, name_en')
      .eq('company_id', companyId)
      .eq('active', true)
      .order('name_fa'),
    // Overlap test, matching the calendar: a request counts for the period when
    // it starts on or before the end AND ends on or after the start.
    supabase
      .from('leave_requests')
      .select(
        'id, employee_id, kind, status, start_date, end_date, requested_minutes, unpaid_minutes, created_at, leave_types(name_fa, name_en)'
      )
      .lte('start_date', rangeEnd)
      .gte('end_date', rangeStart),
    supabase.from('work_settings').select('hours_per_day').eq('company_id', companyId).maybeSingle(),
  ]);

  if (empError) return dbErr(empError.message);
  if (ledgerError) return dbErr(ledgerError.message);
  if (reqError) return dbErr(reqError.message);

  type EmpRow = {
    id: string;
    full_name: string;
    employee_code: string;
    personnel_no: string | null;
    hire_date: string | null;
    active: boolean;
    manager_id: string | null;
    departments: { name_fa: string; name_en: string | null } | null;
  };
  type ReqRow = {
    id: string;
    employee_id: string;
    kind: 'leave' | 'errand';
    status: 'pending' | 'approved' | 'rejected' | 'cancelled';
    start_date: string;
    end_date: string;
    requested_minutes: number;
    unpaid_minutes: number;
    created_at: string;
    leave_types: { name_fa: string; name_en: string | null } | null;
  };

  const mappedRequests: RequestRow[] = ((requests ?? []) as unknown as ReqRow[]).map((r) => ({
    id: r.id,
    employeeId: r.employee_id,
    kind: r.kind ?? 'leave',
    status: r.status,
    startDate: r.start_date,
    endDate: r.end_date,
    requestedMinutes: r.requested_minutes,
    unpaidMinutes: r.unpaid_minutes ?? 0,
    createdAt: r.created_at,
    leaveTypeName: r.leave_types?.name_fa ?? null,
    outstanding: [],
  }));

  // Who each pending request is still waiting on (FR-36). Only pending rows need
  // it, so the approvals query is scoped to them.
  const pendingIds = mappedRequests.filter((r) => r.status === 'pending').map((r) => r.id);
  if (pendingIds.length > 0) {
    const [{ steps }, { data: approvals }] = await Promise.all([
      getApprovalConfig(),
      supabase
        .from('leave_request_approvals')
        .select('request_id, step_role, decision')
        .in('request_id', pendingIds),
    ]);
    const byRequest = new Map<string, SignedStep[]>();
    for (const a of approvals ?? []) {
      const list = byRequest.get(a.request_id) ?? [];
      list.push({
        stepRole: a.step_role as StepRole,
        decision: a.decision as 'approved' | 'rejected',
      });
      byRequest.set(a.request_id, list);
    }
    for (const r of mappedRequests) {
      if (r.status !== 'pending') continue;
      r.outstanding = outstandingSteps(steps, byRequest.get(r.id) ?? [], r.kind);
    }
  }

  const empRows = (employees ?? []) as unknown as EmpRow[];
  const nameById = new Map(empRows.map((e) => [e.id, e.full_name]));

  return {
    ok: true,
    data: {
      employees: empRows.map((e) => ({
        id: e.id,
        fullName: e.full_name,
        employeeCode: e.employee_code,
        personnelNo: e.personnel_no,
        departmentName: e.departments?.name_fa ?? e.departments?.name_en ?? null,
        managerName: e.manager_id ? (nameById.get(e.manager_id) ?? null) : null,
        hireDate: e.hire_date,
        active: e.active,
      })),
      ledger: (ledger ?? []).map((l) => ({
        employeeId: l.employee_id,
        leaveTypeId: l.leave_type_id,
        balanceAfterMinutes: l.balance_after_minutes,
        seq: l.seq,
      })) as LedgerRow[],
      leaveTypes: (leaveTypes ?? []).map((t) => ({
        id: t.id,
        name: t.name_fa,
      })) as LeaveTypeRow[],
      requests: mappedRequests,
      hoursPerDay: Number(ws?.hours_per_day ?? 8),
      today: todayInAppTz(),
      rangeStart,
      rangeEnd,
    },
  };
}
