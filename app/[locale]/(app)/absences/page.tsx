/**
 * Approved absences (FR-56). Security sees the same board on Home; this page
 * is the admin's way in (Manage group), and still opens for security.
 *
 * Who is out on one day with every approval in place: daily and hourly leave,
 * daily and hourly errands. Pending requests never show. The day is a URL
 * parameter (default today, Tehran), so the board can be reloaded or linked.
 */

export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getCachedUser, getCachedRoles } from '@/lib/auth/context';
import { getApprovedAbsences } from '@/lib/actions/absences';
import { todayInAppTz } from '@/lib/appDate';
import { isValidIsoDate } from '@/lib/leave/settings-validation';
import { PageHeader } from '../_components/PageHeader';
import { AbsencesBoard } from './AbsencesBoard';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ date?: string }>;
};

export default async function AbsencesPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await getCachedUser();
  if (!user) redirect(`/${locale}/login`);
  const roles = await getCachedRoles(user.id);
  if (!roles.includes('security') && !roles.includes('admin')) redirect(`/${locale}/home`);

  const { date: raw } = await searchParams;
  const today = todayInAppTz();
  const date = raw && isValidIsoDate(raw) ? raw : today;

  const [t, result] = await Promise.all([getTranslations('absences'), getApprovedAbsences(date)]);

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
    </div>
  );
}
