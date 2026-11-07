'use server';

import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { ADMIN_LOCALE } from '@/lib/admin/locale';
import { buildViewAsPeople } from '@/lib/admin/viewAs';
import type { PersonSearchOption } from '@/components/PersonSearch';
import { requireCaller } from '@/lib/auth/context';
import { getViewAs, probeViewAs } from '@/lib/auth/viewAs';
import { dbErr, type DbErrorResult } from '@/lib/errors/db-error';
import { createRealClient } from '@/lib/supabase/server';
import { VIEW_AS_COOKIE, VIEW_AS_COOKIE_ATTRS } from '@/lib/supabase/constants';

const adminErr = (raw: string) => dbErr(raw, { locale: ADMIN_LOCALE });

/** End the view: close the session in the database, then drop the cookie either way. */
export async function endViewAs(): Promise<void> {
  const supabase = await createRealClient();
  await supabase.rpc('app_view_as_end');
  (await cookies()).delete({ name: VIEW_AS_COOKIE, path: VIEW_AS_COOKIE_ATTRS.path });
}

/** Active people of the company other than the admin, with their top role as a hint. */
export async function getViewAsPeople(): Promise<{ ok: true; people: PersonSearchOption[] } | DbErrorResult> {
  const c = await requireCaller({ anyOf: ['admin'], company: true });
  if (!c.ok) return c;
  const { data: profiles, error } = await c.supabase
    .from('profiles')
    .select('id, full_name, personnel_no')
    .eq('company_id', c.companyId)
    .eq('active', true)
    .neq('id', c.user.id)
    .order('full_name');
  if (error) return adminErr(error.message);
  // A separate read: the people are filtered above, and one query per table keeps the RLS simple.
  const { data: roleRows, error: roleError } = await c.supabase.from('user_roles').select('user_id, role, roles(name)');
  if (roleError) return adminErr(roleError.message);
  const tr = await getTranslations({ locale: ADMIN_LOCALE, namespace: 'roles' });
  return { ok: true, people: buildViewAsPeople(profiles ?? [], roleRows ?? [], (r) => tr(r)) };
}

/** Start viewing as `targetId`: open the session, set the cookie, prove the hook runs; undo it all if not. */
export async function startViewAs(targetId: string): Promise<{ ok: true } | DbErrorResult> {
  // Views do not nest: exit the current one first.
  if ((await getViewAs()) !== null) return adminErr('view as unavailable');
  const supabase = await createRealClient();
  const { data, error } = await supabase.rpc('app_view_as_start', { p_target: targetId });
  if (error) return adminErr(error.message);
  const sessionId = data?.[0]?.session_id;
  if (!sessionId) return adminErr('view as unavailable');
  const jar = await cookies();
  jar.set({ name: VIEW_AS_COOKIE, value: sessionId, ...VIEW_AS_COOKIE_ATTRS });
  if (!(await probeViewAs(sessionId, targetId))) {
    await supabase.rpc('app_view_as_end');
    jar.delete({ name: VIEW_AS_COOKIE, path: VIEW_AS_COOKIE_ATTRS.path });
    return adminErr('view as unavailable');
  }
  return { ok: true };
}
