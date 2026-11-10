'use server';

/**
 * FR-88: the replacement (جانشین) signs or declines a request in the app, and the requester
 * answers a decline. The database enforces who may do what (see
 * `lib/leave/replacementSignoff.ts` for the state model); these actions only validate and
 * localize.
 */

import { requireCaller } from '@/lib/auth/context';
import { dbErr, type DbErrorResult } from '@/lib/errors/db-error';
import { invalidateAppCache } from '@/lib/cache/invalidate-app';
import type { Database } from '@/lib/supabase/types';
import { signatureProblem } from '@/lib/leave/signature';
import { replacementNoteProblem } from '@/lib/leave/replacementSignoff';

export type ReplacementRequest =
  Database['public']['Functions']['my_replacement_requests']['Returns'][number];

/** Requests that name the caller as replacement (explicit columns: no reason, no balances). */
export async function getMyReplacementRequests(): Promise<
  { ok: true; requests: ReplacementRequest[] } | DbErrorResult
> {
  const c = await requireCaller();
  if (!c.ok) return c;
  const { data, error } = await c.supabase.rpc('my_replacement_requests');
  if (error) return dbErr(error.message);
  return { ok: true, requests: data ?? [] };
}

export async function signAsReplacement(
  requestId: string,
  input: { signatureData: string; signatureAuthorized: boolean }
): Promise<{ ok: true } | DbErrorResult> {
  const c = await requireCaller();
  if (!c.ok) return c;
  const bad = signatureProblem(input);
  if (bad) return dbErr(bad);
  const { error } = await c.supabase.rpc('app_replacement_sign', {
    p_request: requestId,
    p_signature_data: input.signatureData,
    p_signature_authorized: input.signatureAuthorized,
  });
  if (error) return dbErr(error.message);
  invalidateAppCache();
  return { ok: true };
}

export async function declineAsReplacement(
  requestId: string,
  note: string
): Promise<{ ok: true } | DbErrorResult> {
  const c = await requireCaller();
  if (!c.ok) return c;
  const bad = replacementNoteProblem(note);
  if (bad) return dbErr(bad);
  const { error } = await c.supabase.rpc('app_replacement_decline', {
    p_request: requestId,
    p_note: note.trim() || null,
  });
  if (error) return dbErr(error.message);
  invalidateAppCache();
  return { ok: true };
}

/** After a decline: name someone else, or `null` for "no replacement". */
export async function changeReplacement(
  requestId: string,
  replacementId: string | null
): Promise<{ ok: true } | DbErrorResult> {
  const c = await requireCaller();
  if (!c.ok) return c;
  const { error } = await c.supabase.rpc('app_change_replacement', {
    p_request: requestId,
    p_replacement_id: replacementId,
  });
  if (error) return dbErr(error.message);
  invalidateAppCache();
  return { ok: true };
}
