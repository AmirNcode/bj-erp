/**
 * Pure validation and time arithmetic for the hourly work errand / ماموریت ساعتی
 * (spec docs/specs/2026-07-30-work-errand-and-login-codes-design.md §3–§4).
 *
 * MIRRORS the SQL in supabase/migrations/20260730130001_work_errand.sql — the
 * `leave_requests_kind_shape` CHECK and the input guards in
 * private.submit_leave_impl. The database is authoritative at runtime; this
 * exists so the form can validate before a round-trip, and so the rules can be
 * tested exhaustively rather than hand-checked in psql.
 *
 * An errand is WORK: it deducts no balance, is not bound by the work-hours
 * window, and is not capped by the hourly-leave daily limit. It may legitimately
 * fall on a Friday or a public holiday. None of those rules appear here because
 * none of them apply — the only constraints on an errand are a real time range
 * and a location.
 */

import { rangeMinutes } from '@/lib/leave/hourly';

/**
 * Shared by the `maxLength` on the form field and the `length(...) <= 200` in
 * the CHECK constraint, so the two cannot drift apart.
 */
export const MAX_ERRAND_LOCATION_LENGTH = 200;

export type ErrandInput = {
  /** Company-local 'HH:MM' (or 'HH:MM:SS', which is what Postgres returns). */
  startTime: string;
  endTime: string;
  /** محل ماموریت — required, non-blank once trimmed. */
  location: string;
};

/**
 * Duration in minutes. 0 for a reversed or empty range, never negative —
 * the same contract `rangeMinutes` gives hourly leave, reused rather than
 * reimplemented so the two screens can never disagree.
 */
export function errandMinutes(startTime: string, endTime: string): number {
  return rangeMinutes({ start: startTime, end: endTime });
}

/** True when محل ماموریت is present and within the stored column's limit. */
export function isValidErrandLocation(location: string): boolean {
  const trimmed = location.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_ERRAND_LOCATION_LENGTH;
}

export type ErrandValidation =
  | { valid: true }
  /**
   * The first failure only. `reason` names the field so the caller can pick its
   * own translated string; this module holds no user-facing text.
   */
  | { valid: false; reason: 'times' | 'location' };

/**
 * Validates an errand exactly as the SQL does, in the SQL's order: the time
 * range first (`end_time > start_time`), then the location.
 */
export function validateErrand(input: ErrandInput): ErrandValidation {
  if (errandMinutes(input.startTime, input.endTime) <= 0) {
    return { valid: false, reason: 'times' };
  }
  if (!isValidErrandLocation(input.location)) {
    return { valid: false, reason: 'location' };
  }
  return { valid: true };
}
