'use server';

import type { Database } from '@/lib/supabase/types';
import { getCachedUser, getCachedRoles, getCachedProfile } from '@/lib/auth/context';
import { invalidateAppCache } from '@/lib/cache/invalidate-app';
import { dbErr } from '@/lib/errors/db-error';
import { isValidDepartmentCode, normalizeDepartmentCode } from '@/lib/departments/code';

type DepartmentKind = Database['public']['Enums']['department_kind'];

export type CreateDepartmentInput = {
  name_fa: string;
  name_en: string;
  code: string;
  kind?: DepartmentKind;
};

/**
 * Creates a department in the caller's company. Admin-only: RLS
 * (departments_insert_admin) is the enforcement layer, the role check here
 * exists to give a fast localized error instead of an empty-result insert.
 *
 * The `code` becomes the latin prefix of every login code generated for this
 * department (prod → prod-1042), so it is normalized + validated here and
 * re-checked by the departments_code_format constraint and the
 * (company_id, code) unique index.
 */
export async function createDepartment(
  input: CreateDepartmentInput
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { createClient } = await import('@/lib/supabase/server');
  const supabase = await createClient();
  const user = await getCachedUser();

  if (!user) return dbErr('not authenticated');
  const [roles, profile] = await Promise.all([
    getCachedRoles(user.id),
    getCachedProfile(user.id),
  ]);
  if (!roles.includes('admin')) return dbErr('admin role required');
  if (!profile?.company_id) return dbErr('no profile for caller');

  const nameFa = input.name_fa.trim();
  const nameEn = input.name_en.trim();
  if (!nameFa || !nameEn) return dbErr('department name is required');

  const code = normalizeDepartmentCode(input.code);
  if (!isValidDepartmentCode(code)) return dbErr('invalid department code');

  const { data, error } = await supabase
    .from('departments')
    .insert({
      company_id: profile.company_id,
      name_fa: nameFa,
      name_en: nameEn,
      code,
      // Descriptive only — no app logic reads it. 'team' is the norm.
      kind: input.kind ?? 'team',
    })
    .select('id')
    .single();

  if (error) return dbErr(error.message);
  if (!data) return dbErr('not allowed to create a department');

  await supabase.from('audit_log').insert({
    actor_id: user.id,
    entity: 'departments',
    entity_id: data.id,
    action: 'create_department',
    after: { name_fa: nameFa, name_en: nameEn, code, kind: input.kind ?? 'team' },
  });

  invalidateAppCache();
  return { ok: true, id: data.id };
}

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

  const normalized = normalizeDepartmentCode(code);
  if (!isValidDepartmentCode(normalized)) return dbErr('invalid department code');

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
