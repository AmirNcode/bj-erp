'use client';

/**
 * FR-70: HR's «نیاز به رزرو سفر» switch on an already-approved (or pending) daily
 * errand — for trips whose HR step nobody signed (Head of HR's own trip, admin
 * override) or that HR forgot to mark. Locked once procurement has started.
 */

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { getTravelMissingFields, setTravelBooking } from '@/lib/actions/travel';
import type { TravellerField } from '@/lib/travel/fields';

export function TravelTickToggle({ requestId, employeeId, ticked, started }: {
  requestId: string;
  employeeId: string;
  ticked: boolean;
  started: boolean;
}) {
  const t = useTranslations('travel');
  const locale = useLocale();
  const router = useRouter();
  const [checked, setChecked] = useState(ticked);
  const [missing, setMissing] = useState<TravellerField[]>([]);
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  const toggle = (on: boolean) => {
    setError('');
    startTransition(async () => {
      const res = await setTravelBooking(requestId, on);
      if (!res.ok) { setError(res.error); return; }
      setChecked(on);
      setMissing([]);
      if (on) {
        const m = await getTravelMissingFields(requestId);
        if (m.ok) setMissing(m.fields);
      }
      router.refresh();
    });
  };

  return (
    <div className="space-y-1 text-start text-sm">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          className="size-4"
          checked={checked}
          disabled={pending || started}
          onChange={(e) => toggle(e.target.checked)}
          data-testid={`travel-tick-${requestId}`}
        />
        <span>{t('tickLabel')}</span>
      </label>
      {started && <p className="text-xs text-muted-foreground">{t('startedHint')}</p>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {checked && missing.length > 0 && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status" data-testid={`travel-missing-${requestId}`}>
          {t('missingWarning', { fields: new Intl.ListFormat(locale, { type: 'conjunction' }).format(missing.map((f) => t(`fields.${f}`))) })}{' '}
          <Link href={`/${locale}/manage/employees/${employeeId}`} className="font-medium underline">
            {t('missingLink')}
          </Link>
        </p>
      )}
    </div>
  );
}
