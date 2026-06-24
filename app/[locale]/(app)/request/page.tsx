/**
 * Leave request page — server component.
 * Fetches leave types, work settings, and the caller's existing requests server-side.
 * Renders the client-side form + My Requests list.
 */

export const dynamic = 'force-dynamic';

import { getTranslations, setRequestLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import {
  getActiveLeaveTypes,
  getMyLeaveRequests,
  getWorkSettings,
} from '@/lib/actions/leave';
import { LeaveRequestForm } from './LeaveRequestForm';
import { MyRequestsList } from './MyRequestsList';

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function RequestPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('request');
  const tLeave = await getTranslations('leave');
  const supabase = await createClient();

  // Get the authenticated user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  // Fetch calendar preference from profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('calendar_pref')
    .eq('id', user.id)
    .single();

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
    workingDays: t('workingDays', { count: 0 }),
    remainingBalance: t('remainingBalance', { days: 0 }),
    noBalance: t('noBalance'),
    success: t('success'),
    errorLabel: t('error'),
    myRequests: t('myRequests'),
    noRequests: t('noRequests'),
    cancel: t('cancel'),
    cancelSuccess: t('cancelSuccess'),
    from: t('from'),
    to: t('to'),
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
    <main className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">{labels.title}</h1>

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
          locale={locale}
          calendarPref={calendarPref}
        />
      </div>
    </main>
  );
}
