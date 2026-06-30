'use server';

import { revalidatePath } from 'next/cache';

export type RefreshRouteResult =
  | { ok: true; refreshedAt: string }
  | { ok: false; error: string };

export async function refreshRoute(pathname: string): Promise<RefreshRouteResult> {
  if (!pathname.startsWith('/') || pathname.startsWith('//')) {
    return { ok: false, error: 'Invalid path' };
  }

  revalidatePath(pathname, 'page');

  return { ok: true, refreshedAt: new Date().toISOString() };
}
