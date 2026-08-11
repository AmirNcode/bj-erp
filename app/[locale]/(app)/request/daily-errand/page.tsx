export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getCachedUser } from '@/lib/auth/context';
import { getWorkSettings } from '@/lib/actions/leave';
import { WORK_SETTINGS_FALLBACK } from '@/lib/leave/workSettings';
import { durationLabelsFrom } from '@/lib/leave/durationLabels';
import { signatureLabelsFrom } from '@/lib/leave/signatureLabels';
import { PageHeader } from '../../_components/PageHeader';
import { FormSkeleton } from '@/components/Skeletons';
import { RequestTypeTabs } from '../_components/RequestTypeTabs';
import { DailyErrandRequestForm } from './DailyErrandRequestForm';

type Props = {
  params: Promise<{ locale: string }>;
};

async function DailyErrandData({ locale }: { locale: string }) {
  const t = await getTranslations('request');
  const tDailyErrand = await getTranslations('dailyErrand');
  const tLeave = await getTranslations('leave');
  const tSignature = await getTranslations('signature');

  const user = await getCachedUser();
  if (!user) return null;

  const workSettingsResult = await getWorkSettings();
  const workSettings = workSettingsResult.ok
    ? workSettingsResult.settings
    : WORK_SETTINGS_FALLBACK;

  const labels = {
    dateRange: t('dateRange'),
    startDate: t('startDate'),
    endDate: t('endDate'),
    location: tDailyErrand('location'),
    locationPlaceholder: tDailyErrand('locationPlaceholder'),
    description: tDailyErrand('description'),
    hint: tDailyErrand('hint'),
    submit: tDailyErrand('submit'),
    requestingLabel: t('requestingLabel'),
    success: tDailyErrand('success'),
    errorLabel: t('error'),
    validationSelectDate: tDailyErrand('validationSelectDate'),
    validationLocation: tDailyErrand('validationLocation'),
    signature: signatureLabelsFrom(tSignature),
    ...durationLabelsFrom(tLeave),
  };

  return (
    <DailyErrandRequestForm
      workSettings={workSettings}
      labels={labels}
      locale={locale}
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
