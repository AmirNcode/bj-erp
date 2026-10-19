'use server';

import { requireCaller } from '@/lib/auth/context';
import { dbErr, type DbErrorResult } from '@/lib/errors/db-error';
import type { DelegationPreviewQuery, RequestDelegationPreview } from '@/lib/leave/delegation';

/** Exact absence bounds and narrow authority context; the server validates it again at submit. */
export async function getRequestDelegationPreview(input: DelegationPreviewQuery): Promise<
  { ok: true; preview: RequestDelegationPreview } | DbErrorResult
> {
  const c = await requireCaller();
  if (!c.ok) return c;
  const { data, error } = await c.supabase.rpc('app_request_delegation_preview', {
    p_start: input.start,
    p_end: input.end,
    p_unit: input.unit ?? 'day',
    p_day_part: input.dayPart ?? 'full',
    p_start_time: input.startTime ?? undefined,
    p_end_time: input.endTime ?? undefined,
    p_replacement_id: input.replacementId ?? undefined,
  });
  if (error) return dbErr(error.message);
  if (!data || typeof data !== 'object' || Array.isArray(data)
    || typeof data.can_approve !== 'boolean' || typeof data.can_delegate !== 'boolean'
    || typeof data.auto_approval_eligible !== 'boolean' || typeof data.temporary_eligible !== 'boolean'
    || typeof data.is_ceo !== 'boolean' || typeof data.preview_token !== 'string' || !data.preview_token) {
    return dbErr('delegation preview refresh required');
  }
  const bounds = data.bounds;
  if (!bounds || typeof bounds !== 'object' || Array.isArray(bounds)
    || typeof bounds.starts_at !== 'string' || typeof bounds.ends_at !== 'string'
    || !Number.isFinite(Date.parse(bounds.starts_at)) || !Number.isFinite(Date.parse(bounds.ends_at))
    || Date.parse(bounds.ends_at) <= Date.parse(bounds.starts_at)
    || (data.auto_approval_eligible && typeof data.authority_id !== 'string')
    || (data.temporary_eligible && typeof data.temporary_delegate_name !== 'string')) {
    return dbErr('delegation preview refresh required');
  }
  return { ok: true, preview: data as unknown as RequestDelegationPreview };
}
