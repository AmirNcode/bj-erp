'use server';

import { createClient } from '@/lib/supabase/server';
import { getCachedUser, getCachedRoles, getCachedProfile } from '@/lib/auth/context';
import { validateWeekendDays } from '@/lib/leave/weekend';
import { isValidIsoDate, validateHourlySettings } from '@/lib/leave/settings-validation';
import { invalidateAppCache } from '@/lib/cache/invalidate-app';
import { dbErr } from '@/lib/errors/db-error';

export type Holiday = {
  id: string;
  holiday_date: string; // YYYY-MM-DD Gregorian
  name_fa: string;
  name_en: string | null;
  is_recurring: boolean;
};

type Ctx = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  companyId: string;
  isAdmin: boolean;
  isHr: boolean;
};

async function getCtx(): Promise<Ctx | null> {
  const supabase = await createClient();
  const user = await getCachedUser();
  if (!user) return null;
  const [roles, profile] = await Promise.all([
    getCachedRoles(user.id),
    getCachedProfile(user.id),
  ]);
  return {
    supabase,
    userId: user.id,
    companyId: profile?.company_id ?? '',
    isAdmin: roles.includes('admin'),
    // FR-42: HR configures the approval chain alongside admin. This widens
    // exactly one table — HR still cannot touch work settings, holidays,
    // departments or roles.
    isHr: roles.includes('hr'),
  };
}

export async function getCompanyHolidays(): Promise<
  | {
      ok: true;
      holidays: Holiday[];
      weekendDays: number[];
      biweeklyWeekendDays: number[];
      biweeklyAnchor: string | null;
      workStart: string;
      workEnd: string;
      maxHourlyMinutesPerDay: number;
    }
  | { ok: false; error: string }
> {
  const c = await getCtx();
  if (!c) return dbErr('not authenticated');
  const [{ data: hols, error: he }, { data: ws, error: we }] = await Promise.all([
    c.supabase
      .from('holidays')
      .select('id, holiday_date, name_fa, name_en, is_recurring')
      .eq('company_id', c.companyId)
      .order('holiday_date'),
    c.supabase
      .from('work_settings')
      .select(
        'weekend_days, biweekly_weekend_days, biweekly_anchor, work_start, work_end, max_hourly_minutes_per_day'
      )
      .eq('company_id', c.companyId)
      .maybeSingle(),
  ]);
  if (he) return dbErr(he.message);
  if (we) return dbErr(we.message);
  return {
    ok: true,
    holidays: (hols ?? []) as Holiday[],
    weekendDays: ws?.weekend_days ?? [5],
    biweeklyWeekendDays: ws?.biweekly_weekend_days ?? [],
    biweeklyAnchor: ws?.biweekly_anchor ?? null,
    workStart: ws?.work_start ?? '07:00',
    workEnd: ws?.work_end ?? '15:00',
    maxHourlyMinutesPerDay: ws?.max_hourly_minutes_per_day ?? 240,
  };
}

export type WorkSettingsInput = {
  weekendDays: number[];
  /** FR-41: ISO weekdays off every OTHER week. */
  biweeklyWeekendDays?: number[];
  /** FR-41: a date whose week is an off week; required when the list is set. */
  biweeklyAnchor?: string | null;
  /** 'HH:MM', company-local. Hourly requests must fall inside this window (D8). */
  workStart: string;
  workEnd: string;
  /** Per-day cap on hourly leave, in MINUTES (the form edits hours). */
  maxHourlyMinutesPerDay: number;
};

export async function updateWorkSettings(
  input: WorkSettingsInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  const weekendDays = input.weekendDays;
  const c = await getCtx();
  if (!c) return dbErr('not authenticated');
  if (!c.isAdmin) return dbErr('admin role required');
  const v = validateWeekendDays(
    weekendDays,
    input.biweeklyWeekendDays ?? [],
    input.biweeklyAnchor ?? null
  );
  if (!v.ok) {
    // Each reason gets its own message: "invalid weekend days" told an admin who
    // forgot the anchor nothing about what to do next. The same three rules are
    // CHECK constraints on work_settings, so this is a fast localized refusal
    // rather than the boundary.
    if (v.reason === 'all_week') return dbErr('at least one working day is required');
    if (v.reason === 'anchor_required') return dbErr('a reference date is required for every-other-week days');
    if (v.reason === 'overlap') return dbErr('a day cannot be both weekly and every-other-week');
    return dbErr('invalid weekend days');
  }
  const hourly = validateHourlySettings(
    input.workStart,
    input.workEnd,
    input.maxHourlyMinutesPerDay
  );
  if (!hourly.ok) return dbErr('invalid work hours or hourly leave cap');

  // Upsert on the company_id unique key so a missing row is created instead of
  // a silent 0-row update (the old code reported success without saving).
  const { data, error } = await c.supabase
    .from('work_settings')
    .upsert(
      {
        company_id: c.companyId,
        weekend_days: v.days,
        biweekly_weekend_days: v.biweeklyDays,
        // validateWeekendDays drops an anchor with no bi-weekly day, so this
        // never stores a value nothing reads.
        biweekly_anchor: v.anchor,
        work_start: hourly.workStart,
        work_end: hourly.workEnd,
        max_hourly_minutes_per_day: hourly.capMinutes,
        updated_by: c.userId,
      },
      { onConflict: 'company_id' }
    )
    .select('id');
  if (error) return dbErr(error.message);
  if (!data || data.length !== 1) return dbErr('work settings were not saved');
  invalidateAppCache();
  return { ok: true };
}

