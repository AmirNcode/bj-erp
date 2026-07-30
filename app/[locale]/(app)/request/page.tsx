/**
 * Leave request page — server component.
 * Fetches leave types, work settings, and the caller's existing requests server-side.
 * Renders the client-side form + My Requests list.
 */

export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getCachedUser, getCachedProfile } from '@/lib/auth/context';
import {
  getActiveLeaveTypes,
  getMyLeaveRequests,
  getWorkSettings,
} from '@/lib/actions/leave';
import { WORK_SETTINGS_FALLBACK } from '@/lib/leave/workSettings';
import { LeaveRequestForm } from './LeaveRequestForm';
import { MyRequestsList } from './MyRequestsList';
import { durationLabelsFrom } from '@/lib/leave/durationLabels';
import { Link } from '@/i18n/navigation';
import { FormSkeleton, ListSkeleton } from '@/components/Skeletons';

function RequestPageSkeleton() {
  return (
    <>
      <FormSkeleton />
      <div className="mt-10">
        <ListSkeleton count={2} />
      </div>
    </>
  );
}

type Props = {
  params: Promise<{ locale: string }>;
};

// ── async child that owns all data fetching ────────────────────────────────
async function RequestPageData({ locale }: { locale: string }) {
  const t = await getTranslations('request');
  const tLeave = await getTranslations('leave');
  const tRepl = await getTranslations('replacement');
  const tHourly = await getTranslations('hourly');
  // Get the authenticated user
  const user = await getCachedUser();

  if (!user) return null;

  // Fetch calendar preference from profile
  const profile = await getCachedProfile(user.id);

  const calendarPref = profile?.calendar_pref ?? 'jalali';

  // Fetch everything in parallel
  const [leaveTypesResult, requestsResult, workSettingsResult] = await Promise.all([
    getActiveLeaveTypes(),
    getMyLeaveRequests(),
    getWorkSettings(),
  ]);

  const leaveTypes = leaveTypesResult.ok ? leaveTypesResult.types : [];
  const requests = requestsResult.ok ? requestsResult.requests : [];
  const workSettings = workSettingsResult.ok
    ? workSettingsResult.settings
    : WORK_SETTINGS_FALLBACK;

  const labels = {
    title: t('title'),
    leaveType: t('leaveType'),
    selectType: t('selectType'),
    dateRange: t('dateRange'),
    dayPart: t('dayPart'),
    dayPartFull: t('dayPartFull'),
    dayPartAm: t('dayPartAm'),
    dayPartPm: t('dayPartPm'),
    reason: t('reason'),
    submit: t('submit'),
    preview: t('preview'),
    workingDaysLabel: t('workingDaysLabel'),
    remainingBalanceLabel: t('remainingBalanceLabel'),
    noBalance: t('noBalance'),
    success: t('success'),
    errorLabel: t('error'),
    myRequests: t('myRequests'),
    noRequests: t('noRequests'),
    cancel: t('cancel'),
    cancelConfirm: t('cancelConfirm'),
    cancelApprovedConfirm: t('cancelApprovedConfirm'),
    cancelSuccess: t('cancelSuccess'),
    from: t('from'),
    to: t('to'),
    rejectedReason: t('rejectedReason'),
    validationSelectType: t('validationSelectType'),
    validationSelectDate: t('validationSelectDate'),
    statusPending: tLeave('status.pending'),
    statusApproved: tLeave('status.approved'),
    statusRejected: tLeave('status.rejected'),
    statusCancelled: tLeave('status.cancelled'),
    dayPartLabels: {
      full: tLeave('dayPart.full'),
      am: tLeave('dayPart.am'),
      pm: tLeave('dayPart.pm'),
    },
    replacementTitle: tRepl('title'),
    replacementHint: tRepl('hint'),
    replacementSearch: tRepl('search'),
    replacementNone: tRepl('none'),
    replacementOnLeave: tRepl('onLeave'),
    replacementLoading: tRepl('loading'),
    replacementEmpty: tRepl('empty'),
    ...durationLabelsFrom(tLeave), // days/hours/minutes/and
  };

  return (
    <>
      <LeaveRequestForm
        leaveTypes={leaveTypes}
        workSettings={workSettings}
        calendarPref={calendarPref}
        labels={labels}
        locale={locale}
      />

      <p className="mt-4 text-sm">
        <Link href="/request/hourly" className="text-primary underline" data-testid="daily-to-hourly">
          {tHourly('hourlyLink')}
        </Link>
      </p>

      <div className="mt-10">
        <MyRequestsList
          requests={requests}
          labels={labels}
          calendarPref={calendarPref}
          locale={locale}
          hoursPerDay={workSettings.hoursPerDay}
        />
      </div>
    </>
  );
}

// ── page shell ─────────────────────────────────────────────────────────────
export default async function RequestPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('request');

  return (
    <main className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">{t('title')}</h1>
      <Suspense fallback={<RequestPageSkeleton />}>
        <RequestPageData locale={locale} />
      </Suspense>
    </main>
  );
}
