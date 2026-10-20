'use client';

/**
 * FR-70: procurement records how the trip was booked — transport, ticket and
 * hotel cost (whole Rials, 0 if none) and a note the traveller sees — then marks
 * it «رزرو شد». A company car has no ticket, so its cost is 0.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { parseRials } from '@/lib/leave/perDiem';
import { saveTravelBooking, type Transport } from '@/lib/actions/travel';

export type BookingFormInitial = {
  transport: Transport | null;
  flightCostRials: number | null;
  hotelCostRials: number | null;
  note: string | null;
  done: boolean;
};

const asText = (v: number | null) => (v === null ? '' : String(v));

export function BookingForm({ requestId, initial }: { requestId: string; initial: BookingFormInitial }) {
  const t = useTranslations('travel');
  const router = useRouter();
  const [transport, setTransport] = useState<Transport | null>(initial.transport);
  // A company car has no ticket: its cost is always 0, even on a draft saved without it.
  const [flight, setFlight] = useState(initial.transport === 'company_car' ? '0' : asText(initial.flightCostRials));
  const [hotel, setHotel] = useState(asText(initial.hotelCostRials));
  const [note, setNote] = useState(initial.note ?? '');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const chooseTransport = (value: Transport) => {
    setTransport(value);
    if (value === 'company_car') setFlight('0');
  };

  const submit = (done: boolean) => {
    setError('');
    setSaved(false);
    const amount = (raw: string) => (raw.trim() === '' ? null : parseRials(raw));
    const flightCostRials = transport === 'company_car' ? 0 : amount(flight);
    const hotelCostRials = amount(hotel);
    if (Number.isNaN(flightCostRials) || Number.isNaN(hotelCostRials)) {
      setError(t('costInvalid'));
      return;
    }
    if (done && (!transport || flightCostRials === null || hotelCostRials === null)) {
      setError(t('doneNeedsAll'));
      return;
    }
    startTransition(async () => {
      const res = await saveTravelBooking({ requestId, transport, flightCostRials, hotelCostRials, note, done });
      if (!res.ok) { setError(res.error); return; }
      setSaved(true);
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t('transport')}</legend>
        <div className="flex flex-wrap gap-4">
          {(['flight', 'company_car'] as const).map((value) => (
            <label key={value} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name={`transport-${requestId}`}
                className="size-4"
                checked={transport === value}
                onChange={() => chooseTransport(value)}
              />
              {t(`transportOptions.${value}`)}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`flight-${requestId}`}>{t('flightCost')}</Label>
          <Input
            id={`flight-${requestId}`}
            inputMode="numeric"
            dir="ltr"
            autoComplete="off"
            value={flight}
            disabled={transport === 'company_car'}
            onChange={(e) => setFlight(e.target.value)}
            placeholder="0"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`hotel-${requestId}`}>{t('hotelCost')}</Label>
          <Input
            id={`hotel-${requestId}`}
            inputMode="numeric"
            dir="ltr"
            autoComplete="off"
            value={hotel}
            onChange={(e) => setHotel(e.target.value)}
            placeholder="0"
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`note-${requestId}`}>{t('travellerNote')}</Label>
        <Textarea
          id={`note-${requestId}`}
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('travellerNotePlaceholder')}
        />
        <p className="text-xs text-muted-foreground">{t('travellerNoteHint')}</p>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {saved && <p role="status" className="text-sm text-success">{t('saved')}</p>}
      <div className="flex flex-wrap gap-2">
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
