/**
 * Calendar page (FR-22) — viewer-scoped time-off for the current month.
 * Data comes from the reason-less team_leave_calendar view via getCalendarEntries,
 * which scopes rows by the viewer (employee = own + team; manager/security/admin =
 * everyone). No `reason` is ever fetched or shown here.
 */

export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getCachedUser, getCachedRoles } from '@/lib/auth/context';
import {
  getCalendarEntries,
  getPendingApprovals,
  getVisibleSignatureConsents,
  getWorkSettings,
} from '@/lib/actions/leave';
import { WORK_SETTINGS_FALLBACK } from '@/lib/leave/workSettings';
import { currentCalendarMonthRange } from '@/lib/leave/calendarMonth';
import { nowInAppTz, todayInAppTz } from '@/lib/appDate';
import { CalendarView } from './CalendarView';
import { PageHeader } from '../_components/PageHeader';
import { ListSkeleton } from '@/components/Skeletons';
import { signatureLabelsFrom } from '@/lib/leave/signatureLabels';

type Props = {
  params: Promise<{ locale: string }>;
};

// ── async child that owns all data fetching ────────────────────────────────
async function CalendarData({ locale }: { locale: string }) {
  const t = await getTranslations('calendar');
  const tLeave = await getTranslations('leave');
  const tApprovals = await getTranslations('approvals');
  const tErrand = await getTranslations('errand');
  const tSignature = await getTranslations('signature');
  const user = await getCachedUser();
  if (!user) return null;

  const roles = await getCachedRoles(user.id);
  const canApprove = roles.includes('admin') || roles.includes('manager');
  const canReviewSignatures = canApprove || roles.includes('security');

  // "This month" in the company timezone, not the server's (Vercel = UTC).
  const { rangeStart, rangeEnd, monthLabel } = currentCalendarMonthRange(nowInAppTz(), locale);

  const [result, workSettingsResult, approvalsResult, signaturesResult] = await Promise.all([
    getCalendarEntries(rangeStart, rangeEnd),
    getWorkSettings(),
    // Pending requests the viewer may decide (admin: all; manager: own reports)
    // — powers the approve/reject buttons on calendar cards. The SQL fn
    // re-checks permission on write, so this is display scoping only.
    canApprove ? getPendingApprovals() : Promise.resolve(null),
    canReviewSignatures
      ? getVisibleSignatureConsents(rangeStart, rangeEnd)
      : Promise.resolve(null),
  ]);
  const entries = result.ok ? result.entries : [];
  const loadError = result.ok ? null : result.error;
  const workSettings = workSettingsResult.ok
    ? workSettingsResult.settings
    : WORK_SETTINGS_FALLBACK;
  const decidableIds =
    approvalsResult && approvalsResult.ok ? approvalsResult.requests.map((r) => r.id) : [];
  const signatureConsents =
    signaturesResult && signaturesResult.ok ? signaturesResult.signatures : [];

  const labels = {
    empty: t('empty'),
    listView: t('listView'),
    monthView: t('monthView'),
    offOn: t('offOn'),
    noOffThisDay: t('noOffThisDay'),
    returns: t('returns'),
    statusPending: tLeave('status.pending'),
    statusApproved: tLeave('status.approved'),
    approve: tApprovals('approve'),
    reject: tApprovals('reject'),
    approveConfirm: tApprovals('approveConfirm'),
    rejectConfirm: tApprovals('rejectConfirm'),
    rejectReasonLabel: tApprovals('rejectReasonLabel'),
    rejectReasonPlaceholder: tApprovals('rejectReasonPlaceholder'),
    approveSuccess: tApprovals('approveSuccess'),
    rejectSuccess: tApprovals('rejectSuccess'),
    errandBadge: tErrand('badge'),
    requesterSignature: signatureLabelsFrom(tSignature, 'requesterTitle'),
    approverSignature: signatureLabelsFrom(tSignature, 'approverTitle'),
  };

  return (
    <>
      {loadError && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive mb-4">
          <strong>{t('error')}:</strong> {loadError}
        </div>
      )}
      <CalendarView
        entries={entries}
        locale={locale}
        rangeStart={rangeStart}
        rangeEnd={rangeEnd}
        monthLabel={monthLabel}
        workSettings={workSettings}
        labels={labels}
        decidableIds={decidableIds}
        signatureConsents={signatureConsents}
        todayIso={todayInAppTz()}
      />
    </>
  );
}

// ── page shell ─────────────────────────────────────────────────────────────
export default async function CalendarPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('calendar');

  return (
    <main className="p-6 max-w-3xl mx-auto">
      <PageHeader title={t('title')} />
      <Suspense fallback={<ListSkeleton count={4} />}>
        <CalendarData locale={locale} />
      </Suspense>
    </main>
  );
}
