'use client';

/**
 * FR-73: the traveller's itinerary — boarding-pass flight legs (or the company
 * car), hotel stays and procurement's other notes — with "Save as PDF" and
 * "Save as image". Export runs in the browser: html-to-image captures the card
 * (with a header naming the trip), jspdf wraps that image in an A4 page, so
 * Farsi text needs no PDF font. Both libraries load on click. No costs here.
 */

import { useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { BedDouble, Car, FileDown, ImageDown, Phone, Plane, StickyNote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Transport } from '@/lib/actions/travel';
import { formatCalendarDate } from '@/lib/leave/calendarMonth';
import { nights, type FlightLeg, type Itinerary } from '@/lib/travel/itinerary';

type Props = {
  itinerary: Itinerary;
  transport: Transport | null;
  note: string | null;
  locale: string;
  /** Tracking number as shown, e.g. ۱۴۰۵-۰۰۱۱; also names the files. */
  serial: string;
  /** Latin tracking number for the file name, e.g. 1405-0011. */
  fileSerial: string;
  tripStart: string;
  tripEnd: string;
  testId?: string;
};

const Ltr = ({ children }: { children: ReactNode }) => <bdi dir="ltr">{children}</bdi>;

export function TravelItinerary({ itinerary, transport, note, locale, serial, fileSerial, tripStart, tripEnd, testId }: Props) {
  const t = useTranslations('travel.itinerary');
  const tTravel = useTranslations('travel');
  const cardRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<'pdf' | 'jpg' | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [failed, setFailed] = useState(false);
  const date = (iso?: string) => (iso ? formatCalendarDate(iso, locale) : '');

  const leg = (f: FlightLeg) => (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 px-4 py-3" data-testid={`itinerary-leg-${f.leg}`}>
      <div className="min-w-0">
        <p className="text-xl font-bold tabular-nums"><Ltr>{f.departs ?? '—'}</Ltr></p>
        <p className="truncate text-xs text-muted-foreground">{[f.from, date(f.date)].filter(Boolean).join(' · ')}</p>
      </div>
      <div className="flex flex-col items-center text-center text-primary">
        <Plane aria-hidden className="size-5 ltr:-scale-x-100" />
        {f.flight_no && <span className="text-xs font-semibold"><Ltr>{f.flight_no}</Ltr></span>}
        <span className="text-[11px] text-muted-foreground">{f.airline || t(f.leg)}</span>
      </div>
      <div className="min-w-0 text-end">
        <p className="text-xl font-bold tabular-nums"><Ltr>{f.arrives ?? '—'}</Ltr></p>
        <p className="truncate text-xs text-muted-foreground">{f.to}</p>
      </div>
    </div>
  );

  const flights = transport === 'flight' ? itinerary.flights ?? [] : [];
  const car = transport === 'company_car' ? itinerary.car : undefined;
  const stays = itinerary.stays ?? [];
  const pickup = (place?: string, d?: string, time?: string) =>
    [date(d), time, place].filter(Boolean).length > 0 && (
      <span>
        {date(d)} {time && <Ltr>{time}</Ltr>} {place && <>· {place}</>}
      </span>
    );

  const save = async (kind: 'pdf' | 'jpg') => {
    if (!cardRef.current || busy) return;
    setBusy(kind);
    setFailed(false);
    setCapturing(true);
    try {
      // Let the header render before the capture.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const { toJpeg } = await import('html-to-image');
      const node = cardRef.current;
      const dataUrl = await toJpeg(node, { quality: 0.95, pixelRatio: 2, backgroundColor: '#ffffff' });
      const name = `itinerary-${fileSerial}`;
      if (kind === 'jpg') {
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `${name}.jpg`;
        a.click();
      } else {
        const { jsPDF } = await import('jspdf');
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        const margin = 12;
        const width = doc.internal.pageSize.getWidth() - margin * 2;
        const height = (node.offsetHeight / node.offsetWidth) * width;
        doc.addImage(dataUrl, 'JPEG', margin, margin, width, height);
        await doc.save(`${name}.pdf`, { returnPromise: true });
      }
    } catch {
      setFailed(true);
    } finally {
      setCapturing(false);
      setBusy(null);
    }
  };

  return (
    <div className="mt-1 space-y-2" data-testid={testId}>
      <div ref={cardRef} className="overflow-hidden rounded-xl border border-border bg-card text-sm">
        {capturing && (
          <div className="space-y-0.5 border-b border-border bg-primary px-4 py-3 text-primary-foreground">
            <p className="font-bold">{t('title')}</p>
            <p className="text-xs">
              {t('tracking')}: <Ltr>{serial}</Ltr> · {t('tripDates')}: {date(tripStart)} — {date(tripEnd)}
            </p>
          </div>
        )}
        {flights.map((f, i) => (
          <div key={f.leg} className={i > 0 ? 'border-t border-dashed border-border' : undefined}>
            {leg(f)}
          </div>
        ))}
        {car && (
          <div className="flex gap-3 px-4 py-3" data-testid="itinerary-car">
            <Car aria-hidden className="size-5 shrink-0 text-primary" />
            <div className="min-w-0 space-y-0.5">
              <p className="font-semibold">
                {[tTravel('transportOptions.company_car'), car.vehicle].filter(Boolean).join(' · ')}
                {car.plate && <> · <Ltr>{car.plate}</Ltr></>}
              </p>
              {(car.driver_name || car.driver_mobile) && (
                <p className="text-xs text-muted-foreground">
                  {car.driver_name}{' '}
                  {car.driver_mobile && (
                    <a href={`tel:${car.driver_mobile}`} className="inline-flex items-center gap-1 text-primary" aria-label={`${t('call')} ${car.driver_mobile}`}>
                      <Phone aria-hidden className="size-3" />
                      <Ltr>{car.driver_mobile}</Ltr>
                    </a>
                  )}
                </p>
              )}
              {pickup(car.pickup_place, car.pickup_date, car.pickup_time) && (
                <p className="text-xs">{t('pickup')}: {pickup(car.pickup_place, car.pickup_date, car.pickup_time)}</p>
              )}
              {!itinerary.one_way && pickup(car.return_place, car.return_date, car.return_time) && (
                <p className="text-xs">{t('returnPickup')}: {pickup(car.return_place, car.return_date, car.return_time)}</p>
              )}
            </div>
          </div>
        )}
        {stays.map((s, i) => {
          const n = nights(s.check_in, s.check_out);
          return (
            <div key={i} className="flex gap-3 border-t border-border px-4 py-3 first:border-t-0" data-testid={`itinerary-stay-${i}`}>
              <BedDouble aria-hidden className="size-5 shrink-0 text-primary" />
              <div className="min-w-0 space-y-0.5">
                <p className="font-semibold">{s.name ?? t('hotel')}</p>
                {(s.address || s.phone) && (
                  <p className="text-xs text-muted-foreground">
                    {s.address}
                    {s.address && s.phone && ' · '}
                    {s.phone && <a href={`tel:${s.phone}`} className="text-primary"><Ltr>{s.phone}</Ltr></a>}
                  </p>
                )}
                {(s.check_in || s.check_out) && (
                  <p className="text-xs">
                    {date(s.check_in)} — {date(s.check_out)}
                    {n !== null && n > 0 && <> · {t('nights', { count: n })}</>}
                  </p>
                )}
                {s.confirmation && (
                  <p className="text-xs text-muted-foreground">
                    {t('stayFields.confirmation')}: <Ltr>{s.confirmation}</Ltr>
                  </p>
                )}
              </div>
            </div>
          );
        })}
        {itinerary.booking_ref && (
          <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
            {t('bookingRef')}: <Ltr>{itinerary.booking_ref}</Ltr>
          </p>
        )}
        {note && (
          <p className="flex gap-2 border-t border-border px-4 py-2 text-xs whitespace-pre-line">
            <StickyNote aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <span>{note}</span>
          </p>
        )}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" size="sm" disabled={!!busy} onClick={() => save('pdf')} data-testid="itinerary-save-pdf">
          <FileDown aria-hidden />
          {busy === 'pdf' ? t('exporting') : t('savePdf')}
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={!!busy} onClick={() => save('jpg')} data-testid="itinerary-save-image">
          <ImageDown aria-hidden />
          {busy === 'jpg' ? t('exporting') : t('saveImage')}
        </Button>
      </div>
      {failed && <p role="alert" className="text-xs text-destructive">{t('exportFailed')}</p>}
    </div>
  );
}
