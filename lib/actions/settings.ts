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
  };
}

export async function getCompanyHolidays(): Promise<
  | {
      ok: true;
      holidays: Holiday[];
      weekendDays: number[];
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
      .select('weekend_days, work_start, work_end, max_hourly_minutes_per_day')
      .eq('company_id', c.companyId)
      .maybeSingle(),
  ]);
  if (he) return dbErr(he.message);
  if (we) return dbErr(we.message);
  return {
    ok: true,
    holidays: (hols ?? []) as Holiday[],
    weekendDays: ws?.weekend_days ?? [5],
    workStart: ws?.work_start ?? '07:00',
    workEnd: ws?.work_end ?? '15:00',
    maxHourlyMinutesPerDay: ws?.max_hourly_minutes_per_day ?? 240,
  };
}

export type WorkSettingsInput = {
  weekendDays: number[];
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
  const v = validateWeekendDays(weekendDays);
  if (!v.ok) {
    return dbErr(v.reason === 'all_week' ? 'at least one working day is required' : 'invalid weekend days');
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
