/**
 * FR-88: the replacement (جانشین) signs the request in the app.
 *
 * State lives in `leave_request_replacement_signoffs` (one row per request that names a
 * replacement): `pending` → `signed` (the replacement, any time the request is pending or
 * approved) or `pending` → `declined` (the replacement, with an optional note). After a
 * decline the requester names someone else (a new `pending` row for them) or nobody (the
 * row goes). No row = nothing to sign (no replacement, or filed before FR-88). The answer
 * never gates an approval step.
 */

export type ReplacementSignoffStatus = 'pending' | 'signed' | 'declined';

type RequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

/** Longest decline note the database accepts. */
export const REPLACEMENT_NOTE_MAX = 500;

/** The request is still open: signing, declining and changing the replacement all need it. */
export function isOpenRequest(status: RequestStatus): boolean {
  return status === 'pending' || status === 'approved';
}

/** The replacement may sign or decline now. */
export function replacementCanAnswer(row: {
  status: RequestStatus;
  signoffStatus: ReplacementSignoffStatus | null | undefined;
}): boolean {
  return row.signoffStatus === 'pending' && isOpenRequest(row.status);
}

/** The requester must name someone else or mark "no replacement". */
export function requesterMustChooseReplacement(row: {
  status: RequestStatus;
  signoffStatus: ReplacementSignoffStatus | null | undefined;
}): boolean {
  return row.signoffStatus === 'declined' && isOpenRequest(row.status);
}

/**
 * What the printed form's Replacement box shows. Null when nobody is named; an older
 * request without a sign-off row reads as `pending` (blank box for a wet signature).
 */
export function printReplacementStatus(
  replacementName: string | null | undefined,
  status: ReplacementSignoffStatus | null | undefined
): ReplacementSignoffStatus | null {
  if (!replacementName) return null;
  return status ?? 'pending';
}

/** Raw message `dbErr` localizes, or null. */
export function replacementNoteProblem(note: string | null | undefined): string | null {
  const trimmed = (note ?? '').trim();
  return trimmed.length > REPLACEMENT_NOTE_MAX ? 'note is too long (max 500 characters)' : null;
}
