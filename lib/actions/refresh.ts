'use server';

import { revalidatePath } from 'next/cache';
import { getCachedProfile, getCachedUser } from '@/lib/auth/context';

export type RefreshRouteResult =
  | { ok: true; refreshedAt: string }
  | { ok: false; error: string };

export async function refreshRoute(pathname: string): Promise<RefreshRouteResult> {
  // Server actions are publicly POSTable — don't let anonymous callers
  // purge server caches.
  const user = await getCachedUser();
  if (!user) return { ok: false, error: 'Not authenticated' };
  const profile = await getCachedProfile(user.id);
  if (!profile?.active) return { ok: false, error: 'Account inactive' };

  // Only app-local, locale-prefixed route segments are valid. This prevents a
  // signed-in caller from using the action as an arbitrary cache-purge input.
  if (
    pathname.length > 256 ||
    !/^\/(?:fa|en)(?:\/[a-z0-9-]+)*\/?$/.test(pathname)
  ) {
    return { ok: false, error: 'Invalid path' };
  }

  revalidatePath(pathname, 'page');

  return { ok: true, refreshedAt: new Date().toISOString() };
}
