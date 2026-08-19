'use server';

import type { Database } from '@/lib/supabase/types';
import { allowedProfileFields, generateTempPassword } from './employees-helpers';
import { normalizePersonnelNo, isValidPersonnelNo } from '@/lib/employees/code';
import { getCachedUser, getCachedRoles, getCachedProfile } from '@/lib/auth/context';
import { invalidateAppCache } from '@/lib/cache/invalidate-app';
import { dbErr, type DbErrorResult } from '@/lib/errors/db-error';

// Re-export pure helpers so the unit test can import from this path
export { allowedProfileFields, generateTempPassword };

type AppRole = Database['public']['Enums']['app_role'];

// ---------------------------------------------------------------------------
// Internal: fetch caller's roles and company_id
// ---------------------------------------------------------------------------

async function getCallerContext() {
  const { createClient } = await import('@/lib/supabase/server');
  const supabase = await createClient();
  const user = await getCachedUser();

  if (!user) {
    return { supabase, user: null, roles: [] as AppRole[], companyId: null };
  }

  const [roles, profile] = await Promise.all([
    getCachedRoles(user.id),
    getCachedProfile(user.id),
  ]);

  return {
    supabase,
    user,
    roles: roles as AppRole[],
    companyId: profile?.company_id ?? null,
  };
}

// ---------------------------------------------------------------------------
// Server actions
// ---------------------------------------------------------------------------

export type CreateEmployeeInput = {
  personnel_no: string;
  full_name: string;
  job_title?: string;
  department_id?: string;
  manager_id?: string;
  roles?: AppRole[];
  hire_date?: string;
  language_pref?: string;
};

/**
 * Creates a new employee auth account + profile + roles in one RPC transaction.
 * The employee code is composed in-DB — since 20260730130002 it is the
 * personnel number alone, with no department prefix.
 * Admins create freely; managers are scoped in-DB to their own department and
 * team; hr may pick any department and manager but is likewise forced to the
 * employee role. Every one of those limits is enforced inside
 * app_create_employee — the check here only avoids a pointless round-trip.
 * Returns the temp password so the creator can hand it to the worker.
 * The temp password is never logged or stored — shown once in the UI.
 */
export async function createEmployee(
  input: CreateEmployeeInput
): Promise<{ ok: true; tempPassword: string; userId: string } | DbErrorResult> {
  const { supabase, user, roles, companyId } = await getCallerContext();

  if (!user) return dbErr('not authenticated');
  if (
    !roles.includes('admin') &&
    !roles.includes('manager') &&
    !roles.includes('hr')
  ) {
    return dbErr('admin or manager role required');
  }
  if (!companyId) return dbErr('no profile for caller');

  // Personnel number becomes part of the auth email — validate before the RPC.
  // (The SQL fn re-checks; this just gives a fast, localized error.)
  const personnelNo = normalizePersonnelNo(input.personnel_no);
  if (!isValidPersonnelNo(personnelNo)) return dbErr('invalid personnel number');

  const tempPassword = generateTempPassword();

  const { data: userId, error } = await supabase.rpc('app_create_employee', {
    p_personnel_no: personnelNo,
    p_full_name: input.full_name,
    p_password: tempPassword,
    p_company_id: companyId,
    ...(input.department_id ? { p_department_id: input.department_id } : {}),
    ...(input.manager_id ? { p_manager_id: input.manager_id } : {}),
    ...(input.roles?.length ? { p_roles: input.roles } : {}),
    ...(input.hire_date ? { p_hire_date: input.hire_date } : {}),
    ...(input.language_pref ? { p_language_pref: input.language_pref } : {}),
    ...(input.job_title ? { p_job_title: input.job_title } : {}),
  });

  if (error) {
    return dbErr(error.message);
  }

  invalidateAppCache();
  return { ok: true, tempPassword, userId: userId as string };
}

export type UpdateEmployeeFields = Partial<{
  full_name: string;
  department_id: string | null;
  manager_id: string | null;
  hire_date: string | null;
  active: boolean;
  language_pref: string;
}>;

