'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getCachedUser } from '@/lib/auth/context';
import { invalidateAppCache } from '@/lib/cache/invalidate-app';
import { dbErr } from '@/lib/errors/db-error';

export type UpdatePrefsResult = { ok: true } | { ok: false; error: string };

/**
 * Self-update the caller's UI preferences. Only `calendar_pref` / `language_pref`
 * are written — both are within the self-update column subset allowed by the
 * profiles RLS policy + the profiles_enforce_update_scope trigger (migration 0007).
 */
export async function updateMyPrefs(input: {
  calendarPref?: 'jalali' | 'gregorian';
  languagePref?: 'fa' | 'en';
}): Promise<UpdatePrefsResult> {
  const supabase = await createClient();
  const user = await getCachedUser();
  if (!user) return dbErr('not authenticated');

  const patch: { calendar_pref?: string; language_pref?: string } = {};
  if (input.calendarPref === 'jalali' || input.calendarPref === 'gregorian') {
    patch.calendar_pref = input.calendarPref;
  }
  if (input.languagePref === 'fa' || input.languagePref === 'en') {
    patch.language_pref = input.languagePref;
  }
  if (Object.keys(patch).length === 0) {
    return dbErr('not permitted to update these fields');
  }

  const { data, error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', user.id)
    .select('id');
  if (error) return dbErr(error.message);
  if (!data || data.length !== 1) return dbErr('profile was not updated');
  // Prefs (calendar/language) change how every page renders — drop all of it.
  invalidateAppCache();
  return { ok: true };
}

/** Clear the session and return to the login page. */
export async function signOut(locale: string): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect(`/${locale}/login`);
}

export type ChangePasswordResult = { ok: true } | { ok: false; error: string };

/** Self-service password change. The RPC verifies the current password in-DB. */
export async function changeMyPassword(
  current: string,
  next: string
): Promise<ChangePasswordResult> {
  const supabase = await createClient();
  const user = await getCachedUser();
  if (!user) return dbErr('not authenticated');

  const { error } = await supabase.rpc('app_change_my_password', {
    p_current: current,
    p_new: next,
  });
  if (error) return dbErr(error.message);
  return { ok: true };
}
