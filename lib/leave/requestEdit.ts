/**
 * FR-91: which approved requests a viewer may edit, and as which unit. Pure mirror of
 * `private.can_edit_request`: the database decides; this only decides whether to show Edit.
 * The admin needs no flag here: `app_my_request_edit_types()` returns all five keys for them.
 */

export type EditKey =
  | 'edit_leave_daily' | 'edit_leave_hourly' | 'edit_errand_daily' | 'edit_errand_hourly'
  | 'edit_requests_own';
export type RequestShape = { kind: 'leave' | 'errand'; unit: 'day' | 'hour' };

/** The permission that covers one request type (`private.request_edit_key`). */
export function editKeyFor(s: RequestShape): Exclude<EditKey, 'edit_requests_own'> {
  return `edit_${s.kind === 'leave' ? 'leave' : 'errand'}_${s.unit === 'day' ? 'daily' : 'hourly'}`;
}

/** Units the viewer may save this request as, current unit first; empty = no Edit button. */
export function editableUnits(
  r: RequestShape & { status: string; employee_id: string },
  viewer: { id: string; keys: readonly EditKey[] }
): ('day' | 'hour')[] {
  if (r.status !== 'approved') return [];
  if (r.employee_id === viewer.id && !viewer.keys.includes('edit_requests_own')) return [];
  if (!viewer.keys.includes(editKeyFor(r))) return [];
  const other = r.unit === 'day' ? 'hour' : 'day';
  return viewer.keys.includes(editKeyFor({ kind: r.kind, unit: other })) ? [r.unit, other] : [r.unit];
}