/**
 * Updates allowed profile fields. Filters columns based on caller's role.
 * RLS restricts WHICH rows; this restricts WHICH columns.
 */
export async function updateEmployee(
  id: string,
  fields: UpdateEmployeeFields
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase, user, roles } = await getCallerContext();

  if (!user) return dbErr('not authenticated');
  const isAdmin = roles.includes('admin');
  const isManager = roles.includes('manager');
  if (!isAdmin && !isManager) return dbErr('admin or manager role required');

  const allowed = allowedProfileFields(isAdmin);
  const filtered = Object.fromEntries(
    Object.entries(fields).filter(([key]) => allowed.includes(key))
  ) as UpdateEmployeeFields;

  if (Object.keys(filtered).length === 0) {
    return dbErr('not permitted to update these fields');
  }

  const { data, error } = await supabase
    .from('profiles')
    .update(filtered)
    .eq('id', id)
    .select('id');

  if (error) return dbErr(error.message);
  if (!data || data.length === 0) return dbErr('not allowed to update this profile');

  invalidateAppCache();
  return { ok: true };
}

/**
 * Replaces the target user's roles entirely via the atomic
 * app_set_user_roles RPC (transactional delete+insert, admin-guarded in-DB,
 * refuses to strip your own admin role, writes its own audit row).
 */
export async function setRoles(
  id: string,
  roles: AppRole[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase, user, roles: callerRoles } = await getCallerContext();

  if (!user) return dbErr('not authenticated');
  if (!callerRoles.includes('admin')) return dbErr('admin role required');

  const { error } = await supabase.rpc('app_set_user_roles', {
    p_user_id: id,
    p_roles: roles,
  });
  if (error) return dbErr(error.message);

  invalidateAppCache();
  return { ok: true };
}

/**
 * Activates or deactivates an employee. Admin-only.
 */
export async function setActive(
  id: string,
  active: boolean
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase, user, roles } = await getCallerContext();

  if (!user) return dbErr('not authenticated');
  if (!roles.includes('admin')) return dbErr('admin role required');

  const { data, error } = await supabase
    .from('profiles')
    .update({ active })
    .eq('id', id)
    .select('id');

  if (error) return dbErr(error.message);
  if (!data || data.length !== 1) return dbErr('employee not found');

  invalidateAppCache();
  return { ok: true };
}

/**
 * Sets the team (department) for an employee. Admin-only.
 */
export async function setTeam(
  id: string,
  departmentId: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase, user, roles } = await getCallerContext();

  if (!user) return dbErr('not authenticated');
  if (!roles.includes('admin')) return dbErr('admin role required');

  const { data, error } = await supabase
    .from('profiles')
    .update({ department_id: departmentId })
    .eq('id', id)
    .select('id');

  if (error) return dbErr(error.message);
  if (!data || data.length !== 1) return dbErr('employee not found');

  invalidateAppCache();
  return { ok: true };
}

/**
 * Sets the manager for an employee. Admin-only.
 */
export async function setManager(
  id: string,
  managerId: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase, user, roles } = await getCallerContext();

  if (!user) return dbErr('not authenticated');
  if (!roles.includes('admin')) return dbErr('admin role required');
  if (managerId === id) return dbErr('an employee cannot be their own manager');

  const { data, error } = await supabase
    .from('profiles')
    .update({ manager_id: managerId })
    .eq('id', id)
    .select('id');

  if (error) return dbErr(error.message);
  if (!data || data.length !== 1) return dbErr('employee not found');

  invalidateAppCache();
  return { ok: true };
}

/**
 * Resets an employee's password and returns the new temp password.
 * Admin-only. The new password is shown once to the admin.
 */
export async function resetPassword(
  id: string
): Promise<{ ok: true; tempPassword: string } | { ok: false; error: string }> {
  const { supabase, user, roles } = await getCallerContext();

  if (!user) return dbErr('not authenticated');
  if (!roles.includes('admin')) return dbErr('admin role required');

  const tempPassword = generateTempPassword();

  const { error } = await supabase.rpc('app_set_employee_password', {
    p_user_id: id,
    p_password: tempPassword,
  });

  if (error) return dbErr(error.message);

  return { ok: true, tempPassword };
}

