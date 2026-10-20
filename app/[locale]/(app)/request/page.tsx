/**
 * Leave request page — server component.
 * Fetches leave types, work settings, and the caller's existing requests server-side.
 * Renders the client-side form + My Requests list.
 */

export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getCachedUser } from '@/lib/auth/context';
import { getActiveLeaveTypes, getWorkSettings } from '@/lib/actions/leave/reference';
import { getMyLeaveRequests } from '@/lib/actions/leave/requests';
import { getMyTravelBookings } from '@/lib/actions/travel';
import { WORK_SETTINGS_FALLBACK } from '@/lib/leave/workSettings';
import { LeaveRequestForm } from './LeaveRequestForm';
import { MyRequestsList } from './MyRequestsList';
import { durationLabelsFrom } from '@/lib/leave/durationLabels';
import { signatureLabelsFrom } from '@/lib/leave/signatureLabels';
import { RequestTypeTabs } from './_components/RequestTypeTabs';
import { ListSkeleton } from '@/components/Skeletons';
import { CollapsibleSection } from '@/components/CollapsibleSection';

// Two section headers: both sections load closed.
function RequestPageSkeleton() {
  return <ListSkeleton count={2} />;
}

type Props = {
  params: Promise<{ locale: string }>;
  /** `form=1` opens the new-request section; `all=1` opens My Requests with every request. */
  searchParams: Promise<{ form?: string; all?: string }>;
};

// ── async child that owns all data fetching ────────────────────────────────
async function RequestPageData({
  locale,
  openForm,
  showAll,
}: {
  locale: string;
  openForm: boolean;
  showAll: boolean;
}) {
  const t = await getTranslations('request');
  const tLeave = await getTranslations('leave');
  const tRepl = await getTranslations('replacement');
  const tErrand = await getTranslations('errand');
  const tSignature = await getTranslations('signature');
  // Get the authenticated user
  const user = await getCachedUser();

  if (!user) return null;

  // Fetch everything in parallel
  const [leaveTypesResult, requestsResult, workSettingsResult, travelBookings] = await Promise.all([
    getActiveLeaveTypes(),
    getMyLeaveRequests(),
    getWorkSettings(),
    getMyTravelBookings(),
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
    startDate: t('startDate'),
    endDate: t('endDate'),
    dayPart: t('dayPart'),
    dayPartFull: t('dayPartFull'),
    dayPartAm: t('dayPartAm'),
    dayPartPm: t('dayPartPm'),
    reason: t('reason'),
    submit: t('submit'),
    preview: t('preview'),
    workingDaysLabel: t('workingDaysLabel'),
    requestingLabel: t('requestingLabel'),
    remainingBalanceLabel: t('remainingBalanceLabel'),
    unpaidTimeOffLabel: t('unpaidTimeOffLabel'),
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
    replacementSelect: tRepl('select'),
    replacementNoReplacement: tRepl('noReplacement'),
    replacementOnLeave: tRepl('onLeave'),
    replacementLoading: tRepl('loading'),
    replacementEmpty: tRepl('empty'),
    coverLabel: tRepl('coverLabel'),
    trackingNo: tLeave('trackingNo'),
    errandBadge: tErrand('badge'),
    errandLocation: tErrand('location'),
    requesterSignature: signatureLabelsFrom(tSignature, 'requesterTitle'),
    approverSignature: signatureLabelsFrom(tSignature, 'approverTitle'),
    signature: signatureLabelsFrom(tSignature),
    ...durationLabelsFrom(tLeave), // days/hours/minutes/and
  };

  return (
    <div className="space-y-4">
      {/* Both sections start closed (My Requests opens itself when something is
          pending). The tabs live inside: the other request types are pages. */}
      <CollapsibleSection title={t('newRequestSection')} defaultOpen={openForm} testId="new-request">
        <RequestTypeTabs active="daily" />
        <LeaveRequestForm
          leaveTypes={leaveTypes}
          workSettings={workSettings}
          labels={labels}
          locale={locale}
        />
      </CollapsibleSection>

      <MyRequestsList
        // A new `?all=1` must re-run the list's opening defaults.
        key={showAll ? 'all' : 'default'}
        requests={requests}
        labels={labels}
        locale={locale}
        hoursPerDay={workSettings.hoursPerDay}
        showAll={showAll}
        travelBookings={travelBookings}
      />
    </div>
  );
}

// ── page shell ─────────────────────────────────────────────────────────────
export default async function RequestPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { form, all } = await searchParams;
  setRequestLocale(locale);

  const t = await getTranslations('request');

  return (
    <main className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">{t('title')}</h1>
      <Suspense fallback={<RequestPageSkeleton />}>
        <RequestPageData locale={locale} openForm={form === '1'} showAll={all === '1'} />
      </Suspense>
    </main>
  );
}
