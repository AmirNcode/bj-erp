'use server';

import { requireCaller } from '@/lib/auth/context';
import { invalidateAppCache } from '@/lib/cache/invalidate-app';
import { dbErr, type DbErrorResult } from '@/lib/errors/db-error';
import { DEFAULT_AUTO_APPROVAL_MINUTES, MAX_AUTO_APPROVAL_MINUTES, type ApprovalWorkerHealth, type DelegateCandidate, type DelegationContext, type ExecutiveSettings } from '@/lib/leave/delegation';

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
    auto_approval_minutes: (context.executive_settings as { auto_approval_minutes?: unknown } | undefined)
      ?.auto_approval_minutes as number | undefined ?? DEFAULT_AUTO_APPROVAL_MINUTES,
  } };
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

/** Admin only (enforced in SQL). Existing timers keep the window they were enrolled with. */
export async function setAutoApprovalWindow(minutes: number): Promise<{ ok: true } | DbErrorResult> {
  const c = await requireCaller();
  if (!c.ok) return c;
  if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > MAX_AUTO_APPROVAL_MINUTES) {
    return dbErr('automatic approval window must be 1 to 1440 minutes');
  }
  const { error } = await c.supabase.rpc('app_set_auto_approval_window', { p_minutes: minutes });
  if (error) return dbErr(error.message);
  invalidateAppCache();
  return { ok: true };
}

/** Admin company totals or the designated CEO's own timers; authorization/scoping stays live in SQL. */
export async function getApprovalWorkerHealth(): Promise<
  { ok: true; health: ApprovalWorkerHealth } | DbErrorResult
> {
  const c = await requireCaller();
  if (!c.ok) return c;
  const { data, error } = await c.supabase.rpc('app_approval_worker_health');
  if (error) return dbErr(error.message);
  if (!data || typeof data !== 'object' || Array.isArray(data)
    || typeof data.overdue !== 'number' || !Number.isSafeInteger(data.overdue) || data.overdue < 0
    || typeof data.blocked !== 'number' || !Number.isSafeInteger(data.blocked) || data.blocked < 0) {
    return dbErr('approval worker health unavailable');
  }
  const job = data.job;
  const lastRun = data.last_run;
  if ((job !== null && (!job || typeof job !== 'object' || Array.isArray(job)
      || typeof job.active !== 'boolean'))
    || (lastRun !== null && (!lastRun || typeof lastRun !== 'object' || Array.isArray(lastRun)
      || (lastRun.finished_at !== null && (typeof lastRun.finished_at !== 'string'
        || !Number.isFinite(Date.parse(lastRun.finished_at))))))) {
    return dbErr('approval worker health unavailable');
  }
  return { ok: true, health: {
    job: job === null ? null : { active: job.active as boolean },
    overdue: data.overdue,
    blocked: data.blocked,
    last_run: lastRun === null ? null : { finished_at: lastRun.finished_at as string | null },
    observed_at: new Date().toISOString(),
  } };
}
