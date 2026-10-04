'use server';

/**
 * Requester and approver signatures. The images are private base-row data, so
 * they are fetched only on demand, never with a list.
 */

import { requireCaller } from '@/lib/auth/context';
import { dbErr } from '@/lib/errors/db-error';
import { isValidSignatureData } from '@/lib/leave/signature';

export async function getRequestSignature(requestId: string): Promise<
  | { ok: true; signatureData: string; consentAt: string }
  | { ok: false; error: string }
> {
  const c = await requireCaller();
  if (!c.ok) return c;

  const { data, error } = await c.supabase
    .from('leave_requests')
    .select('signature_data, signature_consent_at')
    .eq('id', requestId)
    .maybeSingle();

  if (error) return dbErr(error.message);
  if (
    !data?.signature_consent_at ||
    !isValidSignatureData(data.signature_data)
  ) {
    return dbErr('request signature not found');
  }

  return {
    ok: true,
    signatureData: data.signature_data,
    consentAt: data.signature_consent_at,
  };
}

/** Private approver evidence, with the same base-row RLS boundary as the request signature. */
export async function getApproverSignature(requestId: string): Promise<
  | { ok: true; signatureData: string; consentAt: string }
  | { ok: false; error: string }
> {
  const c = await requireCaller();
  if (!c.ok) return c;

  const { data, error } = await c.supabase
    .from('leave_requests')
    .select('approver_signature_data, approver_signature_consent_at')
    .eq('id', requestId)
    .maybeSingle();

  if (error) return dbErr(error.message);
  if (
    !data?.approver_signature_consent_at ||
    !isValidSignatureData(data.approver_signature_data)
  ) {
    return dbErr('request signature not found');
  }

  return {
    ok: true,
    signatureData: data.approver_signature_data,
    consentAt: data.approver_signature_consent_at,
  };
}

export type VisibleSignatureConsent = {
  requestId: string;
  requesterConsentAt: string | null;
  approverConsentAt: string | null;
};

/**
 * Tiny calendar metadata query. RLS returns direct reports for managers and all
 * rows for security/admin; the PNG itself remains lazy and is never serialized
 * with the calendar page.
 */
export async function getVisibleSignatureConsents(
  rangeStart: string,
  rangeEnd: string
): Promise<
  | { ok: true; signatures: VisibleSignatureConsent[] }
  | { ok: false; error: string }
> {
  const c = await requireCaller();
  if (!c.ok) return c;
  if (!c.roles.some((role) => ['admin', 'manager', 'security'].includes(role))) {
    return { ok: true, signatures: [] };
  }

  const { data, error } = await c.supabase
    .from('leave_requests')
    .select('id, signature_consent_at, approver_signature_consent_at')
    .lte('start_date', rangeEnd)
    .gte('end_date', rangeStart)
    .in('status', ['pending', 'approved'])
    .not('signature_consent_at', 'is', null);

  if (error) return dbErr(error.message);

  return {
    ok: true,
    signatures: (data ?? []).map((row) => ({
      requestId: row.id,
      requesterConsentAt: row.signature_consent_at,
      approverConsentAt: row.approver_signature_consent_at,
    })),
  };
}
