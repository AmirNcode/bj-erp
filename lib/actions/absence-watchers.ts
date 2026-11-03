'use server';

/**
 * Absence watchers (FR-75) — Manage › Approval steps. approval_steps read lists them,
 * approval_steps edit adds, changes and removes them. RLS (absence_watchers_*) is the real
 * gate; the table's CHECKs refuse a row with no type or no view.
 */

import { requireCaller } from '@/lib/auth/context';
import { invalidateAppCache } from '@/lib/cache/invalidate-app';
import { dbErr, type DbErrorResult } from '@/lib/errors/db-error';
import { isValidWatch, watchFromRow, watchToRow, type AbsenceWatch } from '@/lib/absences/watch';

export type AbsenceWatcherRow = {
  userId: string;
  fullName: string;
  personnelNo: string | null;
  active: boolean;
  watch: AbsenceWatch;
};

export async function listAbsenceWatchers(): Promise<{ ok: true; watchers: AbsenceWatcherRow[] } | DbErrorResult> {
  const c = await requireCaller({ perm: ['approval_steps', 'read'], company: true });
  if (!c.ok) return c;
  const { data, error } = await c.supabase
    .from('absence_watchers')
    .select(
      'user_id, leave_day, leave_hour, errand_day, errand_hour, home_tile, full_page, person:profiles!absence_watchers_user_id_fkey(full_name, personnel_no, active)'
    )
    .eq('company_id', c.companyId);
  if (error) return dbErr(error.message);
  const watchers = (data ?? []).map((r) => {
    const person = (r as unknown as { person: { full_name: string; personnel_no: string | null; active: boolean } | null })
      .person;
    return {
      userId: r.user_id,
      fullName: person?.full_name ?? '—',
      personnelNo: person?.personnel_no ?? null,
      active: person?.active !== false,
      watch: watchFromRow(r),
    };
  });
  watchers.sort((a, b) => a.fullName.localeCompare(b.fullName, 'fa'));
  return { ok: true, watchers };
}

/** Add a person to the list, or change what they follow (one row per person). */
export async function saveAbsenceWatcher(input: {
  userId: string;
  watch: AbsenceWatch;
}): Promise<{ ok: true } | DbErrorResult> {
  const c = await requireCaller({ perm: ['approval_steps', 'edit'], company: true });
  if (!c.ok) return c;
  const userId = input.userId?.trim();
  if (!userId) return dbErr('person not found');
  if (!isValidWatch(input.watch)) return dbErr('absence watcher needs a type and a view');

  const { data, error } = await c.supabase
    .from('absence_watchers')
    .upsert({ user_id: userId, company_id: c.companyId, ...watchToRow(input.watch) }, { onConflict: 'user_id' })
    .select('user_id');
  if (error) return dbErr(error.message);
  if (!data || data.length !== 1) return dbErr('absence watcher was not saved');
  invalidateAppCache();
  return { ok: true };
}

export async function removeAbsenceWatcher(userId: string): Promise<{ ok: true } | DbErrorResult> {
  const c = await requireCaller({ perm: ['approval_steps', 'edit'], company: true });
  if (!c.ok) return c;
  const { data, error } = await c.supabase
    .from('absence_watchers')
    .delete()
    .eq('user_id', userId)
    .eq('company_id', c.companyId)
    .select('user_id');
  if (error) return dbErr(error.message);
  if (!data || data.length !== 1) return dbErr('absence watcher not found');
  invalidateAppCache();
  return { ok: true };
}

/**
 * Active colleagues for the dialog's name / personnel-number search. approval_steps depends on
 * people read, so this reads no more than the caller already may.
 */
export async function listAbsenceWatcherCandidates(): Promise<
  { ok: true; people: { id: string; name: string; personnelNo: string | null }[] } | DbErrorResult
> {
  const c = await requireCaller({ perm: ['approval_steps', 'edit'], company: true });
  if (!c.ok) return c;
  const { data, error } = await c.supabase
    .from('profiles')
    .select('id, full_name, personnel_no')
    .eq('company_id', c.companyId)
    .eq('active', true);
  if (error) return dbErr(error.message);
  return { ok: true, people: (data ?? []).map((p) => ({ id: p.id, name: p.full_name, personnelNo: p.personnel_no })) };
}
