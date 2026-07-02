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
import { LeaveRequestForm } from './LeaveRequestForm';
import { MyRequestsList } from './MyRequestsList';
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
    : { weekendDays: [5, 6], holidays: [] as string[] };

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
    days: tLeave('days'),
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

      <div className="mt-10">
        <MyRequestsList
          requests={requests}
          labels={labels}
          calendarPref={calendarPref}
          locale={locale}
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
