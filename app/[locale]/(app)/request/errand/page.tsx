/**
 * Hourly work errand — ماموریت ساعتی, the client's BJ-F 50207 form.
 *
 * A third screen alongside the two leave forms, for the same reason they are
 * separate (D13 of the leave v2 spec): workers already know the paper forms, and
 * each screen stays simple. An errand is WORK — no leave type, no balance line,
 * no replacement picker.
 */

export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getCachedUser } from '@/lib/auth/context';
import { getWorkSettings } from '@/lib/actions/leave/reference';
import { isCallerHrHead } from '@/lib/actions/approval-delegation';
import { WORK_SETTINGS_FALLBACK } from '@/lib/leave/workSettings';
import { ErrandRequestForm } from './ErrandRequestForm';
import { PageHeader } from '../../_components/PageHeader';
import { RequestTypeTabs } from '../_components/RequestTypeTabs';
import { FormSkeleton } from '@/components/Skeletons';

type Props = {
  params: Promise<{ locale: string }>;
};

async function ErrandRequestData({ locale }: { locale: string }) {

  const user = await getCachedUser();
  if (!user) return null;

  const [workSettingsResult, perDiemAllowed] = await Promise.all([getWorkSettings(), isCallerHrHead()]);
  const workSettings = workSettingsResult.ok ? workSettingsResult.settings : WORK_SETTINGS_FALLBACK;

  return (
    <ErrandRequestForm
      workSettings={workSettings}
      locale={locale}
      perDiemAllowed={perDiemAllowed}
    />
  );
}

export default async function ErrandRequestPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('errand');

  return (
    <main className="p-6 max-w-3xl mx-auto">
      <PageHeader title={t('title')} />
      <RequestTypeTabs active="errand" />
      <Suspense fallback={<FormSkeleton className="rounded-t-none" />}>
        <ErrandRequestData locale={locale} />
      </Suspense>
    </main>
  );
}
