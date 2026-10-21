'use client';

/**
 * FR-70 / FR-73: procurement records how the trip was booked — "Getting there"
 * (flight legs or the company car), the hotel stays with a cost each, the ticket
 * cost (whole Rials, 0 if none) and other notes the traveller sees — then marks
 * it «رزرو شد». The hotel cost finance gets is the stays' total. A company car
 * has no ticket, so its cost is 0; so is the hotel's with "No hotel".
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { StickyNote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { parseRials } from '@/lib/leave/perDiem';
import { saveTravelBooking, type Transport } from '@/lib/actions/travel';
import {
  draftFromItinerary,
  hotelTotal,
  itineraryErrors,
  normalizeItinerary,
  stayFilled,
  type Itinerary,
  type ItineraryDraft,
} from '@/lib/travel/itinerary';
import { ItinerarySection, type FieldErrors } from './ItineraryFields';
import { TransportSection } from './TransportSection';
import { HotelSection } from './HotelSection';

export type BookingFormInitial = {
  transport: Transport | null;
  flightCostRials: number | null;
  hotelCostRials: number | null;
  itinerary: Itinerary | null;
  note: string | null;
  done: boolean;
};

const asText = (v: number | null) => (v === null ? '' : String(v));

export function BookingForm({
  requestId,
  locale,
  tripStart,
  tripEnd,
  initial,
}: {
  requestId: string;
  locale: string;
  tripStart: string;
  tripEnd: string;
  initial: BookingFormInitial;
}) {
  const t = useTranslations('travel');
  const ti = useTranslations('travel.itinerary');
  const router = useRouter();
  const [transport, setTransport] = useState<Transport | null>(initial.transport);
  // A company car has no ticket: its cost is always 0, even on a draft saved without it.
  const [flight, setFlight] = useState(initial.transport === 'company_car' ? '0' : asText(initial.flightCostRials));
  const [draft, setDraftState] = useState<ItineraryDraft>(() => {
    const d = draftFromItinerary(initial.itinerary, tripStart, tripEnd);
    // A booking saved before per-stay costs: its one stay carries the old hotel total.
    if (d.stays.length === 1 && !d.stays[0].cost && initial.hotelCostRials !== null && !d.no_hotel) {
      d.stays[0] = { ...d.stays[0], cost: String(initial.hotelCostRials) };
    }
    return d;
  });
  const [note, setNote] = useState(initial.note ?? '');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const setDraft = (update: (d: ItineraryDraft) => ItineraryDraft) => {
    setDraftState(update);
    setSaved(false);
  };

  const chooseTransport = (value: Transport) => {
    setTransport(value);
    if (value === 'company_car') setFlight('0');
  };

  const submit = (done: boolean) => {
    setError('');
    setSaved(false);
    setFieldErrors({});
    const amount = (raw: string) => (raw.trim() === '' ? null : parseRials(raw));
    const flightCostRials = transport === 'company_car' ? 0 : amount(flight);
    if (Number.isNaN(flightCostRials)) {
      setError(t('costInvalid'));
      return;
    }
    // Blank extra stays are dropped (keeping one), so error paths match what is on screen.
    const filled = draft.stays.filter(stayFilled);
    const cleaned = { ...draft, stays: filled.length ? filled : draft.stays.slice(0, 1) };
    if (cleaned.stays.length !== draft.stays.length) setDraftState(cleaned);
    const itinerary = normalizeItinerary(cleaned, transport);
    const hotelCostRials = hotelTotal(itinerary);
    const errs = itineraryErrors(itinerary, transport, done, tripStart, tripEnd);
    if (errs.length) {
      setFieldErrors(Object.fromEntries(errs.map((e) => [e.path, e.key])));
      setError(ti('fixErrors'));
      return;
    }
    if (done && (!transport || flightCostRials === null || hotelCostRials === null)) {
      setError(t('doneNeedsAll'));
      return;
    }
    startTransition(async () => {
      const res = await saveTravelBooking({ requestId, transport, flightCostRials, hotelCostRials, itinerary, note, done });
      if (!res.ok) { setError(res.error); return; }
      setSaved(true);
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <TransportSection
        requestId={requestId}
        locale={locale}
        transport={transport}
        onTransport={chooseTransport}
        draft={draft}
        setDraft={setDraft}
        flightCost={flight}
        onFlightCost={setFlight}
        errors={fieldErrors}
      />
      <HotelSection
        requestId={requestId}
        locale={locale}
        tripStart={tripStart}
        tripEnd={tripEnd}
        draft={draft}
        setDraft={setDraft}
        hotelTotal={hotelTotal(normalizeItinerary(draft, transport))}
        errors={fieldErrors}
      />
      <ItinerarySection icon={<StickyNote />} title={ti('otherNotes')}>
        <div className="space-y-1.5">
          <Label htmlFor={`note-${requestId}`} className="sr-only">{ti('otherNotes')}</Label>
          <Textarea
            id={`note-${requestId}`}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={ti('otherNotesPlaceholder')}
          />
          <p className="text-xs text-muted-foreground">{t('travellerNoteHint')}</p>
        </div>
      </ItinerarySection>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {saved && <p role="status" className="text-sm text-success">{t('saved')}</p>}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {!initial.done && (
          <Button type="button" variant="outline" disabled={pending} onClick={() => submit(false)} data-testid="booking-save">
            {t('saveDraft')}
          </Button>
        )}
        <Button type="button" disabled={pending} onClick={() => submit(true)} data-testid="booking-done">
          {initial.done ? t('saveChanges') : t('markDone')}
        </Button>
      </div>
    </div>
  );
}
