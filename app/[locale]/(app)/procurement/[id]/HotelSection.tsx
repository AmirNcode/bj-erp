'use client';

/**
 * FR-73 hotel: one stay by default, "+ Add another stay" appends the next
 * below a divider (up to 10), "No hotel" for day trips (cost 0). Each stay has
 * its own cost; the total under them is what finance gets.
 */

import { useTranslations } from 'next-intl';
import { BedDouble, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatRials } from '@/lib/leave/perDiem';
import { formatNumber } from '@/lib/i18n/format';
import { emptyStay, MAX_STAYS, nights, type ItineraryDraft, type StayField } from '@/lib/travel/itinerary';
import { CheckboxRow, ItineraryField, ItinerarySection, type FieldErrors } from './ItineraryFields';

type Props = {
  requestId: string;
  locale: string;
  tripStart: string;
  tripEnd: string;
  draft: ItineraryDraft;
  setDraft: (update: (d: ItineraryDraft) => ItineraryDraft) => void;
  /** Sum of the stays' costs (0 with no hotel); null while none is entered. */
  hotelTotal: number | null;
  errors: FieldErrors;
};

export function HotelSection({
  requestId,
  locale,
  tripStart,
  tripEnd,
  draft,
  setDraft,
  hotelTotal,
  errors,
}: Props) {
  const t = useTranslations('travel');
  const ti = useTranslations('travel.itinerary');

  const tErr = useTranslations('travel.itinerary.errors');
  const setStay = (i: number, field: StayField | 'cost', value: string) =>
    setDraft((d) => ({ ...d, stays: d.stays.map((s, j) => (j === i ? { ...s, [field]: value } : s)) }));
  // The next stay starts where the last one ended, and runs to the trip's end if that is later.
  const addStay = () =>
    setDraft((d) => {
      const checkIn = d.stays.at(-1)?.check_out || tripStart;
      return { ...d, stays: [...d.stays, emptyStay(checkIn, tripEnd > checkIn ? tripEnd : '')] };
    });
  const removeStay = (i: number) => setDraft((d) => ({ ...d, stays: d.stays.filter((_, j) => j !== i) }));

  return (
    <ItinerarySection
      icon={<BedDouble />}
      title={ti('hotel')}
      testId="itinerary-hotel"
      aside={
        <CheckboxRow
          id="itinerary-no-hotel"
          label={ti('noHotel')}
          checked={draft.no_hotel}
          onChange={(no_hotel) => setDraft((d) => ({ ...d, no_hotel }))}
        />
      }
    >
      {!draft.no_hotel && (
        <>
          {errors.stays && <p className="text-xs text-destructive">{ti(`errors.${errors.stays}`)}</p>}
          <ol className="space-y-4">
            {draft.stays.map((stay, i) => {
              const f = (field: StayField, kind: 'text' | 'date' | 'tel' = 'text', ltr = false, className?: string) => (
                <ItineraryField
                  id={`stays-${i}-${field}`}
                  label={ti(`stayFields.${field}`)}
                  value={stay[field]}
                  onChange={(v) => setStay(i, field, v)}
                  error={errors[`stays.${i}.${field}`]}
                  kind={kind}
                  ltr={ltr}
                  locale={locale}
                  className={className}
                />
              );
              const n = nights(stay.check_in, stay.check_out);
              return (
                <li key={i} className="space-y-3 border-border [&:not(:first-child)]:border-t [&:not(:first-child)]:pt-4" data-testid={`stay-${i}`}>
                  {draft.stays.length > 1 && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-muted-foreground">
                        {ti('stay', { n: formatNumber(i + 1, locale) })}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeStay(i)}
                        className="text-destructive"
                        data-testid={`stay-${i}-remove`}
                      >
                        <Trash2 aria-hidden />
                        {ti('removeStay')}
                      </Button>
                    </div>
                  )}
                  <div className="grid gap-3 sm:grid-cols-2">
                    {f('name')}
                    {f('phone', 'tel')}
                    {f('address', 'text', false, 'sm:col-span-2')}
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {f('check_in', 'date')}
                    {f('check_out', 'date')}
                    {f('confirmation', 'text', true)}
                    <div className="min-w-0 space-y-1.5">
                      <Label htmlFor={`stays-${i}-cost`}>{t('hotelCost')}</Label>
                      <Input
                        id={`stays-${i}-cost`}
                        inputMode="numeric"
                        dir="ltr"
                        autoComplete="off"
                        value={stay.cost}
                        onChange={(e) => setStay(i, 'cost', e.target.value)}
                        placeholder="0"
                        aria-invalid={errors[`stays.${i}.cost`] ? true : undefined}
                        data-testid={`stays-${i}-cost`}
                      />
                      {errors[`stays.${i}.cost`] && (
                        <p className="text-xs text-destructive">{tErr(errors[`stays.${i}.cost`])}</p>
                      )}
                    </div>
                  </div>
                  {n !== null && n > 0 && (
                    <p className="text-xs text-muted-foreground">{ti('nights', { count: n })}</p>
                  )}
                </li>
              );
            })}
          </ol>
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            onClick={addStay}
            disabled={draft.stays.length >= MAX_STAYS}
            data-testid="stay-add"
          >
            <Plus aria-hidden />
            {ti('addStay')}
          </Button>
        </>
      )}
      <div
        className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg bg-secondary px-3 py-2"
        id={`hotel-${requestId}`}
        data-testid="hotel-total"
      >
        <span className="text-sm font-medium">{ti('totalHotelCost')}</span>
        <span className="text-base font-bold tabular-nums">{formatRials(hotelTotal ?? 0, locale)}</span>
        <span className="basis-full text-xs text-muted-foreground">{ti('totalHint')}</span>
      </div>
    </ItinerarySection>
  );
}
