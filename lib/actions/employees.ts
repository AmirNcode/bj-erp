'use server';

import type { Database } from '@/lib/supabase/types';
import { allowedProfileFields, generateTempPassword } from './employees-helpers';

// Re-export pure helpers so the unit test can import from this path
export { allowedProfileFields, generateTempPassword };

type AppRole = Database['public']['Enums']['app_role'];

// ---------------------------------------------------------------------------
// Internal: fetch caller's roles and company_id
// ---------------------------------------------------------------------------

async function getCallerContext() {
  const { createClient } = await import('@/lib/supabase/server');
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { supabase, user: null, roles: [] as AppRole[], companyId: null };
  }

  const [{ data: rolesData }, { data: profile }] = await Promise.all([
    supabase.from('user_roles').select('role').eq('user_id', user.id),
    supabase.from('profiles').select('company_id').eq('id', user.id).single(),
  ]);

  const roles = (rolesData ?? []).map((r) => r.role as AppRole);
  return {
    supabase,
    user,
    roles,
    companyId: profile?.company_id ?? null,
  };
}

// ---------------------------------------------------------------------------
// Server actions
// ---------------------------------------------------------------------------

export type CreateEmployeeInput = {
  employee_code: string;
  full_name: string;
  department_id?: string;
  manager_id?: string;
  roles?: AppRole[];
  hire_date?: string;
  language_pref?: string;
  calendar_pref?: string;
};

/**
 * Creates a new employee auth account + profile + roles in one RPC transaction.
 * Returns the temp password so the admin can hand it to the worker.
 * The temp password is never logged or stored — shown once in the UI.
 */
export async function createEmployee(
  input: CreateEmployeeInput
): Promise<{ ok: true; tempPassword: string; userId: string } | { ok: false; error: string }> {
  const { supabase, user, roles, companyId } = await getCallerContext();

  if (!user) return { ok: false, error: 'Not authenticated' };
  if (!roles.includes('admin')) return { ok: false, error: 'Admin role required' };
  if (!companyId) return { ok: false, error: 'Could not determine your company' };

  const tempPassword = generateTempPassword();

  const { data: userId, error } = await supabase.rpc('app_create_employee', {
    p_employee_code: input.employee_code,
    p_full_name: input.full_name,
    p_password: tempPassword,
    p_company_id: companyId,
    ...(input.department_id ? { p_department_id: input.department_id } : {}),
    ...(input.manager_id ? { p_manager_id: input.manager_id } : {}),
    ...(input.roles?.length ? { p_roles: input.roles } : {}),
    ...(input.hire_date ? { p_hire_date: input.hire_date } : {}),
    ...(input.language_pref ? { p_language_pref: input.language_pref } : {}),
    ...(input.calendar_pref ? { p_calendar_pref: input.calendar_pref } : {}),
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  // Audit log
  await supabase.from('audit_log').insert({
    actor_id: user.id,
    entity: 'profiles',
    entity_id: userId,
    action: 'create_employee',
    after: { employee_code: input.employee_code, full_name: input.full_name } as import('@/lib/supabase/types').Json,
  });

  return { ok: true, tempPassword, userId: userId as string };
}

export type UpdateEmployeeFields = Partial<{
  full_name: string;
  department_id: string | null;
  manager_id: string | null;
  hire_date: string | null;
  active: boolean;
  language_pref: string;
  calendar_pref: string;
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

  if (!user) return { ok: false, error: 'Not authenticated' };
  const isAdmin = roles.includes('admin');
  const isManager = roles.includes('manager');
  if (!isAdmin && !isManager) return { ok: false, error: 'Admin or manager role required' };

  const allowed = allowedProfileFields(isAdmin);
  const filtered = Object.fromEntries(
    Object.entries(fields).filter(([key]) => allowed.includes(key))
  ) as UpdateEmployeeFields;

  if (Object.keys(filtered).length === 0) {
    return { ok: false, error: 'No allowed fields to update' };
  }

  // Fetch current value for audit
  const { data: before } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', id)
    .single();

  const { error } = await supabase
    .from('profiles')
    .update(filtered)
    .eq('id', id);

  if (error) return { ok: false, error: error.message };

  await supabase.from('audit_log').insert({
    actor_id: user.id,
    entity: 'profiles',
    entity_id: id,
    action: 'update_employee',
    before: before as import('@/lib/supabase/types').Json,
    after: filtered as import('@/lib/supabase/types').Json,
  });

  return { ok: true };
}

/**
 * Replaces the target user's roles entirely (delete removed, insert added).
 * Admin-only.
 */
export async function setRoles(
  id: string,
  roles: AppRole[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase, user, roles: callerRoles } = await getCallerContext();

  if (!user) return { ok: false, error: 'Not authenticated' };
  if (!callerRoles.includes('admin')) return { ok: false, error: 'Admin role required' };

  // Fetch existing for audit
  const { data: before } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', id);

  // Delete all existing roles
  const { error: deleteError } = await supabase
    .from('user_roles')
    .delete()
    .eq('user_id', id);

  if (deleteError) return { ok: false, error: deleteError.message };

  // Insert new roles
  if (roles.length > 0) {
    const { error: insertError } = await supabase.from('user_roles').insert(
      roles.map((role) => ({ user_id: id, role }))
    );
    if (insertError) return { ok: false, error: insertError.message };
  }

  await supabase.from('audit_log').insert({
    actor_id: user.id,
    entity: 'user_roles',
    entity_id: id,
    action: 'set_roles',
    before: { roles: (before ?? []).map((r) => r.role) } as import('@/lib/supabase/types').Json,
    after: { roles } as import('@/lib/supabase/types').Json,
  });

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

  if (!user) return { ok: false, error: 'Not authenticated' };
  if (!roles.includes('admin')) return { ok: false, error: 'Admin role required' };

  const { error } = await supabase
    .from('profiles')
    .update({ active })
    .eq('id', id);

  if (error) return { ok: false, error: error.message };

  await supabase.from('audit_log').insert({
    actor_id: user.id,
    entity: 'profiles',
    entity_id: id,
    action: active ? 'activate_employee' : 'deactivate_employee',
    after: { active } as import('@/lib/supabase/types').Json,
  });

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

  if (!user) return { ok: false, error: 'Not authenticated' };
  if (!roles.includes('admin')) return { ok: false, error: 'Admin role required' };

  const tempPassword = generateTempPassword();

  const { error } = await supabase.rpc('app_set_employee_password', {
    p_user_id: id,
    p_password: tempPassword,
  });

  if (error) return { ok: false, error: error.message };

  await supabase.from('audit_log').insert({
    actor_id: user.id,
    entity: 'profiles',
    entity_id: id,
    action: 'reset_password',
    after: {} as import('@/lib/supabase/types').Json,
  });

  return { ok: true, tempPassword };
}
