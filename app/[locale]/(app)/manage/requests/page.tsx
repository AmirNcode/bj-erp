/**
 * HR request review (FR-38) — needs the leave_requests permission (FR-55).
 *
 * Managers keep `/manage/approvals`, which is scoped to their own reports and is
 * about *deciding*. This screen is about *reviewing and filing*: every request in
 * the company, every status, with the printable paper form behind each row.
 */

export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getCachedUser, getCachedPermissions } from '@/lib/auth/context';
import { can } from '@/lib/permissions/catalog';
import { getWorkSettings } from '@/lib/actions/leave/reference';
import { getReviewRequests } from '@/lib/actions/leave/review';
import { getTravelTicks } from '@/lib/actions/travel';
import { WORK_SETTINGS_FALLBACK } from '@/lib/leave/workSettings';
import { PageHeader } from '../../_components/PageHeader';
import { ListSkeleton } from '@/components/Skeletons';
import { RequestsReview } from './RequestsReview';

type Props = { params: Promise<{ locale: string }> };

async function ReviewData({ locale, viewerId }: { locale: string; viewerId: string }) {

  const [result, settingsResult, travelTicks] = await Promise.all([
    getReviewRequests(),
    getWorkSettings(),
    getTravelTicks(),
  ]);

  if (!result.ok) {
    return (
      <p role="alert" className="text-sm text-destructive" data-testid="review-error">
        {result.error}
      </p>
    );
  }

  const hoursPerDay = settingsResult.ok
    ? settingsResult.settings.hoursPerDay
    : WORK_SETTINGS_FALLBACK.hoursPerDay;

  return (
    <RequestsReview
      requests={result.requests}
      locale={locale}
      hoursPerDay={hoursPerDay}
      travelTicks={travelTicks}
      viewerId={viewerId}
    />
  );
}

export default async function RequestsReviewPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await getCachedUser();
  if (!user) redirect(`/${locale}/login`);

  // The /manage layout also admits managers. This narrows it
  // further: a manager has no business browsing every employee's private reason,
  // which this screen's rows are one click away from.
  const perms = await getCachedPermissions(user.id);
  if (!can(perms, 'leave_requests', 'read')) {
    redirect(`/${locale}/home`);
  }

  const t = await getTranslations('review');

  return (
    <main className="p-6 max-w-4xl mx-auto space-y-4">
      <PageHeader title={t('title')} />
      <p className="text-sm text-muted-foreground">{t('hint')}</p>
      <Suspense fallback={<ListSkeleton count={4} />}>
        <ReviewData locale={locale} viewerId={user.id} />
      </Suspense>
    </main>
  );
}
