'use client';

import type { ReviewRequestRow } from '@/lib/actions/leave/review';
import { todayInAppTz } from '@/lib/appDate';
import { canCorrectTrip } from '@/lib/travel/extensions';
import { TravelTickToggle } from './TravelTickToggle';
import { CorrectTripDialog } from './CorrectTripDialog';
import { RequestCancelButton } from '../../request/_components/RequestCancelButton';

export type ReviewActionRequest = Pick<ReviewRequestRow,
  'id' | 'employee_id' | 'kind' | 'unit' | 'status' | 'start_date' | 'end_date' | 'per_diem_rials'>;
export type TravelTicks = Record<string, { started: boolean }> | null;

export function RequestReviewActions({ request: r, locale, travelTicks, viewerId, className, buttonClassName, hideCancel, canCancel }: {
  request: ReviewActionRequest; locale: string; travelTicks: TravelTicks; viewerId: string;
  /** Replaces the default end-aligned wrapping row (`contents` joins the caller's row). */
  className?: string;
  /** Sizes the Correct and Cancel buttons like the card's other buttons. */
  buttonClassName?: string;
  /** Pending queue: Reject already ends the request, so no second way to do it. */
  hideCancel?: boolean;
  /** Admin or `leave_requests` edit: may cancel any request, as `cancel_leave_request` allows.
   *  Travel HR without it may cancel only trips ticked for booking (FR-70). */
  canCancel?: boolean;
}) {
  if (r.employee_id === viewerId || (!travelTicks && !canCancel)) return null;
  return (
    <div className={className ?? 'flex flex-wrap items-center justify-end gap-2'}>
      {travelTicks && r.kind === 'errand' && r.unit === 'day' && (r.status === 'pending' || r.status === 'approved')
        && r.end_date >= todayInAppTz() && (
        <TravelTickToggle requestId={r.id} employeeId={r.employee_id}
          ticked={!!travelTicks[r.id]} started={travelTicks[r.id]?.started ?? false} />
      )}
      {travelTicks && canCorrectTrip(r, viewerId) && <CorrectTripDialog trip={r} locale={locale} buttonClassName={buttonClassName} />}
      {!hideCancel && (canCancel || travelTicks?.[r.id]) && <RequestCancelButton requestId={r.id} status={r.status} startDate={r.start_date} buttonClassName={buttonClassName} />}
    </div>
  );
}
