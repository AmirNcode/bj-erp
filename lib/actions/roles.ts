'use server';

/**
 * Configurable roles (FR-55). Every write is one RPC from
 * 20261013200004_roles_rpcs.sql, which re-checks the caller (admin only) and
 * audits in the same transaction. The `toRoleRow` mapper lives in
 * `roles-helpers.ts` because a 'use server' file may export only async functions.
 */

import { requireCaller } from '@/lib/auth/context';
import { invalidateAppCache } from '@/lib/cache/invalidate-app';
import { dbErr, type DbErrorResult } from '@/lib/errors/db-error';
import type { Perms } from '@/lib/permissions/catalog';
import { toRoleRow, type RoleRow } from './roles-helpers';

export type { RoleRow } from './roles-helpers';

type Holder = { fullName: string; personnelNo: string };

/** Every role of the caller's company with its holder count. */
export async function listRoles(): Promise<{ ok: true; roles: RoleRow[] } | DbErrorResult> {
  const c = await requireCaller();
  if (!c.ok) return c;
  const { data, error } = await c.supabase.rpc('app_list_roles');
  if (error) return dbErr(error.message);
  return { ok: true, roles: (data ?? []).map(toRoleRow) };
}

/** Who holds a role (admin only; the delete dialog and the role card list them). */
export async function getRoleHolders(
  roleId: string
): Promise<{ ok: true; holders: Holder[] } | DbErrorResult> {
  const c = await requireCaller();
  if (!c.ok) return c;
  const { data, error } = await c.supabase.rpc('app_role_holders', { p_role_id: roleId });
  if (error) return dbErr(error.message);
  return {
    ok: true,
    holders: (data ?? []).map((h) => ({ fullName: h.full_name, personnelNo: h.personnel_no ?? '' })),
  };
}

/** Creates a custom role (`id` null) or rewrites an existing preset or custom one. */
export async function saveRole(input: {
  id: string | null;
  name: string;
  permissions: Perms;
}): Promise<{ ok: true; id: string } | DbErrorResult> {
  const c = await requireCaller();
  if (!c.ok) return c;
  const { data, error } = await c.supabase.rpc('app_save_role', {
    p_id: input.id,
    p_name: input.name.trim(),
    p_permissions: input.permissions,
  });
  if (error) return dbErr(error.message);
  invalidateAppCache();
  return { ok: true, id: data as string };
}

/** Deletes a custom role; the people who held it are returned so the UI can say who lost it. */
export async function deleteRole(
  roleId: string
): Promise<{ ok: true; removed: Holder[] } | DbErrorResult> {
  const c = await requireCaller();
  if (!c.ok) return c;
  const { data, error } = await c.supabase.rpc('app_delete_role', { p_id: roleId });
  if (error) return dbErr(error.message);
  invalidateAppCache();
  return {
    ok: true,
    removed: (data ?? []).map((h) => ({ fullName: h.full_name, personnelNo: h.personnel_no ?? '' })),
  };
}

export type TransferCandidate = { id: string; name: string; personnelNo: string | null };

/**
 * Who the admin can hand admin to: active people of the caller's company other
 * than the caller, ordered by personnel number. Admin only. The RPC re-checks
 * every condition; this only fills the Transfer admin person search.
 */
export async function listTransferCandidates(): Promise<
  { ok: true; people: TransferCandidate[] } | DbErrorResult
> {
  const c = await requireCaller({ anyOf: ['admin'], company: true });
  if (!c.ok) return c;
  const { data, error } = await c.supabase
    .from('profiles')
    .select('id, full_name, personnel_no, employee_code')
    .eq('company_id', c.companyId)
    .eq('active', true)
    .neq('id', c.user.id)
    .order('personnel_no', { ascending: true });
  if (error) return dbErr(error.message);
  // An account with no personnel number (the bootstrap admin) is confirmed by its
  // employee code, as app_transfer_admin accepts; show that code in its place.
  return {
    ok: true,
    people: (data ?? []).map((p) => ({
      id: p.id,
      name: p.full_name,
      personnelNo: p.personnel_no ?? p.employee_code,
    })),
  };
}

/**
 * Hands the admin role to another active employee. Needs the caller's own
 * password and the target's personnel number (their employee code when they have
 * none) as a typo guard. The caller stops
 * being admin, so their session is refreshed to drop the stale admin claims.
 */
export async function transferAdmin(input: {
  targetId: string;
  personnelNo: string;
  password: string;
}): Promise<{ ok: true } | DbErrorResult> {
  const c = await requireCaller();
  if (!c.ok) return c;
  const { error } = await c.supabase.rpc('app_transfer_admin', {
    p_target: input.targetId,
    p_personnel_no: input.personnelNo,
    p_password: input.password,
  });
  if (error) return dbErr(error.message);
  // The role change is committed; a failed refresh only leaves the old claims
  // until the next token refresh (<= 1 h), and RLS already enforces the new state.
  await c.supabase.auth.refreshSession();
  invalidateAppCache();
  return { ok: true };
}
