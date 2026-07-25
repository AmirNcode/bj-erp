'use server';

import { getCachedUser, getCachedRoles } from '@/lib/auth/context';
import { invalidateAppCache } from '@/lib/cache/invalidate-app';
import { dbErr } from '@/lib/errors/db-error';

/** Mirrors the DB check constraint departments_code_format. */
const DEPT_CODE_RE = /^[a-z0-9]{2,6}$/;

/**
 * Updates a department's latin code (the prefix of generated employee codes).
 * Admin-only; RLS enforces the write, this gives fast localized errors.
 * Existing employees keep their codes — the prefix applies to new accounts.
 */
export async function updateDepartmentCode(
  id: string,
  code: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { createClient } = await import('@/lib/supabase/server');
  const supabase = await createClient();
  const user = await getCachedUser();

  if (!user) return dbErr('not authenticated');
  const roles = await getCachedRoles(user.id);
  if (!roles.includes('admin')) return dbErr('admin role required');

  const normalized = code.trim().toLowerCase();
  if (!DEPT_CODE_RE.test(normalized)) return dbErr('invalid department code');

  const { data: before } = await supabase
    .from('departments')
    .select('code')
    .eq('id', id)
    .single();

  const { data, error } = await supabase
    .from('departments')
    .update({ code: normalized })
    .eq('id', id)
    .select('id');

  if (error) return dbErr(error.message);
  if (!data || data.length === 0) return dbErr('not allowed to update this department');

  await supabase.from('audit_log').insert({
    actor_id: user.id,
    entity: 'departments',
    entity_id: id,
    action: 'set_department_code',
    before: { code: before?.code ?? null },
    after: { code: normalized },
  });

  invalidateAppCache();
  return { ok: true };
}
