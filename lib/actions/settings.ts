'use server';

import { createClient } from '@/lib/supabase/server';
import { validateWeekendDays } from '@/lib/leave/weekend';

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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const [{ data: roles }, { data: profile }] = await Promise.all([
    supabase.from('user_roles').select('role').eq('user_id', user.id),
    supabase.from('profiles').select('company_id').eq('id', user.id).single(),
  ]);
  return {
    supabase,
    userId: user.id,
    companyId: profile?.company_id ?? '',
    isAdmin: (roles ?? []).some((r) => r.role === 'admin'),
  };
}

export async function getCompanyHolidays(): Promise<
  { ok: true; holidays: Holiday[]; weekendDays: number[] } | { ok: false; error: string }
> {
  const c = await getCtx();
  if (!c) return { ok: false, error: 'Not authenticated' };
  const [{ data: hols, error: he }, { data: ws, error: we }] = await Promise.all([
    c.supabase
      .from('holidays')
      .select('id, holiday_date, name_fa, name_en, is_recurring')
      .eq('company_id', c.companyId)
      .order('holiday_date'),
    c.supabase.from('work_settings').select('weekend_days').eq('company_id', c.companyId).maybeSingle(),
  ]);
  if (he) return { ok: false, error: he.message };
  if (we) return { ok: false, error: we.message };
  return { ok: true, holidays: (hols ?? []) as Holiday[], weekendDays: ws?.weekend_days ?? [5] };
}

export async function updateWorkSettings(
  weekendDays: number[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  const c = await getCtx();
  if (!c) return { ok: false, error: 'Not authenticated' };
  if (!c.isAdmin) return { ok: false, error: 'Admin role required' };
  const v = validateWeekendDays(weekendDays);
  if (!v.ok) {
    return {
      ok: false,
      error: v.reason === 'all_week' ? 'At least one working day is required' : 'Invalid weekend days',
    };
  }
  const { error } = await c.supabase
    .from('work_settings')
    .update({ weekend_days: v.days, updated_by: c.userId })
    .eq('company_id', c.companyId);
  if (error) return { ok: false, error: error.message };
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
  if (!c) return { ok: false, error: 'Not authenticated' };
  if (!c.isAdmin) return { ok: false, error: 'Admin role required' };
  if (!input.date || !input.nameFa) return { ok: false, error: 'Date and Farsi name are required' };
  const row = {
    holiday_date: input.date,
    name_fa: input.nameFa,
    name_en: input.nameEn ?? null,
    is_recurring: input.isRecurring ?? false,
  };
  const { error } = input.id
    ? await c.supabase.from('holidays').update(row).eq('id', input.id)
    : await c.supabase.from('holidays').insert({ ...row, company_id: c.companyId });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function deleteHoliday(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const c = await getCtx();
  if (!c) return { ok: false, error: 'Not authenticated' };
  if (!c.isAdmin) return { ok: false, error: 'Admin role required' };
  const { error } = await c.supabase.from('holidays').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
