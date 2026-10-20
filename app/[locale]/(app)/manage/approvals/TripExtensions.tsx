'use client';

import { useTranslations } from 'next-intl';
import type { ExtendableTrip, PendingExtension } from '@/lib/actions/travel';
import { formatCalendarDate } from '@/lib/leave/calendarMonth';
import { Card, CardContent } from '@/components/ui/card';
import { ExtendTripDialog } from './ExtendTripDialog';
import { ExtensionDecisionCard } from './ExtensionDecisionCard';

/** FR-70 on the approvals page: HR's extension decisions, then the manager's extendable trips. */
export function TripExtensions({ trips, pending, locale }: {
  trips: ExtendableTrip[];
  pending: PendingExtension[];
  locale: string;
}) {
  const t = useTranslations('travel.extension');
  if (!trips.length && !pending.length) return null;
  return (
    <div className="mt-8 space-y-6" data-testid="trip-extensions">
      {pending.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">{t('sectionPending')}</h2>
          {pending.map((ext) => <ExtensionDecisionCard key={ext.extension_id} ext={ext} locale={locale} />)}
        </section>
      )}
      {trips.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">{t('sectionTrips')}</h2>
          {trips.map((trip) => (
            <Card key={trip.request_id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <div>
                  <div className="font-semibold">{trip.employee_name} — {trip.errand_location ?? '—'}</div>
                  <div className="text-muted-foreground">
                    {formatCalendarDate(trip.start_date, locale)} — {formatCalendarDate(trip.end_date, locale)}
                  </div>
                </div>
                <ExtendTripDialog trip={trip} locale={locale} />
              </CardContent>
            </Card>
          ))}
        </section>
      )}
    </div>
  );
}
