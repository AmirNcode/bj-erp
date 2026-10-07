'use server';

import type { Database } from '@/lib/supabase/types';
import { allowedProfileFields, generateTempPassword } from './employees-helpers';
import { normalizePersonnelNo, isValidPersonnelNo } from '@/lib/employees/code';
import { requireCaller } from '@/lib/auth/context';
import { invalidateAppCache } from '@/lib/cache/invalidate-app';
import { dbErr, type DbErrorResult } from '@/lib/errors/db-error';

type AppRole = Database['public']['Enums']['app_role'];

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
  const c = await requireCaller({ anyOf: ['admin', 'manager', 'hr'], company: true });
  if (!c.ok) return c;

  // Personnel number becomes part of the auth email — validate before the RPC.
  // (The SQL fn re-checks; this just gives a fast, localized error.)
  const personnelNo = normalizePersonnelNo(input.personnel_no);
  if (!isValidPersonnelNo(personnelNo)) return dbErr('invalid personnel number');

  const tempPassword = generateTempPassword();

  const { data: userId, error } = await c.supabase.rpc('app_create_employee', {
    p_personnel_no: personnelNo,
    p_full_name: input.full_name,
    p_password: tempPassword,
    p_company_id: c.companyId,
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
  job_title: string | null;
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
  const c = await requireCaller({ anyOf: ['admin', 'manager', 'hr'] });
  if (!c.ok) return c;

  const allowed = allowedProfileFields(c.roles);
  const filtered = Object.fromEntries(
    Object.entries(fields).filter(([key]) => allowed.includes(key))
  ) as UpdateEmployeeFields;

  if (Object.keys(filtered).length === 0) {
    return dbErr('not permitted to update these fields');
  }

  const { data, error } = await c.supabase
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
 * app_set_user_roles RPC (transactional delete+insert, guarded in-DB,
 * refuses to strip your own admin role, writes its own audit row). An hr
 * caller may only add or remove `manager`, on a non-admin other than
 * themselves (FR-51) — the RPC refuses anything else.
 */
export async function setRoles(
  id: string,
  roles: AppRole[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  const c = await requireCaller({ anyOf: ['admin', 'hr'] });
  if (!c.ok) return c;

  const { error } = await c.supabase.rpc('app_set_user_roles', {
    p_user_id: id,
    p_roles: roles,
  });
  if (error) return dbErr(error.message);

  invalidateAppCache();
  return { ok: true };
}

/**
 * Activates or deactivates an employee. Admin, or hr on a non-admin other than
 * themselves (FR-51; the profile guard trigger enforces the target rule).
 */
export async function setActive(
  id: string,
  active: boolean
): Promise<{ ok: true } | { ok: false; error: string }> {
  const c = await requireCaller({ anyOf: ['admin', 'hr'] });
  if (!c.ok) return c;

  const { data, error } = await c.supabase
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
 * Resets an employee's password and returns the new temp password.
 * Admin-only. The new password is shown once to the admin.
 */
export async function resetPassword(
  id: string
): Promise<{ ok: true; tempPassword: string } | { ok: false; error: string }> {
  const c = await requireCaller({ anyOf: ['admin'] });
  if (!c.ok) return c;

  const tempPassword = generateTempPassword();

  const { error } = await c.supabase.rpc('app_set_employee_password', {
    p_user_id: id,
    p_password: tempPassword,
  });

  if (error) return dbErr(error.message);

  return { ok: true, tempPassword };
}

// ---------------------------------------------------------------------------
// Bulk import / credential regeneration (admin-only)
// ---------------------------------------------------------------------------

/** One validated CSV row (lib/csv/import-rows.ts ImportRow, FR-45). */
export type BulkImportRow = {
  full_name: string;
  personnel_no: string;
  job_title: string | null;
  role: 'manager' | 'employee';
  department_code: string;
  supervisor_personnel_no: string | null;
  manager_personnel_no: string | null;
  hire_date: string | null;
  /** Signed remaining annual leave in minutes (FR-48: may be negative). */
  balance_minutes: number;
};

/** A department the rows use: created when `create`, renamed when `rename`, manager set when given. */
export type BulkImportDepartment = {
  code: string;
  name_fa: string;
  name_en: string;
  create: boolean;
  rename?: boolean;
  manager_personnel_no: string | null;
};

export type IssuedCredential = {
  fullName: string;
  employeeCode: string;
  password: string;
};

export type ImportEmployeesInput = {
  mode: 'add' | 'update' | 'replace';
  /** Manager-first (validateImportRows sorts them). */
  rows: (BulkImportRow & { existing?: boolean })[];
  departments: BulkImportDepartment[];
  /** Gregorian ISO date the balances were counted to. */
  balanceAsOf: string;
  overwriteBalances: boolean;
  /** `replace` only — from lib/csv/import-plan.ts. */
  deactivate: string[];
  reassign: { id: string; managerPersonnelNo: string | null }[];
  deleteDepartments: string[];
};

export type ImportEmployeesResult = {
  credentials: IssuedCredential[];
  updated: number;
  deactivated: number;
  deletedDepartments: string[];
  notDeletedDepartments: string[];
};

/**
 * Runs a bulk import plan (FR-45/FR-49) in ONE transaction
 * (app_bulk_import_employees: the first failure rolls everything back).
 * `update` and `replace` are admin-only in SQL too. A random password is
 * generated for each NEW employee and returned once — never logged or stored;
 * passwords in the DB are bcrypt-hashed. Updated employees keep theirs.
 */
export async function importEmployees(
  input: ImportEmployeesInput
): Promise<({ ok: true } & ImportEmployeesResult) | { ok: false; error: string }> {
  const c = await requireCaller({ anyOf: ['admin'], company: true });
  if (!c.ok) return c;
  if (input.rows.length === 0) return dbErr('no rows to import');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.balanceAsOf)) return dbErr('balance date is required');

  // Only the fields the RPC reads — the wizard's rows carry UI-only extras.
  const rows = input.rows.map((row) => ({
    full_name: row.full_name,
    personnel_no: row.personnel_no,
    job_title: row.job_title,
    role: row.role,
    department_code: row.department_code,
    supervisor_personnel_no: row.supervisor_personnel_no,
    manager_personnel_no: row.manager_personnel_no,
    hire_date: row.hire_date,
    balance_minutes: row.balance_minutes,
    ...(row.existing ? {} : { password: generateTempPassword() }),
  }));
  const departments = input.departments.map((d) => ({
    code: d.code,
    name_fa: d.name_fa,
    name_en: d.name_en,
    create: d.create,
    rename: d.rename ?? false,
    manager_personnel_no: d.manager_personnel_no,
  }));
  type Json = import('@/lib/supabase/types').Json;

  const { data, error } = await c.supabase.rpc('app_bulk_import_employees', {
    p_company_id: c.companyId,
    p_mode: input.mode,
    p_rows: rows as unknown as Json,
    p_departments: departments as unknown as Json,
    p_balance_as_of: input.balanceAsOf,
    p_overwrite_balances: input.overwriteBalances,
    p_deactivate: input.deactivate,
    p_reassign: input.reassign.map((r) => ({ id: r.id, manager_personnel_no: r.managerPersonnelNo })) as unknown as Json,
    p_delete_departments: input.deleteDepartments,
  });
  if (error) return dbErr(error.message);

  const out = (data ?? {}) as {
    created?: { personnel_no: string; employee_code: string }[];
    updated?: number;
    deactivated?: number;
    deleted_departments?: string[];
    not_deleted_departments?: string[];
  };
  const byPno = new Map(rows.map((r) => [r.personnel_no, r]));
  const credentials: IssuedCredential[] = (out.created ?? []).map((cr) => ({
    fullName: byPno.get(cr.personnel_no)?.full_name ?? cr.personnel_no,
    employeeCode: cr.employee_code,
    password: (byPno.get(cr.personnel_no) as { password?: string } | undefined)?.password ?? '',
  }));

  invalidateAppCache();
  return {
    ok: true,
    credentials,
    updated: out.updated ?? 0,
    deactivated: out.deactivated ?? 0,
    deletedDepartments: out.deleted_departments ?? [],
    notDeletedDepartments: out.not_deleted_departments ?? [],
  };
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
  const c = await requireCaller({ anyOf: ['admin'] });
  if (!c.ok) return c;
  if (userIds.length === 0) return dbErr('no employees selected');
  const uniqueIds = [...new Set(userIds)];
  if (uniqueIds.length > 100) return dbErr('select between 1 and 100 employees');
  if (uniqueIds.includes(c.user.id)) return dbErr('cannot bulk-reset your own password');

  const { data: profiles, error: readError } = await c.supabase
    .from('profiles')
    .select('id, full_name, employee_code')
    .in('id', uniqueIds);
  if (readError) return dbErr(readError.message);
  if (!profiles || profiles.length !== uniqueIds.length) return dbErr('employee not found');

  const resets = profiles.map((profile) => ({
    profile,
    password: generateTempPassword(),
  }));
  const { error } = await c.supabase.rpc('app_bulk_set_employee_passwords', {
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
