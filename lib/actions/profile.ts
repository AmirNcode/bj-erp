'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getCachedUser } from '@/lib/auth/context';
import { invalidateAppCache } from '@/lib/cache/invalidate-app';
import { dbErr } from '@/lib/errors/db-error';
import { LOCALE_COOKIE, LOCALE_COOKIE_ATTRS } from '@/lib/i18n/locale';

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

  // FR-34: mirror the choice into the cookie the middleware reads, in the same
  // action as the database write. The JWT's `app_locale` claim carries the same
  // value but only refreshes on a new token (≤1 h), which is far too slow for a
  // setting the user just changed and expects to see immediately.
  if (patch.language_pref) {
    const store = await cookies();
    store.set(LOCALE_COOKIE, patch.language_pref, LOCALE_COOKIE_ATTRS);
  }

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
