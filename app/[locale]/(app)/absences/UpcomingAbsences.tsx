'use client';

import { useTranslations } from 'next-intl';
import { Briefcase, Palmtree } from 'lucide-react';
import type { Absence } from '@/lib/actions/absences';
import { Card } from '@/components/ui/card';
import { formatNumber } from '@/lib/i18n/format';
import { AbsenceRow } from './AbsencesBoard';

/**
 * Approved absences in the next `days` days (today included, so one already
 * under way shows too), split into work errands and leave, each in start-date
 * order — so HR can enter them into the attendance (fingerprint) system. Owner,
 * 2026-11-02: a fixed window, no picker; the calendar shows anything further.
 */
export function UpcomingAbsences({ absences, days, locale }: { absences: Absence[]; days: number; locale: string }) {
  const t = useTranslations('absences');
  const n = formatNumber(days, locale);
  const errands = absences.filter((a) => a.kind === 'errand');
  const leave = absences.filter((a) => a.kind !== 'errand');
  const section = (title: string, icon: React.ReactNode, list: Absence[], empty: string, testId: string) => (
    <section data-testid={testId}>
      <h3 className="flex items-center gap-2 pt-2 text-sm font-semibold">
        {icon}
        {title}
        <span className="text-muted-foreground">({formatNumber(list.length, locale)})</span>
      </h3>
      {list.length === 0 ? (
        <p className="py-3 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y">
          {list.map((a) => (
            <AbsenceRow key={a.id} a={a} locale={locale} withDate />
          ))}
        </ul>
      )}
    </section>
  );
  return (
    <Card className="gap-2 p-4" data-testid="absences-upcoming">
      <h2 className="text-lg font-semibold">{t('upcomingTitle', { days: n })}</h2>
      <p className="text-xs text-muted-foreground">{t('upcomingHint', { days: n })}</p>
      {section(t('errandsSection'), <Briefcase className="size-4" aria-hidden="true" />, errands, t('errandsEmpty', { days: n }), 'absences-upcoming-errands')}
      <div className="border-t" />
      {section(t('leaveSection'), <Palmtree className="size-4" aria-hidden="true" />, leave, t('leaveEmpty', { days: n }), 'absences-upcoming-leave')}
    </Card>
  );
}
