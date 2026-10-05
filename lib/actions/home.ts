'use server';

/**
 * Reads for the home dashboard (2026-10 redesign): today's pulse band, my
 * balance usage (entitled / used), the next official holiday, and requesters'
 * current balances for the inline approval rows. Shaping is pure, in
 * lib/home/pulse.ts.
 */

import { requireCaller } from '@/lib/auth/context';
import { createClient } from '@/lib/supabase/server';
import { dbErr } from '@/lib/errors/db-error';
import { todayInAppTz } from '@/lib/appDate';
import { latestBalances } from '@/lib/leave/balances';
import { buildBalanceUsage, buildTodayPulse, type BalanceUsage, type TodayPulse } from '@/lib/home/pulse';
import { getCalendarEntries } from './leave/calendar';
import { accrueBeforeRead } from './leave/shared';

/**
 * Today's pulse, scoped: hr and admin see the whole company, a manager sees
 * their direct reports. RLS agrees — a manager cannot read other teams anyway.
 */
export async function getTodayPulse(): Promise<
  { ok: true; pulse: TodayPulse; companyWide: boolean } | { ok: false; error: string }
> {
  const c = await requireCaller({ company: true });
  if (!c.ok) return c;

  const companyWide = c.roles.includes('admin') || c.roles.includes('hr');
  const today = todayInAppTz();

  let profilesQuery = c.supabase
    .from('profiles')
    .select('id, department_id')
    .eq('company_id', c.companyId)
    .eq('active', true);
  if (!companyWide) profilesQuery = profilesQuery.eq('manager_id', c.user.id);

  const [{ data: profiles, error }, entriesRes] = await Promise.all([
    profilesQuery,
    getCalendarEntries(today, today),
  ]);
  if (error) return dbErr(error.message);

  return {
    ok: true,
    companyWide,
    pulse: buildTodayPulse({
      today,
      profiles: profiles ?? [],
      entries: entriesRes.ok ? entriesRes.entries : [],
    }),
  };
}

/** Gregorian start of the current Jalali year (1 Farvardin), or Jan 1 as a fallback. */
async function currentJalaliYearStart(
  supabase: Awaited<ReturnType<typeof createClient>>,
  today: string
): Promise<string> {
  const { data: month } = await supabase
    .from('jalali_months')
    .select('jalali_year')
    .lte('gregorian_start', today)
    .gte('gregorian_end', today)
    .maybeSingle();
  if (!month) return `${today.slice(0, 4)}-01-01`;
  const { data: first } = await supabase
    .from('jalali_months')
    .select('gregorian_start')
    .eq('jalali_year', month.jalali_year)
    .eq('jalali_month', 1)
    .maybeSingle();
  return first?.gregorian_start ?? `${today.slice(0, 4)}-01-01`;
}

/** The caller's own entitled / used / left per active leave type, this Jalali year. */
export async function getMyBalanceUsage(): Promise<
  { ok: true; usage: BalanceUsage[] } | { ok: false; error: string }
> {
  const c = await requireCaller({ company: true });
  if (!c.ok) return c;

  await accrueBeforeRead(c.supabase);
  const yearStart = await currentJalaliYearStart(c.supabase, todayInAppTz());

  const [types, ledger, unpaid] = await Promise.all([
    c.supabase
      .from('leave_types')
      .select('id, name_fa, name_en, affects_balance')
      .eq('company_id', c.companyId)
      .eq('active', true)
      .order('name_fa'),
    c.supabase
      .from('leave_ledger')
      .select('leave_type_id, balance_after_minutes, seq, entry_type, delta_minutes, created_at')
      .eq('employee_id', c.user.id),
    c.supabase
      .from('leave_requests')
      .select('leave_type_id, requested_minutes, leave_types!inner(affects_balance)')
      .eq('employee_id', c.user.id)
      .eq('status', 'approved')
      .eq('kind', 'leave')
      .eq('leave_types.affects_balance', false)
      .gte('start_date', yearStart),
  ]);
  if (types.error) return dbErr(types.error.message);
  if (ledger.error) return dbErr(ledger.error.message);
  if (unpaid.error) return dbErr(unpaid.error.message);

  const rows = ledger.data ?? [];
  return {
    ok: true,
    usage: buildBalanceUsage({
      types: types.data ?? [],
      balances: latestBalances(rows),
      ledger: rows.filter((r) => r.created_at.slice(0, 10) >= yearStart),
      unpaidRequests: unpaid.data ?? [],
    }),
  };
}

export type NextHoliday = { date: string; name_fa: string; name_en: string | null };

/** The first company holiday on or after today. */
export async function getNextHoliday(): Promise<NextHoliday | null> {
  const c = await requireCaller({ company: true });
  if (!c.ok) return null;
  const { data } = await c.supabase
    .from('holidays')
    .select('holiday_date, name_fa, name_en')
    .eq('company_id', c.companyId)
    .gte('holiday_date', todayInAppTz())
    .order('holiday_date')
    .limit(1)
    .maybeSingle();
  return data ? { date: data.holiday_date, name_fa: data.name_fa, name_en: data.name_en } : null;
}

/**
 * Current balance per `${employeeId}:${leaveTypeId}` for the given requesters —
 * the "balance after approval" hint on the home approval rows. Read through
 * leave_ledger's own policy (self, manager-of, can_read_all); rows the caller
 * may not read simply come back missing and the hint is left out.
 */
export async function getRequesterBalances(
  employeeIds: string[]
): Promise<Record<string, number>> {
  if (employeeIds.length === 0) return {};
  const c = await requireCaller();
  if (!c.ok) return {};
  const { data } = await c.supabase
    .from('leave_ledger')
    .select('employee_id, leave_type_id, balance_after_minutes, seq')
    .in('employee_id', [...new Set(employeeIds)]);
  const out: Record<string, number> = {};
  const byEmployee = new Map<string, NonNullable<typeof data>>();
  for (const r of data ?? []) {
    const list = byEmployee.get(r.employee_id) ?? [];
    list.push(r);
    byEmployee.set(r.employee_id, list);
  }
  for (const [emp, rows] of byEmployee) {
    for (const [type, minutes] of Object.entries(latestBalances(rows))) {
      out[`${emp}:${type}`] = minutes;
    }
  }
  return out;
}
