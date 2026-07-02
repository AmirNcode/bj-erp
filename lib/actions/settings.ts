'use server';

import { createClient } from '@/lib/supabase/server';
import { getCachedUser, getCachedRoles, getCachedProfile } from '@/lib/auth/context';
import { validateWeekendDays } from '@/lib/leave/weekend';
import { dbErr } from '@/lib/errors/db-error';

export type Holiday = {
  id: string;
  holiday_date: string; // YYYY-MM-DD Gregorian
  name_fa: string;
  name_en: string | null;
  is_recurring: boolean;
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
  { ok: true; holidays: Holiday[]; weekendDays: number[] } | { ok: false; error: string }
> {
  const c = await getCtx();
  if (!c) return dbErr('not authenticated');
  const [{ data: hols, error: he }, { data: ws, error: we }] = await Promise.all([
    c.supabase
      .from('holidays')
      .select('id, holiday_date, name_fa, name_en, is_recurring')
      .eq('company_id', c.companyId)
      .order('holiday_date'),
    c.supabase.from('work_settings').select('weekend_days').eq('company_id', c.companyId).maybeSingle(),
  ]);
  if (he) return dbErr(he.message);
  if (we) return dbErr(we.message);
  return { ok: true, holidays: (hols ?? []) as Holiday[], weekendDays: ws?.weekend_days ?? [5] };
}

export async function updateWorkSettings(
  weekendDays: number[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  const c = await getCtx();
  if (!c) return dbErr('not authenticated');
  if (!c.isAdmin) return dbErr('admin role required');
  const v = validateWeekendDays(weekendDays);
  if (!v.ok) {
    return dbErr(v.reason === 'all_week' ? 'at least one working day is required' : 'invalid weekend days');
  }
  // Upsert on the company_id unique key so a missing row is created instead of
  // a silent 0-row update (the old code reported success without saving).
  const { error } = await c.supabase
    .from('work_settings')
    .upsert(
      { company_id: c.companyId, weekend_days: v.days, updated_by: c.userId },
      { onConflict: 'company_id' }
    );
  if (error) return dbErr(error.message);
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
  if (!input.date || !input.nameFa) return dbErr('holiday date and farsi name are required');
  if (!ISO_DATE_RE.test(input.date)) return dbErr('holiday date and farsi name are required');
  const row = {
    holiday_date: input.date,
    name_fa: input.nameFa.trim(),
    name_en: input.nameEn?.trim() || null,
    is_recurring: input.isRecurring ?? false,
  };
  const { error } = input.id
    ? await c.supabase.from('holidays').update(row).eq('id', input.id).eq('company_id', c.companyId)
    : await c.supabase.from('holidays').insert({ ...row, company_id: c.companyId });
  if (error) return dbErr(error.message);
  return { ok: true };
}

export async function deleteHoliday(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const c = await getCtx();
  if (!c) return dbErr('not authenticated');
  if (!c.isAdmin) return dbErr('admin role required');
  const { error } = await c.supabase.from('holidays').delete().eq('id', id).eq('company_id', c.companyId);
  if (error) return dbErr(error.message);
  return { ok: true };
}
