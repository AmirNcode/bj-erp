'use server';

/**
 * FR-91: edit an approved request (daily or hourly leave, daily trip, hourly errand).
 * `app_edit_request` checks the per-type permissions, the limits of a new request and the
 * signature; the signed original stays on record in `request_corrections`.
 */

import { requireCaller } from '@/lib/auth/context';
import { dbErr, type DbErrorResult } from '@/lib/errors/db-error';
import { invalidateAppCache } from '@/lib/cache/invalidate-app';
import type { EditKey } from '@/lib/leave/requestEdit';

const EDIT_KEYS: readonly string[] = [
  'edit_leave_daily', 'edit_leave_hourly', 'edit_errand_daily', 'edit_errand_hourly', 'edit_requests_own',
];

/** The edit permissions the caller holds (admin: all five); `[]` on any error. */
export async function getRequestEditKeys(): Promise<EditKey[]> {
  const c = await requireCaller();
  if (!c.ok) return [];
  const { data, error } = await c.supabase.rpc('app_my_request_edit_types');
  if (error) return [];
  return (data ?? []).filter((k): k is EditKey => EDIT_KEYS.includes(k));
}

export type EditRequestInput = {
  requestId: string;
  unit: 'day' | 'hour';
  start: string;
  end: string;
  dayPart: 'full' | 'am' | 'pm';
  startTime: string | null;
  endTime: string | null;
  /** null = unchanged. */
  perDiemRials: number | null;
  reason: string;
  signatureData: string;
  signatureAuthorized: boolean;
};

export async function editRequest(input: EditRequestInput): Promise<{ ok: true } | DbErrorResult> {
  const c = await requireCaller();
  if (!c.ok) return c;
  if (!input.signatureData || !input.signatureAuthorized) return dbErr('signature is required');
  if (input.perDiemRials !== null && (!Number.isSafeInteger(input.perDiemRials) || input.perDiemRials < 0)) {
    return dbErr('per diem must be 0 or more');
  }
  const { error } = await c.supabase.rpc('app_edit_request', {
    p_request: input.requestId,
    p_unit: input.unit,
    p_start: input.start,
    p_end: input.end,
    p_day_part: input.dayPart,
    p_start_time: input.startTime,
    p_end_time: input.endTime,
    p_per_diem_rials: input.perDiemRials,
    p_reason: input.reason,
    p_signature_data: input.signatureData,
    p_signature_authorized: input.signatureAuthorized,
  });
  if (error) return dbErr(error.message);
  invalidateAppCache();
  return { ok: true };
}
