'use server';

/**
 * Saved signature (FR-52). Owner-only: RLS on user_signatures admits nobody
 * else, not even admin. Requests and approvals keep their own copy of the PNG
 * (sent through the existing signed RPCs), so replacing or deleting the saved
 * one never changes past evidence.
 */

import { requireCaller } from '@/lib/auth/context';
import { dbErr } from '@/lib/errors/db-error';
import { isValidSignatureData } from '@/lib/leave/signature';

export type SavedSignature = { signatureData: string; source: 'drawn' | 'upload'; updatedAt: string };

export async function getMySavedSignature(): Promise<
  { ok: true; signature: SavedSignature | null } | { ok: false; error: string }
> {
  const c = await requireCaller();
  if (!c.ok) return c;

  const { data, error } = await c.supabase
    .from('user_signatures')
    .select('signature_data, source, updated_at')
    .eq('user_id', c.user.id)
    .maybeSingle();
  if (error) return dbErr(error.message);
  if (!data || !isValidSignatureData(data.signature_data)) return { ok: true, signature: null };
  return {
    ok: true,
    signature: {
      signatureData: data.signature_data,
      source: data.source === 'upload' ? 'upload' : 'drawn',
      updatedAt: data.updated_at,
    },
  };
}

export async function saveMySignature(input: {
  signatureData: string;
  source: 'drawn' | 'upload';
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const c = await requireCaller();
  if (!c.ok) return c;
  if (!isValidSignatureData(input.signatureData)) return dbErr('signature image is invalid');
  if (input.source !== 'drawn' && input.source !== 'upload') return dbErr('signature image is invalid');

  const { error } = await c.supabase
    .from('user_signatures')
    .upsert(
      { user_id: c.user.id, signature_data: input.signatureData, source: input.source },
      { onConflict: 'user_id' }
    );
  if (error) return dbErr(error.message);
  return { ok: true };
}

export async function deleteMySignature(): Promise<{ ok: true } | { ok: false; error: string }> {
  const c = await requireCaller();
  if (!c.ok) return c;

  const { error } = await c.supabase.from('user_signatures').delete().eq('user_id', c.user.id);
  if (error) return dbErr(error.message);
  return { ok: true };
}
