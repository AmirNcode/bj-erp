/**
 * View as (FR-86): is this request viewing the app as someone else, and is
 * that view still working?
 *
 * - No `bj-view-as` cookie: `null`, without touching the database.
 * - `live`: the session row exists (read through the real-identity client) and
 *   the probe, sent with the header, shows the target's id and a read-only
 *   transaction — proof the hook ran.
 * - `dead`: anything else, any error included. Fail closed.
 *
 * Server-only. Never import from a Client Component.
 */

import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClientForViewAs, createRealClient } from '@/lib/supabase/server';
import { VIEW_AS_COOKIE } from '@/lib/supabase/constants';

export type LiveViewAs = {
  status: 'live';
  sessionId: string;
  targetId: string;
  name: string;
  personnelNo: string | null;
  expiresAt: string;
};
export type ViewAs = LiveViewAs | { status: 'dead' } | null;

const DEAD = { status: 'dead' } as const;

/** True only when the hook, given `sessionId`, runs as `targetId` read-only. */
export async function probeViewAs(sessionId: string, targetId: string): Promise<boolean> {
  try {
    const supabase = await createClientForViewAs(sessionId);
    const { data, error } = await supabase.rpc('app_view_as_probe');
    if (error || !data || data.length !== 1) return false;
    return data[0].uid === targetId && data[0].read_only === 'on';
  } catch {
    return false;
  }
}

export const getViewAs = cache(async (): Promise<ViewAs> => {
  const sessionId = (await cookies()).get(VIEW_AS_COOKIE)?.value;
  if (!sessionId) return null;
  try {
    const supabase = await createRealClient();
    const { data, error } = await supabase.rpc('app_view_as_session', { p_id: sessionId });
    if (error || !data || data.length !== 1) return DEAD;
    const row = data[0];
    if (!(await probeViewAs(sessionId, row.target_id))) return DEAD;
    return {
      status: 'live',
      sessionId,
      targetId: row.target_id,
      name: row.target_name,
      personnelNo: row.personnel_no,
      expiresAt: row.expires_at,
    };
  } catch {
    return DEAD;
  }
});

/**
 * For layouts: a dead view goes to the route that clears the cookie. Returns
 * the live view, or `null` when not viewing.
 */
export async function redirectIfViewDead(locale: string): Promise<LiveViewAs | null> {
  const view = await getViewAs();
  if (view?.status === 'dead') redirect(`/api/view-as/clear?locale=${encodeURIComponent(locale)}`);
  return view;
}
