'use server';

/**
 * «مرخصی خارج از لیست» (FR-65): 3 extra days of annual leave for a first
 * marriage (once) or a close relative's death (each). Granted and revoked only
 * through the guarded RPCs, which post the ledger rows and enforce the rules
 * (hr or admin; not on oneself; hr never on an admin; marriage only while
 * single). The grants table is readable by the employee and by grant holders.
 */

import { requireCaller } from '@/lib/auth/context';
import { dbErr } from '@/lib/errors/db-error';
import { invalidateAppCache } from '@/lib/cache/invalidate-app';

export type SpecialLeaveKind = 'marriage' | 'bereavement';
export type SpecialLeaveGrant = { id: string; kind: SpecialLeaveKind; grantedAt: string; minutes: number };

export async function getSpecialLeaveGrants(
  employeeId: string
): Promise<{ ok: true; grants: SpecialLeaveGrant[] } | { ok: false; error: string }> {
  const c = await requireCaller();
  if (!c.ok) return c;
  const { data, error } = await c.supabase
    .from('special_leave_grants')
    .select('id, kind, granted_at, minutes')
    .eq('employee_id', employeeId)
    .is('revoked_at', null)
    .order('granted_at');
  if (error) return dbErr(error.message);
  return {
    ok: true,
    grants: (data ?? []).map((g) => ({
      id: g.id,
      kind: g.kind as SpecialLeaveKind,
      grantedAt: g.granted_at,
      minutes: g.minutes,
    })),
  };
}

export async function grantSpecialLeave(
  employeeId: string,
  kind: SpecialLeaveKind
): Promise<{ ok: true } | { ok: false; error: string }> {
  const c = await requireCaller({ anyOf: ['admin', 'hr'] });
  if (!c.ok) return c;
  const { error } = await c.supabase.rpc('app_grant_special_leave', {
    p_employee_id: employeeId,
    p_kind: kind,
  });
  if (error) return dbErr(error.message);
  invalidateAppCache();
  return { ok: true };
}

export async function revokeSpecialLeave(grantId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const c = await requireCaller({ anyOf: ['admin', 'hr'] });
  if (!c.ok) return c;
  const { error } = await c.supabase.rpc('app_revoke_special_leave', { p_grant_id: grantId });
  if (error) return dbErr(error.message);
  invalidateAppCache();
  return { ok: true };
}
