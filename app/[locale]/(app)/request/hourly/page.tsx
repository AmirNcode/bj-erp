/**
 * Hourly leave request — مرخصی ساعتی, the client's BJ-F 50208 form.
 *
 * A separate screen from the daily one by decision D13: workers already know the
 * two paper forms, and each screen stays simple. The shared rules live in the SQL
 * writer (private.submit_leave_impl), not in a shared component.
 */

export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getCachedUser, getCachedProfile } from '@/lib/auth/context';
import {
  getActiveLeaveTypes,
  getWorkSettings,
} from '@/lib/actions/leave';
import { WORK_SETTINGS_FALLBACK } from '@/lib/leave/workSettings';
import { durationLabelsFrom } from '@/lib/leave/durationLabels';
import { HourlyRequestForm } from './HourlyRequestForm';
import { PageHeader } from '../../_components/PageHeader';
import { RequestTypeTabs } from '../_components/RequestTypeTabs';
import { FormSkeleton } from '@/components/Skeletons';

type Props = {
  params: Promise<{ locale: string }>;
};

async function HourlyRequestData({ locale }: { locale: string }) {
  const t = await getTranslations('request');
  const tHourly = await getTranslations('hourly');
  const tLeave = await getTranslations('leave');
  const tRepl = await getTranslations('replacement');

  const user = await getCachedUser();
  if (!user) return null;

  const profile = await getCachedProfile(user.id);
  const calendarPref = profile?.calendar_pref ?? 'jalali';

  const [leaveTypesResult, workSettingsResult] = await Promise.all([
    getActiveLeaveTypes(),
    getWorkSettings(),
  ]);

  // Only types the admin enabled for hourly. The SQL re-checks allow_hourly, so
  // this is display scoping — a hidden option is not a security boundary.
  const leaveTypes = (leaveTypesResult.ok ? leaveTypesResult.types : []).filter(
    (lt) => lt.allow_hourly
  );
  const workSettings = workSettingsResult.ok ? workSettingsResult.settings : WORK_SETTINGS_FALLBACK;

  const maxHours = Math.round((workSettings.maxHourlyMinutesPerDay / 60) * 10) / 10;

  const labels = {
    leaveType: t('leaveType'),
    selectType: t('selectType'),
    date: tHourly('date'),
    fromTime: tHourly('fromTime'),
    toTime: tHourly('toTime'),
    reason: t('reason'),
    submit: tHourly('submit'),
    preview: t('preview'),
    durationLabel: tHourly('durationLabel'),
    remainingBalanceLabel: t('remainingBalanceLabel'),
    noBalance: t('noBalance'),
    success: t('success'),
    errorLabel: t('error'),
    validationSelectType: t('validationSelectType'),
    validationSelectDate: t('validationSelectDate'),
    validationTimes: tHourly('validationTimes'),
    dailyLimitHint: tHourly('dailyLimitHint', { hours: maxHours }),
    replacementTitle: tRepl('title'),
    replacementHint: tRepl('hint'),
    replacementSearch: tRepl('search'),
    replacementNone: tRepl('none'),
    replacementOnLeave: tRepl('onLeave'),
    replacementLoading: tRepl('loading'),
    replacementEmpty: tRepl('empty'),
    ...durationLabelsFrom(tLeave),
  };

  if (leaveTypes.length === 0) {
    return (
      <p
        className="rounded-xl rounded-t-none border border-border bg-secondary/40 px-4 py-3 text-sm text-muted-foreground"
        data-testid="hourly-unavailable"
      >
        {tHourly('unavailable')}
      </p>
    );
  }

  return (
    <HourlyRequestForm
      leaveTypes={leaveTypes}
      workSettings={workSettings}
      calendarPref={calendarPref}
      labels={labels}
      locale={locale}
    />
  );
}

export default async function HourlyRequestPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('hourly');

  return (
    <main className="p-6 max-w-3xl mx-auto">
      <PageHeader title={t('title')} />
      <RequestTypeTabs active="hourly" />
      <Suspense fallback={<FormSkeleton className="rounded-t-none" />}>
        <HourlyRequestData locale={locale} />
      </Suspense>
    </main>
  );
}
