'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not authenticated' };

  const patch: { calendar_pref?: string; language_pref?: string } = {};
  if (input.calendarPref === 'jalali' || input.calendarPref === 'gregorian') {
    patch.calendar_pref = input.calendarPref;
  }
  if (input.languagePref === 'fa' || input.languagePref === 'en') {
    patch.language_pref = input.languagePref;
  }
  if (Object.keys(patch).length === 0) {
    return { ok: false, error: 'No valid preference to update' };
  }

  const { error } = await supabase.from('profiles').update(patch).eq('id', user.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Clear the session and return to the login page. */
export async function signOut(locale: string): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect(`/${locale}/login`);
}
