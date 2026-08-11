'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getCachedUser } from '@/lib/auth/context';
import { invalidateAppCache } from '@/lib/cache/invalidate-app';
import { dbErr } from '@/lib/errors/db-error';

export type UpdatePrefsResult = { ok: true } | { ok: false; error: string };

/**
 * Self-update the caller's language preference. Persian is the only calendar,
 * so `calendar_pref` is deliberately no longer accepted by the application.
 */
export async function updateMyPrefs(input: {
  languagePref?: 'fa' | 'en';
}): Promise<UpdatePrefsResult> {
  const supabase = await createClient();
  const user = await getCachedUser();
  if (!user) return dbErr('not authenticated');

  const patch: { language_pref?: string } = {};
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
  // Language changes how every page renders — drop all cached app data.
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
