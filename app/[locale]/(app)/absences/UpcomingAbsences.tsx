'use client';

import { useTranslations } from 'next-intl';
import { CalendarDays } from 'lucide-react';
import type { Absence } from '@/lib/actions/absences';
import { Card } from '@/components/ui/card';
import { formatNumber } from '@/lib/i18n/format';
import { AbsenceRow } from './AbsencesBoard';

/**
 * The look-ahead under the day board: approved absences that start in the next
 * `days` days, in start-date order, so HR can enter them into the attendance
 * (fingerprint) system before the day.
 */
export function UpcomingAbsences({ absences, days, locale }: { absences: Absence[]; days: number; locale: string }) {
  const t = useTranslations('absences');
  const n = formatNumber(days, locale);
  return (
    <Card className="gap-0 px-4 py-2" data-testid="absences-upcoming">
      <h2 className="flex items-center gap-2 pt-2 text-sm font-semibold">
        <CalendarDays className="size-4" aria-hidden="true" />
        {t('upcomingTitle', { days: n })}
        <span className="text-muted-foreground">({formatNumber(absences.length, locale)})</span>
      </h2>
      <p className="pt-1 text-xs text-muted-foreground">{t('upcomingHint', { days: n })}</p>
      {absences.length === 0 ? (
        <p className="py-3 text-sm text-muted-foreground" data-testid="absences-upcoming-empty">
          {t('upcomingEmpty', { days: n })}
        </p>
      ) : (
        <ul className="divide-y">
          {absences.map((a) => (
            <AbsenceRow key={a.id} a={a} locale={locale} withDate />
          ))}
        </ul>
      )}
    </Card>
  );
}
