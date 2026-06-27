/**
 * Whether a leave request may be cancelled by its owner.
 * Mirrors the SQL guard in cancel_leave_request: pending → always;
 * approved → only while it hasn't started (start_date strictly after today).
 * Dates are YYYY-MM-DD Gregorian strings (ISO order is lexicographic).
 */
export function isCancellable(status: string, startDate: string, today: string): boolean {
  if (status === 'pending') return true;
  if (status === 'approved') return startDate > today;
  return false;
}
