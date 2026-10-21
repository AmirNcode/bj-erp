'use client';

/**
 * FR-73 "Getting there": the transport choice, then the outbound and return
 * flight legs (or the company car's pickups — every field optional), the
 * booking reference and the ticket cost. One column on phones.
 */

import { useTranslations } from 'next-intl';
import { Car, Plane } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Transport } from '@/lib/actions/travel';
import type { CarField, ItineraryDraft, LegDirection, LegField } from '@/lib/travel/itinerary';
import { CheckboxRow, ItineraryField, ItinerarySection, type FieldErrors } from './ItineraryFields';

type Props = {
  requestId: string;
  locale: string;
  transport: Transport | null;
  onTransport: (value: Transport) => void;
  draft: ItineraryDraft;
  setDraft: (update: (d: ItineraryDraft) => ItineraryDraft) => void;
  flightCost: string;
  onFlightCost: (value: string) => void;
  errors: FieldErrors;
};

export function TransportSection({
  requestId,
  locale,
  transport,
  onTransport,
  draft,
  setDraft,
  flightCost,
  onFlightCost,
  errors,
}: Props) {
  const t = useTranslations('travel');
  const ti = useTranslations('travel.itinerary');

  const setLeg = (dir: LegDirection, field: LegField, value: string) =>
    setDraft((d) => ({ ...d, [dir]: { ...d[dir], [field]: value } }));
  const setCar = (field: CarField, value: string) => setDraft((d) => ({ ...d, car: { ...d.car, [field]: value } }));

  const leg = (dir: LegDirection) => {
    const f = (field: LegField, kind: 'text' | 'time' | 'date' = 'text', ltr = false) => (
      <ItineraryField
        id={`${dir}-${field}`}
        label={ti(`leg.${field}`)}
        value={draft[dir][field]}
        onChange={(v) => setLeg(dir, field, v)}
        error={errors[`${dir}.${field}`]}
        kind={kind}
        ltr={ltr}
        locale={locale}
      />
    );
    return (
      <fieldset className="space-y-3" data-testid={`leg-${dir}`}>
        <legend className="mb-1 text-xs font-semibold text-muted-foreground">{ti(dir)}</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {f('airline')}
          {f('from')}
          {f('to')}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {f('flight_no', 'text', true)}
          {f('date', 'date')}
          {f('departs', 'time')}
          {f('arrives', 'time')}
        </div>
      </fieldset>
    );
  };

  const car = (field: CarField, kind: 'text' | 'time' | 'date' | 'tel' = 'text', ltr = false) => (
    <ItineraryField
      id={`car-${field}`}
      label={ti(`car.${field}`)}
      value={draft.car[field]}
      onChange={(v) => setCar(field, v)}
      error={errors[`car.${field}`]}
      kind={kind}
      ltr={ltr}
      locale={locale}
    />
  );

  return (
    <ItinerarySection
      icon={transport === 'company_car' ? <Car /> : <Plane />}
      title={ti('gettingThere')}
      testId="itinerary-transport"
      aside={
        transport && (
          <CheckboxRow
            id="itinerary-one-way"
            label={ti('oneWay')}
            checked={draft.one_way}
            onChange={(one_way) => setDraft((d) => ({ ...d, one_way }))}
          />
        )
      }
    >
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
                onChange={() => onTransport(value)}
                data-testid={`transport-${value}`}
              />
              {t(`transportOptions.${value}`)}
            </label>
          ))}
        </div>
      </fieldset>

      {transport === 'flight' && (
        <>
          {leg('outbound')}
          {!draft.one_way && <div className="border-t border-dashed border-border" aria-hidden />}
          {!draft.one_way && leg('return')}
          <div className="grid gap-3 sm:grid-cols-2">
            <ItineraryField
              id="booking_ref"
              label={ti('bookingRef')}
              value={draft.booking_ref}
              onChange={(booking_ref) => setDraft((d) => ({ ...d, booking_ref }))}
              error={errors.booking_ref}
              ltr
              locale={locale}
            />
            <div className="space-y-1.5">
              <Label htmlFor={`flight-${requestId}`}>{t('flightCost')}</Label>
              <Input
                id={`flight-${requestId}`}
                inputMode="numeric"
                dir="ltr"
                autoComplete="off"
                value={flightCost}
                onChange={(e) => onFlightCost(e.target.value)}
                placeholder="0"
              />
            </div>
          </div>
        </>
      )}

      {transport === 'company_car' && (
        <>
          <p className="text-xs text-muted-foreground">{ti('carOptional')}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {car('vehicle')}
            {car('plate')}
            {car('driver_name')}
            {car('driver_mobile', 'tel')}
          </div>
          <fieldset className="space-y-3">
            <legend className="mb-1 text-xs font-semibold text-muted-foreground">{ti('pickup')}</legend>
            <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
              {car('pickup_place')}
              <div className="grid grid-cols-2 gap-3 sm:contents">
                {car('pickup_date', 'date')}
                {car('pickup_time', 'time')}
              </div>
            </div>
          </fieldset>
          {!draft.one_way && (
            <fieldset className="space-y-3">
              <legend className="mb-1 text-xs font-semibold text-muted-foreground">{ti('returnPickup')}</legend>
              <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
                {car('return_place')}
                <div className="grid grid-cols-2 gap-3 sm:contents">
                  {car('return_date', 'date')}
                  {car('return_time', 'time')}
                </div>
              </div>
            </fieldset>
          )}
        </>
      )}
    </ItinerarySection>
  );
}