export async function upsertHoliday(input: {
  id?: string;
  date: string;
  nameFa: string;
  nameEn?: string;
  isRecurring?: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const c = await getCtx();
  if (!c) return dbErr('not authenticated');
  if (!c.isAdmin) return dbErr('admin role required');
  const nameFa = input.nameFa.trim();
  if (!isValidIsoDate(input.date) || !nameFa) {
    return dbErr('holiday date and farsi name are required');
  }
  const row = {
    holiday_date: input.date,
    name_fa: nameFa,
    name_en: input.nameEn?.trim() || null,
    is_recurring: input.isRecurring ?? false,
  };
  const { data, error } = input.id
    ? await c.supabase
        .from('holidays')
        .update(row)
        .eq('id', input.id)
        .eq('company_id', c.companyId)
        .select('id')
    : await c.supabase
        .from('holidays')
        .insert({ ...row, company_id: c.companyId })
        .select('id');
  if (error) return dbErr(error.message);
  if (!data || data.length !== 1) return dbErr('holiday not found');
  invalidateAppCache();
  return { ok: true };
}

/**
 * Bulk holiday import (FR-40) — admin only.
 *
 * One PostgREST `upsert` on the `(company_id, holiday_date)` unique index, so the
 * whole validated set lands as a single statement and is therefore atomic without
 * a SECURITY DEFINER wrapper. Writes through the existing `holidays_insert_admin`
 * / `holidays_update_admin` policies — no new policy and no new definer surface,
 * exactly like the FR-24 editor beside it.
 *
 * Rows are expected to be already validated by `validateHolidayRows`. This
 * re-checks the shape anyway: the client is not the boundary, and a caller could
 * post here directly.
 */
export async function bulkUpsertHolidays(
  rows: { date: string; nameFa: string; nameEn?: string | null; isRecurring?: boolean }[]
): Promise<{ ok: true; added: number; updated: number } | { ok: false; error: string }> {
  const c = await getCtx();
  if (!c) return dbErr('not authenticated');
  if (!c.isAdmin) return dbErr('admin role required');
  if (rows.length === 0) return dbErr('no holidays to import');
  // Bounded so a runaway file cannot become one enormous statement. 500 is far
  // more than a country's public holidays over several years.
  if (rows.length > 500) return dbErr('too many holidays in one import');

  const seen = new Set<string>();
  for (const r of rows) {
    const nameFa = r.nameFa?.trim() ?? '';
    if (!isValidIsoDate(r.date) || !nameFa) {
      return dbErr('holiday date and farsi name are required');
    }
    if (nameFa.length > 200 || (r.nameEn?.trim().length ?? 0) > 200) {
      return dbErr('holiday name is too long');
    }
    // A duplicate date inside one payload makes the upsert's result depend on
    // element order, so it is refused rather than resolved arbitrarily.
    if (seen.has(r.date)) return dbErr('duplicate holiday date in import');
    seen.add(r.date);
  }

  // Which of these dates already exist, so the result can report added vs
  // updated. Read before the write, under the caller's own RLS.
  const { data: existing, error: readError } = await c.supabase
    .from('holidays')
    .select('holiday_date')
    .eq('company_id', c.companyId)
    .in('holiday_date', [...seen]);
  if (readError) return dbErr(readError.message);
  const existingDates = new Set((existing ?? []).map((h) => h.holiday_date));

  const { data, error } = await c.supabase
    .from('holidays')
    .upsert(
      rows.map((r) => ({
        company_id: c.companyId,
        holiday_date: r.date,
        name_fa: r.nameFa.trim(),
        name_en: r.nameEn?.trim() || null,
        is_recurring: r.isRecurring ?? false,
      })),
      { onConflict: 'company_id,holiday_date' }
    )
    .select('id');
  if (error) return dbErr(error.message);
  if (!data || data.length !== rows.length) return dbErr('holidays were not saved');

  invalidateAppCache();
  const updated = rows.filter((r) => existingDates.has(r.date)).length;
  return { ok: true, added: rows.length - updated, updated };
}

export async function deleteHoliday(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const c = await getCtx();
  if (!c) return dbErr('not authenticated');
  if (!c.isAdmin) return dbErr('admin role required');
  const { data, error } = await c.supabase
    .from('holidays')
    .delete()
    .eq('id', id)
    .eq('company_id', c.companyId)
    .select('id');
  if (error) return dbErr(error.message);
  if (!data || data.length !== 1) return dbErr('holiday not found');
  invalidateAppCache();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Approval chain configuration (FR-36, extended by FR-42) — admin OR hr.
//
// Writes go through the `approval_steps` RLS policies directly, like
// work_settings and holidays: this is company configuration, not transactional
// leave data, so it needs no SECURITY DEFINER wrapper. The role checks below are
// fast localized refusals; the policies are the boundary.
// ---------------------------------------------------------------------------

export type ApprovalStepRow = {
  id: string;
  role: string;
  stepOrder: number;
  appliesTo: string[];
  active: boolean;
  /** FR-42: set when the step is reserved for one named person. */
  approverId: string | null;
  approverName: string | null;
  approverPersonnelNo: string | null;
  /**
   * FR-42: the named approver's account is deactivated, so this step can never
   * be filled and every request needing it is stuck. Surfaced so Settings can
   * say so rather than leaving requests silently pending.
   */
  approverInactive: boolean;
};

export async function getApprovalSteps(): Promise<
  | { ok: true; steps: ApprovalStepRow[]; orderEnforced: boolean }
  | { ok: false; error: string }
> {
  const c = await getCtx();
  if (!c) return dbErr('not authenticated');
  const [{ data: steps, error }, { data: ws }] = await Promise.all([
    c.supabase
      .from('approval_steps')
      .select(
        'id, role, step_order, applies_to, active, approver_id, approver:profiles!approval_steps_approver_id_fkey(full_name, personnel_no, active)'
      )
      .eq('company_id', c.companyId)
      .order('step_order'),
    c.supabase
      .from('work_settings')
      .select('approval_order_enforced')
      .eq('company_id', c.companyId)
      .maybeSingle(),
  ]);
  if (error) return dbErr(error.message);
  return {
    ok: true,
    steps: (steps ?? []).map((s) => {
      const approver = (s as unknown as {
        approver: { full_name: string; personnel_no: string | null; active: boolean } | null;
      }).approver;
      return {
        id: s.id,
        role: s.role as string,
        stepOrder: s.step_order,
        appliesTo: (s.applies_to ?? []) as string[],
        active: s.active,
        approverId: s.approver_id ?? null,
        approverName: approver?.full_name ?? null,
        approverPersonnelNo: approver?.personnel_no ?? null,
        approverInactive: !!s.approver_id && approver?.active === false,
      };
    }),
    orderEnforced: ws?.approval_order_enforced ?? false,
  };
}

/** Activate/deactivate a step, or move it in the order. */
export async function updateApprovalStep(input: {
  id: string;
  active?: boolean;
  stepOrder?: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const c = await getCtx();
  if (!c) return dbErr('not authenticated');
  if (!c.isAdmin && !c.isHr) return dbErr('admin or hr role required');

  const patch: { active?: boolean; step_order?: number } = {};
  if (typeof input.active === 'boolean') patch.active = input.active;
  if (typeof input.stepOrder === 'number') {
    if (!Number.isInteger(input.stepOrder) || input.stepOrder < 1 || input.stepOrder > 99) {
      return dbErr('approval step order must be between 1 and 99');
    }
    patch.step_order = input.stepOrder;
  }
  if (Object.keys(patch).length === 0) return dbErr('not permitted to update these fields');

  const { data, error } = await c.supabase
    .from('approval_steps')
    .update(patch)
    .eq('id', input.id)
    .eq('company_id', c.companyId)
    .select('id');
  if (error) return dbErr(error.message);
  if (!data || data.length !== 1) return dbErr('approval step not found');
  invalidateAppCache();
  return { ok: true };
}

/**
 * Add an approval step (FR-42) — admin or hr.
 *
 * Either a ROLE step (anyone holding that role may sign) or a PERSON step
 * (`approverId` set — only that person may sign, with no admin override). The
 * database's partial unique indexes are what actually prevent a duplicate of
 * either kind; the checks here exist to give a localized message instead of a
 * constraint name.
 */
export async function createApprovalStep(input: {
  role: string;
  approverId?: string | null;
  stepOrder?: number;
  appliesTo?: ('leave' | 'errand')[];
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const c = await getCtx();
  if (!c) return dbErr('not authenticated');
  if (!c.isAdmin && !c.isHr) return dbErr('admin or hr role required');

  const role = input.role;
  if (!['manager', 'hr', 'security', 'admin', 'employee'].includes(role)) {
    return dbErr('invalid approval step role');
  }
  const approverId = input.approverId?.trim() || null;
  // Mirrors the CHECK constraint: "anyone who is an employee may approve" is
  // every colleague in the company, which is not an approval step.
  if (role === 'employee' && !approverId) return dbErr('this step must name a person');

  const stepOrder = input.stepOrder ?? 1;
  if (!Number.isInteger(stepOrder) || stepOrder < 1 || stepOrder > 99) {
    return dbErr('approval step order must be between 1 and 99');
  }
  const appliesTo = input.appliesTo?.length ? input.appliesTo : (['leave', 'errand'] as const);

  const { data, error } = await c.supabase
    .from('approval_steps')
    .insert({
      company_id: c.companyId,
      role: role as 'manager' | 'hr' | 'security' | 'admin' | 'employee',
      approver_id: approverId,
      step_order: stepOrder,
      applies_to: [...appliesTo],
      active: true,
    })
    .select('id');
  if (error) return dbErr(error.message);
  if (!data || data.length !== 1) return dbErr('approval step was not saved');
  invalidateAppCache();
  return { ok: true, id: data[0].id };
}

/**
 * Remove an approval step — admin or hr.
 *
 * Recorded evidence is untouched: `leave_request_approvals` has no foreign key to
 * this table precisely so a signed decision survives its step being deleted, and
 * a printed historical form still shows who signed.
 */
export async function deleteApprovalStep(
  id: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const c = await getCtx();
  if (!c) return dbErr('not authenticated');
  if (!c.isAdmin && !c.isHr) return dbErr('admin or hr role required');

  const { data, error } = await c.supabase
    .from('approval_steps')
    .delete()
    .eq('id', id)
    .eq('company_id', c.companyId)
    .select('id');
  if (error) return dbErr(error.message);
  if (!data || data.length !== 1) return dbErr('approval step not found');
  invalidateAppCache();
  return { ok: true };
}

export type ApproverCandidate = {
  id: string;
  fullName: string;
  personnelNo: string | null;
  employeeCode: string;
};

/**
 * Search active colleagues by name, personnel number, or login code (FR-42).
 *
 * Goes through the `search_approver_candidates` definer function rather than a
 * client select, so the picker receives only the four fields it renders instead
 * of whole profile rows. It does not widen anything: `can_read_all` already gives
 * both admin and hr company-wide profile reads.
 */
export async function searchApproverCandidates(
  query: string
): Promise<{ ok: true; candidates: ApproverCandidate[] } | { ok: false; error: string }> {
  const c = await getCtx();
  if (!c) return dbErr('not authenticated');
  if (!c.isAdmin && !c.isHr) return dbErr('admin or hr role required');

  const { data, error } = await c.supabase.rpc('search_approver_candidates', {
    p_query: query ?? '',
  });
  if (error) return dbErr(error.message);
  return {
    ok: true,
    candidates: ((data ?? []) as {
      id: string;
      full_name: string;
      personnel_no: string | null;
      employee_code: string;
    }[]).map((r) => ({
      id: r.id,
      fullName: r.full_name,
      personnelNo: r.personnel_no,
      employeeCode: r.employee_code,
    })),
  };
}

/**
 * Turn the configured order into a binding sequence, or back off again.
 *
 * Ships false — "any order, whoever is free" — and this switch is the whole
 * mechanism behind the owner's requirement that the order be changeable later.
 */
export async function setApprovalOrderEnforced(
  enforced: boolean
): Promise<{ ok: true } | { ok: false; error: string }> {
  const c = await getCtx();
  if (!c) return dbErr('not authenticated');
  // Admin only, deliberately, even though HR may now edit the STEPS. This writes
  // `work_settings`, whose policy is admin-only and stays that way — admitting HR
  // here would just move the refusal from a clear message to a database error.
  // The card disables the switch for HR to match.
  if (!c.isAdmin) return dbErr('admin role required');

  // Upsert on company_id for the same reason updateWorkSettings does: a missing
  // row must be created rather than silently updating zero rows.
  const { data, error } = await c.supabase
    .from('work_settings')
    .upsert(
      { company_id: c.companyId, approval_order_enforced: enforced, updated_by: c.userId },
      { onConflict: 'company_id' }
    )
    .select('id');
  if (error) return dbErr(error.message);
  if (!data || data.length !== 1) return dbErr('work settings were not saved');
  invalidateAppCache();
  return { ok: true };
}
