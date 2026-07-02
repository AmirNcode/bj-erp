/**
 * Per-request cached auth context.
 *
 * `auth.getUser()` is a network round-trip to the Supabase Auth server, and the
 * roles/profile reads hit Postgres. Server Components, the layout guard, and
 * every server action used to fetch these independently — a single page render
 * could validate the user 6–7 times. Wrapping them in React `cache()` memoizes
 * each call for the lifetime of one server request, so they run **once** no
 * matter how many callers ask. All callers pass the caller's own id, so the
 * profile read stays a `self` SELECT under RLS.
 *
 * Server-only. Never import from a Client Component.
 */

import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';

/** The authenticated user (or null), validated at most once per request. */
export const getCachedUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

/** The caller's role slugs, fetched at most once per request. */
export const getCachedRoles = cache(async (userId: string): Promise<string[]> => {
  const supabase = await createClient();
  const { data } = await supabase.from('user_roles').select('role').eq('user_id', userId);
  return (data ?? []).map((r) => r.role as string);
});

/** The caller's own profile row (all columns), fetched at most once per request. */
export const getCachedProfile = cache(async (userId: string) => {
  const supabase = await createClient();
  const { data } = await supabase.from('profiles').select('*').eq('id', userId).single();
  return data;
});
