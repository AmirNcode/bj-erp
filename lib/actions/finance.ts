'use server';

/**
 * Completed approvals for finance (FR-62) — finance read (FR-55).
 *
 * Finance accounts for per diem and other costs once a request is fully
 * approved. Reads go through `public.finance_approved_requests`, a guarded
 * SECURITY DEFINER function (`finance.view` → finance read): finance has no RLS read on
 * `leave_requests`, and the function returns approved rows only, without
 * signatures or the private reason. FR-70: a travel-booked trip appears once
 * procurement has booked it (with ticket and hotel cost); a cancelled one once
 * procurement has recorded the amount lost (`status` = cancelled).
 */

import { requireCaller } from '@/lib/auth/context';
import { dbErr, type DbErrorResult } from '@/lib/errors/db-error';
import { isValidIsoDate } from '@/lib/leave/settings-validation';
import type { Database } from '@/lib/supabase/types';

export type FinanceRow =
  Database['public']['Functions']['finance_approved_requests']['Returns'][number];

export async function getFinanceApprovals(
  from: string,
  to: string
): Promise<{ ok: true; rows: FinanceRow[] } | DbErrorResult> {
  const c = await requireCaller({ perm: ['finance', 'read'] });
  if (!c.ok) return c;
  if (!isValidIsoDate(from) || !isValidIsoDate(to) || to < from) return dbErr('invalid date range');

  const { data, error } = await c.supabase.rpc('finance_approved_requests', {
    p_from: from,
    p_to: to,
  });
  if (error) return dbErr(error.message);
  return { ok: true, rows: data ?? [] };
}
