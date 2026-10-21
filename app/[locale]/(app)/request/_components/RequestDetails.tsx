'use client';

/**
 * The details of one of the caller's own requests (FR-72): per diem,
 * procurement's itinerary (FR-73) or, on older bookings, its transport and note, dates, day part or time, unpaid part,
 * tracking number, cover, rejection note, approval steps and signatures.
 * Shared by the Requests tab and Home's "Show more".
 */

import { useTranslations } from 'next-intl';
import type { LeaveRequestWithType } from '@/lib/actions/leave/requests';
import type { MyTravel } from '@/lib/actions/travel';
import { formatCalendarDate } from '@/lib/leave/calendarMonth';
import { formatDuration } from '@/lib/leave/duration';
import { formatTimeRange } from '@/lib/leave/formatTimeRange';
import { formatSerial, formatSerialLocalized } from '@/lib/leave/serial';
import { hasItinerary } from '@/lib/travel/itinerary';
import { TravelItinerary } from '@/components/TravelItinerary';
import { formatRials } from '@/lib/leave/perDiem';
import { RequestProgress } from '@/components/RequestProgress';
import { RequestSignatureViewer } from './RequestSignature';
import { useRequestLabels } from './useRequestLabels';

/** `pending`: approved, but procurement has not finished the travel booking. */
export type TravelNote = MyTravel;

export function RequestDetails({
  req,
  locale,
  hoursPerDay,
  travel,
  progressOpen,
}: {
  req: LeaveRequestWithType;
  locale: string;
  hoursPerDay: number;
  travel?: TravelNote;
  /** Open the approval steps at once instead of on click. */
  progressOpen: boolean;
}) {
  const labels = useRequestLabels();
  const tTravel = useTranslations('travel');
  const tErrand = useTranslations('errand');
  return (
    <>
      {req.kind === 'errand' && req.per_diem_rials != null && (
        <div className="text-xs text-muted-foreground mt-0.5" data-testid={`per-diem-${req.id}`}>
          {tErrand('perDiem')}: {formatRials(req.per_diem_rials, locale)}
          {req.per_diem_by_requester && <> · {tErrand('perDiemByRequester')}</>}
        </div>
      )}
      {hasItinerary(travel?.itinerary) ? (
        <TravelItinerary
          itinerary={travel.itinerary}
          transport={travel.transport}
          note={travel.note}
          locale={locale}
          serial={formatSerialLocalized(req.serial_year, req.serial_seq, locale)}
          fileSerial={formatSerial(req.serial_year, req.serial_seq)}
          tripStart={req.start_date}
          tripEnd={req.end_date}
          testId={`travel-itinerary-${req.id}`}
        />
      ) : (travel?.transport || travel?.note) && (
        <div className="mt-1 rounded-md bg-secondary px-2 py-1 text-xs" data-testid={`travel-note-${req.id}`}>
          {travel?.transport && (
            <div>{tTravel('myTransport')}: {tTravel(`transportOptions.${travel.transport}`)}</div>
          )}
          {travel?.note && <div>{tTravel('myNote')}: {travel.note}</div>}
        </div>
      )}
      {/* Date range */}
      <div className="text-xs text-muted-foreground mt-0.5">
        {labels.from} {formatCalendarDate(req.start_date, locale)}{' '}
        {labels.to} {formatCalendarDate(req.end_date, locale)}
      </div>
      {/* Day part */}
      <div className="text-xs text-muted-foreground">
        {req.unit === 'hour'
          ? formatTimeRange(req.start_time, req.end_time, locale)
          : labels.dayPartLabels[req.day_part]}{' '}
        · {formatDuration(req.requested_minutes, hoursPerDay, locale, labels)}
      </div>
      {req.unpaid_minutes > 0 && (
        <div
          className="text-xs font-medium text-destructive"
          data-testid={`request-unpaid-${req.id}`}
        >
          {labels.unpaidTimeOffLabel}:{' '}
          {formatDuration(req.unpaid_minutes, hoursPerDay, locale, labels)}
        </div>
      )}
      {/* Labelled شماره پیگیری — NOT the شماره on the paper form,
          which is the requester's personnel number (spec §5). */}
      <div className="text-xs text-muted-foreground">
        {labels.trackingNo}:{' '}
        {/* testid marks the VALUE, not the label — a caller reading
            `serial-*` wants the number, not the chrome around it. */}
        <span className="font-mono" dir="ltr" data-testid={`serial-${req.id}`}>
          {formatSerialLocalized(req.serial_year, req.serial_seq, locale)}
        </span>
      </div>
      {req.replacement_name && (
        <div className="text-xs text-muted-foreground">
          {labels.coverLabel}: {req.replacement_name}
        </div>
      )}
      {/* Why it was rejected — optional, set by the decider. */}
      {req.status === 'rejected' && req.decision_note && (
        <div
          className="mt-2 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          data-testid={`decision-note-${req.id}`}
        >
          <span className="font-medium">{labels.rejectedReason}:</span>{' '}
          {req.decision_note}
        </div>
      )}
      {req.status !== 'cancelled' && (
        // Keyed by status: a decision arriving on refresh reloads the steps.
        <RequestProgress
          key={`${req.id}:${req.status}`}
          requestId={req.id}
          defaultOpen={progressOpen}
        />
      )}
      <RequestSignatureViewer
        requestId={req.id}
        consentAt={req.signature_consent_at}
        labels={labels.requesterSignature}
        locale={locale}
      />
      <RequestSignatureViewer
        requestId={req.id}
        consentAt={req.approver_signature_consent_at}
        labels={labels.approverSignature}
        locale={locale}
        kind="approver"
      />
    </>
  );
}
