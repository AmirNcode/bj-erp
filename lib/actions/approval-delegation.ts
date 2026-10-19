'use server';

import { requireCaller } from '@/lib/auth/context';
import { invalidateAppCache } from '@/lib/cache/invalidate-app';
import { dbErr, type DbErrorResult } from '@/lib/errors/db-error';
import type { DelegateCandidate, DelegationContext, ExecutiveSettings } from '@/lib/leave/delegation';

/** RPC scopes ownership and returns only names required by the delegation panel. */
export async function getDelegationContext(principalId?: string): Promise<
  { ok: true; context: DelegationContext } | DbErrorResult
> {
  const c = await requireCaller();
  if (!c.ok) return c;
  const { data, error } = await c.supabase.rpc('app_delegation_context', { p_principal_id: principalId });
  if (error) return dbErr(error.message);
  if (!data) return dbErr('not allowed');
  const context = data as unknown as DelegationContext;
  return { ok: true, context: {
    ...context,
    executive_settings: {
      ceo_id: context.executive_settings?.ceo_id ?? null,
      hr_head_id: context.executive_settings?.hr_head_id ?? null,
      hr_step_ids: context.executive_settings?.hr_step_ids ?? [],
    },
  } };
}

/** The caller is the designated Head of HR (their own errand form then asks for per diem). */
export async function isCallerHrHead(): Promise<boolean> {
  const result = await getDelegationContext();
  return result.ok && result.context.executive_settings.hr_head_id === result.context.principal_id;
}

export async function searchDelegates(principalId: string, search = ''): Promise<
  { ok: true; candidates: DelegateCandidate[] } | DbErrorResult
> {
  const c = await requireCaller();
  if (!c.ok) return c;
  const { data, error } = await c.supabase.rpc('app_search_delegates', {
    p_principal_id: principalId, p_search: search.trim().slice(0, 100),
  });
  if (error) return dbErr(error.message);
  return { ok: true, candidates: data ?? [] };
}

export async function setApprovalDelegate(input: {
  principalId: string; delegateId: string | null; ceoAuthorized: boolean;
}): Promise<{ ok: true } | DbErrorResult> {
  const c = await requireCaller();
  if (!c.ok) return c;
  const { error } = await c.supabase.rpc('app_set_approval_delegate', {
    p_principal_id: input.principalId, p_delegate_id: input.delegateId,
    p_ceo_authorized: input.ceoAuthorized,
  });
  if (error) return dbErr(error.message);
  invalidateAppCache();
  return { ok: true };
}

export async function setExecutiveSettings(input: ExecutiveSettings): Promise<{ ok: true } | DbErrorResult> {
  const c = await requireCaller();
  if (!c.ok) return c;
  const { error } = await c.supabase.rpc('app_set_executive_settings', {
    p_ceo_id: input.ceo_id, p_hr_head_id: input.hr_head_id, p_hr_step_ids: input.hr_step_ids,
  });
  if (error) return dbErr(error.message);
  invalidateAppCache();
  return { ok: true };
}
