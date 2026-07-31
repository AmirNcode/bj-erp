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
import { getCachedUser, getCachedProfile } from '@/lib/auth/context';
import { getWorkSettings } from '@/lib/actions/leave';
import { WORK_SETTINGS_FALLBACK } from '@/lib/leave/workSettings';
import { durationLabelsFrom } from '@/lib/leave/durationLabels';
import { ErrandRequestForm } from './ErrandRequestForm';
import { PageHeader } from '../../_components/PageHeader';
import { FormSkeleton } from '@/components/Skeletons';
import { Link } from '@/i18n/navigation';

type Props = {
  params: Promise<{ locale: string }>;
};

async function ErrandRequestData({ locale }: { locale: string }) {
  const t = await getTranslations('request');
  const tErrand = await getTranslations('errand');
  const tLeave = await getTranslations('leave');

  const user = await getCachedUser();
  if (!user) return null;

  const profile = await getCachedProfile(user.id);
  const calendarPref = profile?.calendar_pref ?? 'jalali';

  const workSettingsResult = await getWorkSettings();
  const workSettings = workSettingsResult.ok ? workSettingsResult.settings : WORK_SETTINGS_FALLBACK;

  const labels = {
    date: tErrand('date'),
    fromTime: tErrand('fromTime'),
    toTime: tErrand('toTime'),
    location: tErrand('location'),
    locationPlaceholder: tErrand('locationPlaceholder'),
    description: tErrand('description'),
    hint: tErrand('hint'),
    submit: tErrand('submit'),
    preview: tErrand('preview'),
    durationLabel: tErrand('durationLabel'),
    success: tErrand('success'),
    errorLabel: t('error'),
    validationSelectDate: tErrand('validationSelectDate'),
    validationTimes: tErrand('validationTimes'),
    validationLocation: tErrand('validationLocation'),
    ...durationLabelsFrom(tLeave),
  };

  return (
    <>
      <ErrandRequestForm
        workSettings={workSettings}
        calendarPref={calendarPref}
        labels={labels}
        locale={locale}
      />
      <p className="mt-6 text-sm">
        <Link href="/request" className="text-primary underline" data-testid="errand-to-daily">
          {tErrand('leaveLink')}
        </Link>
      </p>
    </>
  );
}

export default async function ErrandRequestPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('errand');

  return (
    <main className="p-6 max-w-3xl mx-auto">
      <PageHeader title={t('title')} />
      <Suspense fallback={<FormSkeleton />}>
        <ErrandRequestData locale={locale} />
      </Suspense>
    </main>
  );
}
