'use server';

/**
 * Your own requests: submitting each kind, cancelling, listing them, and the
 * replacement (cover) reads the request forms use.
 */

import { requireCaller } from '@/lib/auth/context';
import { dbErr } from '@/lib/errors/db-error';
import { invalidateAppCache } from '@/lib/cache/invalidate-app';
import type { Database } from '@/lib/supabase/types';
import type { ReplacementCandidate } from '@/lib/leave/replacement';
import { isValidSignatureData } from '@/lib/leave/signature';
import { accrueBeforeRead, type DayPart } from './shared';

export type SubmitRequestInput = {
  leaveTypeId: string;
  start: string; // YYYY-MM-DD Gregorian
  end: string;   // YYYY-MM-DD Gregorian
  dayPart: DayPart;
  reason?: string;
  /** Optional cover; null/undefined is valid. */
  replacementId?: string | null;
  signatureData: string;
  signatureAuthorized: boolean;
};

export type SubmitRequestResult =
  | { ok: true; requestId: string }
  | { ok: false; error: string };

export async function submitRequest(
  input: SubmitRequestInput
): Promise<SubmitRequestResult> {
  const c = await requireCaller();
  if (!c.ok) return c;
  if (!input.signatureAuthorized) return dbErr('signature authorization is required');
  if (!input.signatureData) return dbErr('signature is required');
  if (!isValidSignatureData(input.signatureData)) return dbErr('signature data is invalid');

  // Accrue first: a worker whose newly-earned day makes this request affordable
  // must not be refused by a stale balance.
  const accrualError = await accrueBeforeRead(c.supabase);
  if (accrualError) return dbErr(accrualError);

  const { data, error } = await c.supabase.rpc('submit_leave_request', {
    p_leave_type_id: input.leaveTypeId,
    p_start: input.start,
    p_end: input.end,
    p_day_part: input.dayPart,
    p_reason: input.reason ?? undefined,
    p_replacement_id: input.replacementId ?? undefined,
    p_signature_data: input.signatureData,
    p_signature_authorized: input.signatureAuthorized,
  });

  if (error) {
    // Known SQL-raised messages are translated; unknown ones become generic.
    return dbErr(error.message);
  }

  invalidateAppCache();
  return { ok: true, requestId: data as string };
}

export type CancelRequestResult =
  | { ok: true }
  | { ok: false; error: string };

export async function cancelRequest(
  requestId: string
): Promise<CancelRequestResult> {
  const c = await requireCaller();
  if (!c.ok) return c;

  const { error } = await c.supabase.rpc('cancel_leave_request', {
    p_id: requestId,
  });

  if (error) {
    return dbErr(error.message);
  }

  invalidateAppCache();
  return { ok: true };
}

export type SubmitHourlyInput = {
  leaveTypeId: string;
  /** Optional cover; null/undefined is valid. */
  replacementId?: string | null;
  /** Gregorian YYYY-MM-DD — one date only. */
  date: string;
  /** 'HH:MM', company-local. */
  startTime: string;
  endTime: string;
  reason?: string;
  signatureData: string;
  signatureAuthorized: boolean;
};

export async function submitHourlyRequest(
  input: SubmitHourlyInput
): Promise<SubmitRequestResult> {
  const c = await requireCaller();
  if (!c.ok) return c;
  if (!input.signatureAuthorized) return dbErr('signature authorization is required');
  if (!input.signatureData) return dbErr('signature is required');
  if (!isValidSignatureData(input.signatureData)) return dbErr('signature data is invalid');

  // Same reason as the daily path: a freshly-accrued hour must be spendable.
  const accrualError = await accrueBeforeRead(c.supabase);
  if (accrualError) return dbErr(accrualError);

  const { data, error } = await c.supabase.rpc('submit_hourly_leave_request', {
    p_leave_type_id: input.leaveTypeId,
    p_date: input.date,
    p_start_time: input.startTime,
    p_end_time: input.endTime,
    p_reason: input.reason ?? undefined,
    p_replacement_id: input.replacementId ?? undefined,
    p_signature_data: input.signatureData,
    p_signature_authorized: input.signatureAuthorized,
  });

  if (error) return dbErr(error.message);

  invalidateAppCache();
  return { ok: true, requestId: data as string };
}

export type SubmitErrandInput = {
  /** Gregorian YYYY-MM-DD — one date only. */
  date: string;
  /** 'HH:MM', company-local. */
  startTime: string;
  endTime: string;
  /** محل ماموریت — required. */
  location: string;
  /** شرح ماموریت — optional; stored in `reason`, which is FR-25-private. */
  description?: string;
  signatureData: string;
  signatureAuthorized: boolean;
};

export async function submitErrandRequest(
  input: SubmitErrandInput
): Promise<SubmitRequestResult> {
  const c = await requireCaller();
  if (!c.ok) return c;
  if (!input.signatureAuthorized) return dbErr('signature authorization is required');
  if (!input.signatureData) return dbErr('signature is required');
  if (!isValidSignatureData(input.signatureData)) return dbErr('signature data is invalid');

  // No accrual pass here, unlike the two leave paths: an errand is work. It
  // spends no balance, so there is nothing a freshly-accrued hour could unlock.
  const { data, error } = await c.supabase.rpc('submit_errand_request', {
    p_date: input.date,
    p_start_time: input.startTime,
    p_end_time: input.endTime,
    p_location: input.location,
    p_description: input.description ?? undefined,
    p_signature_data: input.signatureData,
    p_signature_authorized: input.signatureAuthorized,
  });

  if (error) return dbErr(error.message);

  invalidateAppCache();
  return { ok: true, requestId: data as string };
}

