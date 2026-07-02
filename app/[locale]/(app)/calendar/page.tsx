/**
 * Calendar page (FR-22) — viewer-scoped time-off for the current month.
 * Data comes from the reason-less team_leave_calendar view via getCalendarEntries,
 * which scopes rows by the viewer (employee = own + team; manager/security/admin =
 * everyone). No `reason` is ever fetched or shown here.
 */

export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getCachedUser, getCachedProfile, getCachedRoles } from '@/lib/auth/context';
import { getCalendarEntries, getPendingApprovals, getWorkSettings } from '@/lib/actions/leave';
import { currentCalendarMonthRange } from '@/lib/leave/calendarMonth';
import { nowInAppTz, todayInAppTz } from '@/lib/appDate';
import { CalendarView } from './CalendarView';
import { PageHeader } from '../_components/PageHeader';
import { ListSkeleton } from '@/components/Skeletons';

type Props = {
  params: Promise<{ locale: string }>;
};

// ── async child that owns all data fetching ────────────────────────────────
async function CalendarData({ locale }: { locale: string }) {
  const t = await getTranslations('calendar');
  const tLeave = await getTranslations('leave');
  const tApprovals = await getTranslations('approvals');
  const user = await getCachedUser();
  if (!user) return null;

  const profile = await getCachedProfile(user.id);
  const calendarPref = profile?.calendar_pref ?? 'jalali';
  const roles = await getCachedRoles(user.id);
  const canApprove = roles.includes('admin') || roles.includes('manager');

  // "This month" in the company timezone, not the server's (Vercel = UTC).
  const { rangeStart, rangeEnd, monthLabel } = currentCalendarMonthRange(calendarPref, nowInAppTz(), locale);

  const [result, workSettingsResult, approvalsResult] = await Promise.all([
    getCalendarEntries(rangeStart, rangeEnd),
    getWorkSettings(),
    // Pending requests the viewer may decide (admin: all; manager: own reports)
    // — powers the approve/reject buttons on calendar cards. The SQL fn
    // re-checks permission on write, so this is display scoping only.
    canApprove ? getPendingApprovals() : Promise.resolve(null),
  ]);
  const entries = result.ok ? result.entries : [];
  const loadError = result.ok ? null : result.error;
  const workSettings = workSettingsResult.ok
    ? workSettingsResult.settings
    : { weekendDays: [5], holidays: [] as string[] };
  const decidableIds =
    approvalsResult && approvalsResult.ok ? approvalsResult.requests.map((r) => r.id) : [];

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
    approveSuccess: tApprovals('approveSuccess'),
    rejectSuccess: tApprovals('rejectSuccess'),
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
        calendarPref={calendarPref}
        rangeStart={rangeStart}
        rangeEnd={rangeEnd}
        monthLabel={monthLabel}
        workSettings={workSettings}
        labels={labels}
        decidableIds={decidableIds}
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
