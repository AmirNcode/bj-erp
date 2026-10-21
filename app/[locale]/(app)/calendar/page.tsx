/**
 * Calendar page (FR-22) — viewer-scoped time-off for one month: the current one,
 * or the month containing `?month=YYYY-MM-DD` (the arrows beside the label).
 * Data comes from the reason-less team_leave_calendar view via getCalendarEntries,
 * which scopes rows by the viewer (employee = own + team; manager/security/admin =
 * everyone). No `reason` is ever fetched or shown here.
 */

export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getCachedUser, getCachedRoles } from '@/lib/auth/context';
import { getPendingApprovals } from '@/lib/actions/leave/approvals';
import { getCalendarEntries } from '@/lib/actions/leave/calendar';
import { getWorkSettings } from '@/lib/actions/leave/reference';
import { getVisibleSignatureConsents } from '@/lib/actions/leave/signatures';
import { WORK_SETTINGS_FALLBACK } from '@/lib/leave/workSettings';
import { currentCalendarMonthRange } from '@/lib/leave/calendarMonth';
import { nowInAppTz, todayInAppTz } from '@/lib/appDate';
import { isValidIsoDate } from '@/lib/leave/settings-validation';
import { CalendarView } from './CalendarView';
import { PageHeader } from '../_components/PageHeader';
import { ListSkeleton } from '@/components/Skeletons';

type Props = {
  params: Promise<{ locale: string }>;
  /** Any day of the month to show (Gregorian ISO); absent or invalid = this month. */
  searchParams: Promise<{ month?: string }>;
};

const shiftIso = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

// ── async child that owns all data fetching ────────────────────────────────
async function CalendarData({ locale, month }: { locale: string; month?: string }) {
  const t = await getTranslations('calendar');
  const user = await getCachedUser();
  if (!user) return null;

  const roles = await getCachedRoles(user.id);
  const canApprove = roles.includes('admin') || roles.includes('manager');
  const canReviewSignatures = canApprove || roles.includes('security');

  // "This month" in the company timezone, not the server's (UTC).
  const base = month && isValidIsoDate(month) ? new Date(`${month}T00:00:00Z`) : nowInAppTz();
  const { rangeStart, rangeEnd, monthLabel } = currentCalendarMonthRange(base, locale);
  const monthHref = (iso: string) => `/${locale}/calendar?month=${iso}`;

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
        decidableIds={decidableIds}
        signatureConsents={signatureConsents}
        todayIso={todayInAppTz()}
        prevHref={monthHref(shiftIso(rangeStart, -1))}
        nextHref={monthHref(shiftIso(rangeEnd, 1))}
      />
    </>
  );
}

// ── page shell ─────────────────────────────────────────────────────────────
export default async function CalendarPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { month } = await searchParams;
  setRequestLocale(locale);

  const t = await getTranslations('calendar');

  return (
    <main className="p-6 max-w-3xl mx-auto">
      <PageHeader title={t('title')} />
      <Suspense fallback={<ListSkeleton count={4} />}>
        <CalendarData locale={locale} month={month} />
      </Suspense>
    </main>
  );
}
