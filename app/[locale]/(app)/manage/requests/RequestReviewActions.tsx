'use client';

import type { ReviewRequestRow } from '@/lib/actions/leave/review';
import { todayInAppTz } from '@/lib/appDate';
import { editableUnits, type EditKey } from '@/lib/leave/requestEdit';
import { WORK_SETTINGS_FALLBACK } from '@/lib/leave/workSettings';
import { TravelTickToggle } from './TravelTickToggle';
import { EditRequestDialog } from './EditRequestDialog';
import { RequestCancelButton } from '../../request/_components/RequestCancelButton';

export type ReviewActionRequest = Pick<ReviewRequestRow,
  'id' | 'employee_id' | 'kind' | 'unit' | 'status' | 'start_date' | 'end_date' | 'start_time' | 'end_time' | 'day_part' | 'per_diem_rials'>;
export type TravelTicks = Record<string, { started: boolean }> | null;

const DEFAULT_WORK_WINDOW = { start: WORK_SETTINGS_FALLBACK.workStart, end: WORK_SETTINGS_FALLBACK.workEnd };

export function RequestReviewActions({ request: r, locale, travelTicks, viewerId, editKeys = [], workWindow = DEFAULT_WORK_WINDOW, className, buttonClassName, hideCancel, canCancel }: {
  request: ReviewActionRequest; locale: string; travelTicks: TravelTicks; viewerId: string;
  /** FR-91: the edit permissions the viewer holds (admin: all five). Without them there is no Edit. */
  editKeys?: readonly EditKey[];
  /** Company working hours, for the hourly time choices of the Edit dialog. */
  workWindow?: { start: string; end: string };
  /** Replaces the default end-aligned wrapping row (`contents` joins the caller's row). */
  className?: string;
  /** Sizes the Edit and Cancel buttons like the card's other buttons. */
  buttonClassName?: string;
  /** Pending queue: Reject already ends the request, so no second way to do it. */
  hideCancel?: boolean;
  /** Admin or `leave_requests` edit: may cancel any request, as `cancel_leave_request` allows.
   *  Travel HR without it may cancel only trips ticked for booking (FR-70). */
  canCancel?: boolean;
}) {
  const own = r.employee_id === viewerId;
  const units = editableUnits(r, { id: viewerId, keys: editKeys });
  // The travel switch and Cancel never apply to the viewer's own request; Edit does
  // when the viewer also holds edit_requests_own (editableUnits checks it).
  if (units.length === 0 && (own || (!travelTicks && !canCancel))) return null;
  return (
    <div className={className ?? 'flex flex-wrap items-center justify-end gap-2'}>
      {!own && travelTicks && r.kind === 'errand' && r.unit === 'day' && (r.status === 'pending' || r.status === 'approved')
        && r.end_date >= todayInAppTz() && (
        <TravelTickToggle requestId={r.id} employeeId={r.employee_id}
          ticked={!!travelTicks[r.id]} started={travelTicks[r.id]?.started ?? false} />
      )}
      {units.length > 0 && (
        <EditRequestDialog request={r} units={units} locale={locale} workWindow={workWindow} buttonClassName={buttonClassName} />
      )}
      {!own && !hideCancel && (canCancel || travelTicks?.[r.id]) && <RequestCancelButton requestId={r.id} status={r.status} startDate={r.start_date} buttonClassName={buttonClassName} />}
    </div>
  );
}
