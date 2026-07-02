'use server';

import { revalidatePath } from 'next/cache';
import { getCachedUser } from '@/lib/auth/context';

export type RefreshRouteResult =
  | { ok: true; refreshedAt: string }
  | { ok: false; error: string };

export async function refreshRoute(pathname: string): Promise<RefreshRouteResult> {
  // Server actions are publicly POSTable — don't let anonymous callers
  // purge server caches.
  const user = await getCachedUser();
  if (!user) return { ok: false, error: 'Not authenticated' };

  if (!pathname.startsWith('/') || pathname.startsWith('//')) {
    return { ok: false, error: 'Invalid path' };
  }

  revalidatePath(pathname, 'page');

  return { ok: true, refreshedAt: new Date().toISOString() };
}
