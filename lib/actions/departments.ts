'use server';

import type { Database } from '@/lib/supabase/types';
import { getCachedUser, getCachedRoles, getCachedProfile } from '@/lib/auth/context';
import { invalidateAppCache } from '@/lib/cache/invalidate-app';
import { dbErr } from '@/lib/errors/db-error';
import {
  generateDepartmentCode,
  isValidDepartmentCode,
  normalizeDepartmentCode,
} from '@/lib/departments/code';

type DepartmentKind = Database['public']['Enums']['department_kind'];

export type CreateDepartmentInput = {
  name_fa: string;
  name_en: string;
  kind?: DepartmentKind;
};

/**
 * How many codes to try before giving up. Only a genuine race (another admin
 * inserting the same generated code between our read and our insert) consumes
 * an attempt, and each retry adds the loser to the taken set, so a handful is
 * plenty — this bound exists to stop an unforeseen 23505 from looping.
 */
const CODE_ATTEMPTS = 5;

/**
 * Creates a department in the caller's company. Admin-only: RLS
 * (departments_insert_admin) is the enforcement layer, the role check here
 * exists to give a fast localized error instead of an empty-result insert.
 *
 * The caller does NOT supply a code. Since 20260730130002 the code prefixes
 * nothing (spec 2026-07-30 §6.1 / D12), so it is derived from the English name
 * here and the admin never sees it. Two admins creating departments at the
 * same moment can still collide on the (company_id, code) unique index, so a
 * 23505 is retried with the losing code marked taken rather than surfaced.
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

  const { data: existing, error: existingError } = await supabase
    .from('departments')
    .select('code')
    .eq('company_id', profile.company_id);
  if (existingError) return dbErr(existingError.message);

  const taken = new Set((existing ?? []).map((d) => d.code));

  for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
    const code = generateDepartmentCode(nameEn, taken);

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

    if (!error && data) {
      invalidateAppCache();
      return { ok: true, id: data.id };
    }
    if (error?.code === '23505') {
      taken.add(code);
      continue;
    }
    if (error) return dbErr(error.message);
    return dbErr('not allowed to create a department');
  }

  return dbErr('could not generate a unique department code');
}

/**
 * Updates a department's latin code.
 *
 * INTENTIONALLY UNREFERENCED since 2026-07-30. Department-code editing was
 * deactivated at the client's request (D7 in
 * docs/specs/2026-07-30-work-errand-and-login-codes-design.md); the UI that
 * called this is gone. It and the `departments_update_admin` RLS policy stay
 * in place so the feature can return without a migration — this is not dead
 * code to be deleted. Admin-only; RLS enforces the write, this gives fast
 * localized errors.
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

  const { data, error } = await supabase
    .from('departments')
    .update({ code: normalized })
    .eq('id', id)
    .select('id');

  if (error) return dbErr(error.message);
  if (!data || data.length === 0) return dbErr('not allowed to update this department');

  invalidateAppCache();
  return { ok: true };
}

export type DepartmentMember = {
  id: string;
  fullName: string;
  employeeCode: string;
};

export type DepartmentMembers = {
  managers: DepartmentMember[];
  workers: DepartmentMember[];
};

/** Farsi-aware name sort — the panel lists people, so collation matters. */
function byName(a: DepartmentMember, b: DepartmentMember): number {
  return a.fullName.localeCompare(b.fullName, 'fa');
}

/**
 * Who works in a department, split into Managers then Workers (D10).
 *
 * Admin-only, and deliberately built out of the *existing* `can_read_all`
 * SELECT paths on `profiles` and `user_roles` — no new RLS policy and no new
 * SECURITY DEFINER function were added for this panel.
 *
 * Managers = anyone in the department holding the `manager` role, plus the
 * department's own `manager_id` (who may sit in another department, e.g. an
 * office lead covering a production line). Workers = everyone else. Only
 * active profiles are listed.
 */
export async function getDepartmentMembers(
  departmentId: string
): Promise<{ ok: true; members: DepartmentMembers } | { ok: false; error: string }> {
  const { createClient } = await import('@/lib/supabase/server');
  const supabase = await createClient();
  const user = await getCachedUser();

  if (!user) return dbErr('not authenticated');
  const roles = await getCachedRoles(user.id);
  if (!roles.includes('admin')) return dbErr('admin role required');

  const { data: department, error: departmentError } = await supabase
    .from('departments')
    .select('id, manager_id')
    .eq('id', departmentId)
    .maybeSingle();
  if (departmentError) return dbErr(departmentError.message);
  if (!department) return dbErr('department not found');

  const { data: rows, error: rowsError } = await supabase
    .from('profiles')
    .select('id, full_name, employee_code')
    .eq('department_id', departmentId)
    .eq('active', true)
    .order('full_name');
  if (rowsError) return dbErr(rowsError.message);

  const people: DepartmentMember[] = (rows ?? []).map((row) => ({
    id: row.id,
    fullName: row.full_name,
    employeeCode: row.employee_code,
  }));

  // The department's own manager counts as a manager here even when their
  // profile lives in a different department — one extra read, only when needed.
  const leadId = department.manager_id;
  if (leadId && !people.some((p) => p.id === leadId)) {
    const { data: lead, error: leadError } = await supabase
      .from('profiles')
      .select('id, full_name, employee_code')
      .eq('id', leadId)
      .eq('active', true)
      .maybeSingle();
    if (leadError) return dbErr(leadError.message);
    if (lead) {
      people.push({ id: lead.id, fullName: lead.full_name, employeeCode: lead.employee_code });
    }
  }

  const managerIds = new Set<string>(leadId ? [leadId] : []);
  if (people.length > 0) {
    const { data: roleRows, error: roleError } = await supabase
      .from('user_roles')
      .select('user_id')
      .eq('role', 'manager')
      .in(
        'user_id',
        people.map((p) => p.id)
      );
    if (roleError) return dbErr(roleError.message);
    for (const row of roleRows ?? []) managerIds.add(row.user_id);
  }

  return {
    ok: true,
    members: {
      managers: people.filter((p) => managerIds.has(p.id)).sort(byName),
      workers: people.filter((p) => !managerIds.has(p.id)).sort(byName),
    },
  };
}
