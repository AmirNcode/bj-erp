export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getCachedUser } from '@/lib/auth/context';
import { getWorkSettings } from '@/lib/actions/leave/reference';
import { isCallerHrHead } from '@/lib/actions/approval-delegation';
import { WORK_SETTINGS_FALLBACK } from '@/lib/leave/workSettings';
import { PageHeader } from '../../_components/PageHeader';
import { FormSkeleton } from '@/components/Skeletons';
import { RequestTypeTabs } from '../_components/RequestTypeTabs';
import { DailyErrandRequestForm } from './DailyErrandRequestForm';

type Props = {
  params: Promise<{ locale: string }>;
};

async function DailyErrandData({ locale }: { locale: string }) {

  const user = await getCachedUser();
  if (!user) return null;

  const [workSettingsResult, perDiemAllowed] = await Promise.all([getWorkSettings(), isCallerHrHead()]);
  const workSettings = workSettingsResult.ok
    ? workSettingsResult.settings
    : WORK_SETTINGS_FALLBACK;

  return (
    <DailyErrandRequestForm
      workSettings={workSettings}
      locale={locale}
      perDiemAllowed={perDiemAllowed}
    />
  );
}

export default async function DailyErrandPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('dailyErrand');

  return (
    <main className="p-6 max-w-3xl mx-auto">
      <PageHeader title={t('title')} />
      <RequestTypeTabs active="dailyErrand" />
      <Suspense fallback={<FormSkeleton className="rounded-t-none" />}>
        <DailyErrandData locale={locale} />
      </Suspense>
    </main>
  );
}
