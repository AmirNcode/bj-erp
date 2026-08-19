/**
 * HR request review (FR-38) — `hr` and `admin` only.
 *
 * Managers keep `/manage/approvals`, which is scoped to their own reports and is
 * about *deciding*. This screen is about *reviewing and filing*: every request in
 * the company, every status, with the printable paper form behind each row.
 */

export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getCachedUser, getCachedRoles } from '@/lib/auth/context';
import { getReviewRequests, getWorkSettings } from '@/lib/actions/leave';
import { WORK_SETTINGS_FALLBACK } from '@/lib/leave/workSettings';
import { durationLabelsFrom } from '@/lib/leave/durationLabels';
import { PageHeader } from '../../_components/PageHeader';
import { ListSkeleton } from '@/components/Skeletons';
import { RequestsReview } from './RequestsReview';

type Props = { params: Promise<{ locale: string }> };

async function ReviewData({ locale }: { locale: string }) {
  const t = await getTranslations('review');
  const tLeave = await getTranslations('leave');
  const tErrand = await getTranslations('errand');

  const [result, settingsResult] = await Promise.all([
    getReviewRequests(),
    getWorkSettings(),
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
      labels={{
        search: t('search'),
        searchPlaceholder: t('searchPlaceholder'),
        status: t('status'),
        kind: t('kind'),
        all: t('all'),
        kindLeave: t('kindLeave'),
        kindErrand: t('kindErrand'),
        trackingNo: t('trackingNo'),
        employee: t('employee'),
        dates: t('dates'),
        duration: t('duration'),
        signatures: t('signatures'),
        print: t('print'),
        empty: t('empty'),
        signedRequester: t('signedRequester'),
        signedApprover: t('signedApprover'),
        errandBadge: tErrand('badge'),
        statusPending: tLeave('status.pending'),
        statusApproved: tLeave('status.approved'),
        statusRejected: tLeave('status.rejected'),
        statusCancelled: tLeave('status.cancelled'),
        ...durationLabelsFrom(tLeave),
      }}
    />
  );
}

export default async function RequestsReviewPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await getCachedUser();
  if (!user) redirect(`/${locale}/login`);

  // The /manage layout already admits admin, manager and hr. This narrows it
  // further: a manager has no business browsing every employee's private reason,
  // which this screen's rows are one click away from.
  const roles = await getCachedRoles(user.id);
  if (!roles.includes('hr') && !roles.includes('admin')) {
    redirect(`/${locale}/home`);
  }

  const t = await getTranslations('review');

  return (
    <main className="p-6 max-w-4xl mx-auto space-y-4">
      <PageHeader title={t('title')} />
      <p className="text-sm text-muted-foreground">{t('hint')}</p>
      <Suspense fallback={<ListSkeleton count={4} />}>
        <ReviewData locale={locale} />
      </Suspense>
    </main>
  );
}