export type SubmitDailyErrandInput = {
  /** Gregorian YYYY-MM-DD values; the UI displays Persian dates. */
  start: string;
  end: string;
  /** محل ماموریت — required. */
  location: string;
  /** شرح ماموریت — optional and FR-25-private. */
  description?: string;
  signatureData: string;
  signatureAuthorized: boolean;
};

export async function submitDailyErrandRequest(
  input: SubmitDailyErrandInput
): Promise<SubmitRequestResult> {
  const c = await requireCaller();
  if (!c.ok) return c;
  if (!input.signatureAuthorized) return dbErr('signature authorization is required');
  if (!input.signatureData) return dbErr('signature is required');
  if (!isValidSignatureData(input.signatureData)) return dbErr('signature data is invalid');

  const { data, error } = await c.supabase.rpc('submit_daily_errand_request', {
    p_start: input.start,
    p_end: input.end,
    p_location: input.location,
    p_description: input.description ?? undefined,
    p_signature_data: input.signatureData,
    p_signature_authorized: input.signatureAuthorized,
  });

  if (error) return dbErr(error.message);

  invalidateAppCache();
  return { ok: true, requestId: data as string };
}

/**
 * Fetches the caller's own leave requests with leave_type joined.
 */
export type LeaveRequestWithType = {
  id: string;
  /** 'errand' rows are work trips (BJ-F 50207), not leave — they carry no type. */
  kind: Database['public']['Enums']['request_kind'];
  /** محل ماموریت. Set only on errands; never exposed to teammates. */
  errand_location: string | null;
  start_date: string;
  end_date: string;
  day_part: DayPart;
  unit: Database['public']['Enums']['leave_unit'];
  start_time: string | null;
  end_time: string | null;
  requested_minutes: number;
  /** Portion not covered by paid leave; finalized when approved. */
  unpaid_minutes: number;
  replacement_name: string | null;
  serial_year: number;
  serial_seq: number;
  status: Database['public']['Enums']['leave_status'];
  reason: string | null;
  /** Set by the decider on reject; the requester reads it on their own row. */
  decision_note: string | null;
  /** Database-recorded proof that this request carries a requester signature. */
  signature_consent_at: string | null;
  /** Database-recorded proof that an authorized approver signed the approval. */
  approver_signature_consent_at: string | null;
  created_at: string;
  leave_types: {
    id: string;
    name_fa: string;
    name_en: string | null;
    color: string | null;
  } | null;
};

export async function getMyLeaveRequests(): Promise<{
  ok: true;
  requests: LeaveRequestWithType[];
} | { ok: false; error: string }> {
  const c = await requireCaller();
  if (!c.ok) return c;

  const { data, error } = await c.supabase
    .from('leave_requests')
    .select(
      `id, kind, errand_location, start_date, end_date, day_part, unit, start_time, end_time, requested_minutes, unpaid_minutes, serial_year, serial_seq, status, reason, decision_note, signature_consent_at, approver_signature_consent_at, created_at,
       replacement:profiles!leave_requests_replacement_id_fkey(full_name),
       leave_types(id, name_fa, name_en, color)`
    )
    .eq('employee_id', c.user.id)
    .order('created_at', { ascending: false });

  if (error) return dbErr(error.message);

  type Raw = Omit<LeaveRequestWithType, 'replacement_name'> & {
    replacement: { full_name: string } | null;
  };
  const requests: LeaveRequestWithType[] = ((data ?? []) as unknown as Raw[]).map((r) => ({
    ...r,
    replacement_name: r.replacement?.full_name ?? null,
  }));

  return { ok: true, requests };
}

export async function getReplacementCandidates(input: {
  start: string;
  end: string;
  unit?: 'day' | 'hour';
  startTime?: string | null;
  endTime?: string | null;
}): Promise<
  { ok: true; candidates: ReplacementCandidate[] } | { ok: false; error: string }
> {
  const c = await requireCaller();
  if (!c.ok) return c;

  const { data, error } = await c.supabase.rpc('get_replacement_candidates', {
    p_start: input.start,
    p_end: input.end,
    p_unit: input.unit ?? 'day',
    p_start_time: input.startTime ?? undefined,
    p_end_time: input.endTime ?? undefined,
  });
  if (error) return dbErr(error.message);

  return {
    ok: true,
    candidates: (data ?? []).map((r) => ({
      profileId: r.profile_id,
      fullName: r.full_name,
      employeeCode: r.employee_code,
      unavailable: r.unavailable,
      unavailableReason: r.unavailable_reason,
    })),
  };
}

export type CoverDuty = {
  requestId: string;
  employeeName: string;
  startDate: string;
  endDate: string;
  unit: 'day' | 'hour';
  startTime: string | null;
  endTime: string | null;
};

/**
 * Requests the caller is named cover for, in a window.
 *
 * Two uses: the reverse-case WARNING on the request screens (spec §2.1 — being
 * someone's cover never blocks your own leave), and the "you are covering X" card
 * on Home (D15 — the named person should never be surprised).
 */
export async function getMyCoverDuties(
  start: string,
  end: string
): Promise<{ ok: true; duties: CoverDuty[] } | { ok: false; error: string }> {
  const c = await requireCaller();
  if (!c.ok) return c;

  const { data, error } = await c.supabase.rpc('get_my_cover_conflicts', {
    p_start: start,
    p_end: end,
  });
  if (error) return dbErr(error.message);

  return {
    ok: true,
    duties: (data ?? []).map((r) => ({
      requestId: r.request_id,
      employeeName: r.employee_name,
      startDate: r.start_date,
      endDate: r.end_date,
      unit: r.unit,
      startTime: r.start_time,
      endTime: r.end_time,
    })),
  };
}