// ---------------------------------------------------------------------------
// Bulk import / credential regeneration (admin-only)
// ---------------------------------------------------------------------------

export type BulkImportRow = {
  full_name: string;
  personnel_no: string;
  hire_date: string | null;
  department_code: string;
  manager_personnel_no: string | null;
  role: 'manager' | 'employee';
  job_title: string | null;
  annual_days: number;
  sick_days: number;
};

export type IssuedCredential = {
  fullName: string;
  employeeCode: string;
  password: string;
};

/**
 * Imports employees from validated CSV rows in ONE transaction
 * (app_bulk_create_employees: the first bad row rolls everything back).
 * Generates a random password per row and returns the credentials once —
 * they are never logged or stored; passwords in the DB are bcrypt-hashed.
 */
export async function bulkCreateEmployees(
  rows: BulkImportRow[]
): Promise<{ ok: true; credentials: IssuedCredential[] } | { ok: false; error: string }> {
  const { supabase, user, roles, companyId } = await getCallerContext();

  if (!user) return dbErr('not authenticated');
  if (!roles.includes('admin')) return dbErr('admin role required');
  if (!companyId) return dbErr('no profile for caller');
  if (rows.length === 0) return dbErr('no rows to import');

  const withPasswords = rows.map((row) => ({ ...row, password: generateTempPassword() }));

  const { data, error } = await supabase.rpc('app_bulk_create_employees', {
    p_company_id: companyId,
    p_rows: withPasswords as unknown as import('@/lib/supabase/types').Json,
  });

  if (error) return dbErr(error.message);

  const created = (data ?? []) as { personnel_no: string; employee_code: string }[];
  const byPno = new Map(withPasswords.map((r) => [r.personnel_no, r]));
  const credentials: IssuedCredential[] = created.map((c) => ({
    fullName: byPno.get(c.personnel_no)?.full_name ?? c.personnel_no,
    employeeCode: c.employee_code,
    password: byPno.get(c.personnel_no)?.password ?? '',
  }));

  invalidateAppCache();
  return { ok: true, credentials };
}

/**
 * Regenerates passwords for the selected employees (recovery path when the
 * one-time credentials file is lost). Old passwords stop working immediately.
 * Refuses to include the caller — locking yourself out of the admin account
 * from a bulk action would be unrecoverable without DB access.
 */
export async function bulkResetPasswords(
  userIds: string[]
): Promise<{ ok: true; credentials: IssuedCredential[] } | { ok: false; error: string }> {
  const { supabase, user, roles } = await getCallerContext();

  if (!user) return dbErr('not authenticated');
  if (!roles.includes('admin')) return dbErr('admin role required');
  if (userIds.length === 0) return dbErr('no employees selected');
  const uniqueIds = [...new Set(userIds)];
  if (uniqueIds.length > 100) return dbErr('select between 1 and 100 employees');
  if (uniqueIds.includes(user.id)) return dbErr('cannot bulk-reset your own password');

  const { data: profiles, error: readError } = await supabase
    .from('profiles')
    .select('id, full_name, employee_code')
    .in('id', uniqueIds);
  if (readError) return dbErr(readError.message);
  if (!profiles || profiles.length !== uniqueIds.length) return dbErr('employee not found');

  const resets = profiles.map((profile) => ({
    profile,
    password: generateTempPassword(),
  }));
  const { error } = await supabase.rpc('app_bulk_set_employee_passwords', {
    p_resets: resets.map(({ profile, password }) => ({
      user_id: profile.id,
      password,
    })),
  });
  if (error) return dbErr(error.message);

  const credentials: IssuedCredential[] = resets.map(({ profile, password }) => ({
      fullName: profile.full_name,
      employeeCode: profile.employee_code,
      password,
    }));

  invalidateAppCache();
  return { ok: true, credentials };
}
