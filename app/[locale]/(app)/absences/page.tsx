/**
 * Approved absences (FR-56), for absences read (FR-55; the admin implicitly).
 * Other holders (the security and hr presets) see the same board on Home; this
 * page is the admin's way in (Manage group), and still opens for them.
 *
 * Who is out on one day with every approval in place: daily and hourly leave,
 * daily and hourly errands. Pending requests never show. The day is a URL
 * parameter (default today, Tehran), so the board can be reloaded or linked.
 * Below it, the approved absences starting in the next 30 days (look-ahead).
 */

export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getCachedUser, getCachedPermissions } from '@/lib/auth/context';
import { can } from '@/lib/permissions/catalog';
import { getApprovedAbsences, getUpcomingAbsences } from '@/lib/actions/absences';
import { upcomingAbsenceWindow, UPCOMING_ABSENCE_DAYS } from '@/lib/absences/upcoming';
import { todayInAppTz } from '@/lib/appDate';
import { isValidIsoDate } from '@/lib/leave/settings-validation';
import { PageHeader } from '../_components/PageHeader';
import { AbsencesBoard } from './AbsencesBoard';
import { UpcomingAbsences } from './UpcomingAbsences';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ date?: string }>;
};

export default async function AbsencesPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await getCachedUser();
  if (!user) redirect(`/${locale}/login`);
  const perms = await getCachedPermissions(user.id);
  if (!can(perms, 'absences', 'read')) redirect(`/${locale}/home`);

  const { date: raw } = await searchParams;
  const today = todayInAppTz();
  const date = raw && isValidIsoDate(raw) ? raw : today;

  const ahead = upcomingAbsenceWindow(today);
  const [t, result, upcoming] = await Promise.all([
    getTranslations('absences'),
    getApprovedAbsences(date),
    getUpcomingAbsences(ahead.from, ahead.to),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-[900px] flex-col">
      <PageHeader title={t('title')} />
      {result.ok ? (
        <AbsencesBoard date={date} today={today} absences={result.absences} locale={locale} />
      ) : (
        <p role="alert" className="text-sm text-destructive" data-testid="absences-error">
          {result.error}
        </p>
      )}
      <div className="mt-4">
        {upcoming.ok ? (
          <UpcomingAbsences absences={upcoming.absences} days={UPCOMING_ABSENCE_DAYS} locale={locale} />
        ) : (
          <p role="alert" className="text-sm text-destructive">
            {upcoming.error}
          </p>
        )}
      </div>
    </div>
  );
}
