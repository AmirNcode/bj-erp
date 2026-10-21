/**
 * FR-70 booking detail: the trip, the traveller's details (read live from personal
 * information while the booking is open), and procurement's booking form — or,
 * after a cancellation, the amount lost.
 */

export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getCachedUser, getCachedPermissions } from '@/lib/auth/context';
import { can } from '@/lib/permissions/catalog';
import { getTravelBooking } from '@/lib/actions/travel';
import { formatCalendarDate } from '@/lib/leave/calendarMonth';
import { formatRials } from '@/lib/leave/perDiem';
import { formatSerial, formatSerialLocalized } from '@/lib/leave/serial';
import { hasItinerary } from '@/lib/travel/itinerary';
import { TravelItinerary } from '@/components/TravelItinerary';
import { TRAVELLER_FIELDS } from '@/lib/travel/fields';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '../../_components/PageHeader';
import { BookingForm } from './BookingForm';
import { SettleForm } from './SettleForm';

type Props = { params: Promise<{ locale: string; id: string }> };

export default async function BookingPage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const user = await getCachedUser();
  if (!user) redirect(`/${locale}/login`);
  const perms = await getCachedPermissions(user.id);
  if (!can(perms, 'travel_booking', 'edit')) redirect(`/${locale}/home`);

  const [t, tInfo, result] = await Promise.all([
    getTranslations('travel'),
    getTranslations('personalInfo'),
    getTravelBooking(id),
  ]);
  if (!result.ok) {
    return <p role="alert" className="text-sm text-destructive" data-testid="booking-error">{result.error}</p>;
  }
  const b = result.booking;
  const date = (d: string) => formatCalendarDate(d, locale);
  const rials = (v: number | null) => (v === null ? '—' : formatRials(v, locale));
  const traveller = b.traveller;
  const editable = b.state === 'to_book' || b.state === 'extension' || (b.state === 'done' && !!traveller);
  const value = (field: (typeof TRAVELLER_FIELDS)[number]) => {
    const v = traveller?.[field];
    if (!v) return <span className="text-destructive">{t('notRecorded')}</span>;
    if (field === 'birth_date') return date(v);
    if (field === 'gender') return tInfo(`choices.${v}`);
    return <span dir={field === 'full_name' ? undefined : 'ltr'}>{v}</span>;
  };

  const summary = (
          <>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-muted-foreground">{t('transport')}</dt>
              <dd>{b.transport ? t(`transportOptions.${b.transport}`) : '—'}</dd>
              <dt className="text-muted-foreground">{t('flightCost')}</dt><dd>{rials(b.flight_cost_rials)}</dd>
              <dt className="text-muted-foreground">{t('hotelCost')}</dt><dd>{rials(b.hotel_cost_rials)}</dd>
              {b.traveller_note && (<><dt className="text-muted-foreground">{t('travellerNote')}</dt><dd>{b.traveller_note}</dd></>)}
              {b.state === 'settled' && (<><dt className="text-muted-foreground">{t('lostAmount')}</dt><dd>{rials(b.lost_rials)}</dd></>)}
            </dl>
            {hasItinerary(b.itinerary) && (
              <TravelItinerary
                itinerary={b.itinerary}
                transport={b.transport}
                note={null}
                locale={locale}
                serial={formatSerialLocalized(b.serial_year, b.serial_seq, locale)}
                fileSerial={formatSerial(b.serial_year, b.serial_seq)}
                tripStart={b.start_date}
                tripEnd={b.end_date}
                testId="booking-itinerary"
              />
            )}
          </>
  );

  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4">
      <PageHeader title={`${b.employee_name} — ${b.errand_location ?? ''}`} />
      <Link href={`/${locale}/procurement`} className="text-sm text-primary hover:underline">← {t('procurementTitle')}</Link>

      <Card>
        <CardContent className="space-y-2 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="rounded bg-secondary px-2 py-0.5 text-xs font-medium" data-testid="booking-state">{t(`states.${b.state}`)}</span>
            <span className="font-mono text-xs text-muted-foreground" dir="ltr">{formatSerialLocalized(b.serial_year, b.serial_seq, locale)}</span>
          </div>
          <div>{t('tripDates')}: {date(b.start_date)} — {date(b.end_date)}</div>
          {b.description && <div>{t('description')}: {b.description}</div>}
          {b.extensions.map((e) => (
            <div key={e.new_end_date} className="rounded-md bg-amber-50 px-3 py-2 text-amber-900">
              {t('extendedTo', { date: date(e.new_end_date) })} — {e.reason}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 text-sm">
          <h2 className="font-semibold">{t('travellerDetails')}</h2>
          {traveller ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              {TRAVELLER_FIELDS.map((f) => (
                <div key={f} className="contents">
                  <dt className="text-muted-foreground">{t(`fields.${f}`)}</dt>
                  <dd data-testid={`traveller-${f}`}>{value(f)}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-muted-foreground">{t('detailsHidden')}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 text-sm">
          <h2 className="font-semibold">{t('booking')}</h2>
          {b.state === 'cancel_undo' ? (
            <>
              {summary}
              <SettleForm requestId={b.request_id} />
            </>
          ) : editable ? (
            <BookingForm
              requestId={b.request_id}
              locale={locale}
              tripStart={b.start_date}
              tripEnd={b.end_date}
              initial={{
                transport: b.transport,
                flightCostRials: b.flight_cost_rials,
                hotelCostRials: b.hotel_cost_rials,
                itinerary: b.itinerary,
                note: b.traveller_note,
                done: b.state === 'done',
              }}
            />
          ) : (
            summary
          )}
        </CardContent>
      </Card>
    </div>
  );
}
