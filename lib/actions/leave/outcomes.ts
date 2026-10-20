'use server';

/**
 * The requester's side of the live update: which of their pending requests
 * have since been decided. Approved means the whole chain signed; rejected
 * means any step refused it (the database sets the status only then).
 */

import { getTranslations } from 'next-intl/server';
import { requireCaller } from '@/lib/auth/context';
import { dbErr, type DbErrorResult } from '@/lib/errors/db-error';
import { invalidateAppCache } from '@/lib/cache/invalidate-app';
import { formatCalendarDate } from '@/lib/leave/calendarMonth';
import { localizedLeaveTypeName } from '@/lib/i18n/format';

/** A pending request as the banner names it: "<type> (<date>)". */
export type WatchedRequest = { id: string; label: string };

export type RequestOutcome = {
  id: string;
  status: 'approved' | 'rejected';
  note: string | null;
};

/** Most pending requests one person can realistically have; caps the poll's input. */
const MAX_WATCHED = 50;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The caller's own pending requests, labelled for the outcome banner. */
export async function getMyPendingRequests(
  locale: string
): Promise<{ ok: true; requests: WatchedRequest[] } | DbErrorResult> {
  const c = await requireCaller();
  if (!c.ok) return c;

  const { data, error } = await c.supabase
    .from('leave_requests')
    .select('id, kind, start_date, leave_types(name_fa, name_en)')
    .eq('employee_id', c.user.id)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(MAX_WATCHED);
  if (error) return dbErr(error.message);

  const tErrand = await getTranslations({ locale, namespace: 'errand' });
  type Row = {
    id: string;
    kind: string | null;
    start_date: string;
    leave_types: { name_fa: string; name_en: string | null } | null;
  };
  const requests = ((data ?? []) as unknown as Row[]).map((r) => {
    const name =
      r.kind === 'errand' || !r.leave_types
        ? tErrand('badge')
        : localizedLeaveTypeName(r.leave_types, locale);
    return { id: r.id, label: `${name} (${formatCalendarDate(r.start_date, locale)})` };
  });
  return { ok: true, requests };
}

/**
 * Which of `ids` (the caller's own requests) are now approved or rejected.
 * Cancelled ones are left out: the requester did that themselves.
 */
export async function getMyRequestOutcomes(
  ids: string[]
): Promise<{ ok: true; outcomes: RequestOutcome[] } | DbErrorResult> {
  const c = await requireCaller();
  if (!c.ok) return c;
  // Server actions are publicly POSTable; keep the input to what the banner sends.
  if (!Array.isArray(ids) || ids.length > MAX_WATCHED || !ids.every((id) => UUID_RE.test(id))) {
    return { ok: false, error: 'invalid input' };
  }
  if (ids.length === 0) return { ok: true, outcomes: [] };

  const { data, error } = await c.supabase
    .from('leave_requests')
    .select('id, status, decision_note')
    .eq('employee_id', c.user.id)
    .in('id', ids)
    .in('status', ['approved', 'rejected']);
  if (error) return dbErr(error.message);

  const outcomes = (data ?? []).map((r) => ({
    id: r.id,
    status: r.status as 'approved' | 'rejected',
    note: r.decision_note ?? null,
  }));
  // The approver's write could not reach this browser's router cache; drop it
  // now so the requester's other tabs show the decision too.
  if (outcomes.length > 0) invalidateAppCache();
  return { ok: true, outcomes };
}
