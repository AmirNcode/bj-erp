/**
 * Home = role-aware status board (FR-20). Composes existing reads via the pure
 * buildHomeBoard view-model. Navigation lives in the bottom-tab bar (Phase 4),
 * so this page no longer carries link buttons.
 */

export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getCachedUser, getCachedRoles, getCachedProfile } from '@/lib/auth/context';
import {
  getMyLeaveRequests,
  getMyBalances,
  getCalendarEntries,
  getPendingApprovals,
  getWorkSettings,
  getMyCoverDuties,
} from '@/lib/actions/leave';
import { getMyTeamDirectory } from '@/lib/actions/team-directory';
import { nowInAppTz } from '@/lib/appDate';
import { buildHomeBoard } from '@/lib/home/board';
import { durationLabelsFrom } from '@/lib/leave/durationLabels';
import { WORK_SETTINGS_FALLBACK } from '@/lib/leave/workSettings';
import { HomeBoard } from './HomeBoard';
import { PageHeader } from '../_components/PageHeader';
import { BoardSkeleton } from '@/components/Skeletons';
import { Skeleton } from '@/components/ui/skeleton';

type Props = {
  params: Promise<{ locale: string }>;
};

// ── async child that owns all data fetching ────────────────────────────────
async function HomeBoardData({
  locale,
  userId,
}: {
  locale: string;
  userId: string;
}) {
  const [t, tLeave, tRepl, tErrand, roles] = await Promise.all([
    getTranslations('home'),
    getTranslations('leave'),
    getTranslations('replacement'),
    getTranslations('errand'),
    getCachedRoles(userId),
  ]);
  const canApprove = roles.includes('admin') || roles.includes('manager');

  // Upcoming time off for the team directory. "Today" in the company
  // timezone, not the server's (Vercel = UTC).
  const now = nowInAppTz();
  const rangeStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  )
    .toISOString()
    .slice(0, 10);
  const rangeEnd = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 90)
  )
    .toISOString()
    .slice(0, 10);

  // One parallel burst — the profile and (for approvers) the pending list used
  // to run as extra serial round-trips after this batch.
  const [
    profile,
    requestsRes,
    balancesRes,
    calendarRes,
    directoryRes,
    approvalsRes,
    workSettingsRes,
    coverDutiesRes,
  ] = await Promise.all([
      getCachedProfile(userId),
      getMyLeaveRequests(),
      getMyBalances(),
      getCalendarEntries(rangeStart, rangeEnd),
      getMyTeamDirectory(),
      canApprove ? getPendingApprovals() : Promise.resolve(null),
      // Balances and durations are stored in minutes; rendering them as days and
      // hours needs the company day length. Joins the existing batch rather than
      // adding a serial round-trip.
      getWorkSettings(),
      // Requests this person is the named cover for, over the same 90-day window.
      getMyCoverDuties(rangeStart, rangeEnd),
    ]);

  const fullName = profile?.full_name ?? '';
  const pendingCount = approvalsRes?.ok ? approvalsRes.requests.length : 0;

  const board = buildHomeBoard({
    roles,
    requests: requestsRes.ok ? requestsRes.requests : [],
    balances: balancesRes.ok ? balancesRes.balances : [],
    team: calendarRes.ok ? calendarRes.entries : [],
    directory: directoryRes.ok ? directoryRes.members : [],
    pendingCount,
  });

  const labels = {
    balancesTitle: t('balancesTitle'),
    recentTitle: t('recentTitle'),
    teamTitle: t('teamTitle'),
    managerLabel: t('managerLabel'),
    teammatesLabel: t('teammatesLabel'),
    rolesLabel: t('rolesLabel'),
    titleLabel: t('titleLabel'),
    upcomingLabel: t('upcomingLabel'),
    noUpcoming: t('noUpcoming'),
    approvalsTitle: t('approvalsTitle'),
    approvalsPending: t('approvalsPending', { count: pendingCount }),
    noRecent: t('noRecent'),
    noTeam: t('noTeam'),
    requestDaily: t('requestDaily'),
    coveringTitle: tRepl('coveringTitle'),
    coveringFor: tRepl('coveringFor'),
    requestHourly: t('requestHourly'),
    requestErrand: t('requestErrand'),
    errandBadge: tErrand('badge'),
    ...durationLabelsFrom(tLeave), // provides days/hours/minutes/and
    statusPending: tLeave('status.pending'),
    statusApproved: tLeave('status.approved'),
    statusRejected: tLeave('status.rejected'),
    statusCancelled: tLeave('status.cancelled'),
  };

  return (
    <>
      <PageHeader title={t('greeting', { name: fullName })} />
      <HomeBoard
        board={board}
        labels={labels}
        locale={locale}
        hoursPerDay={
          workSettingsRes.ok ? workSettingsRes.settings.hoursPerDay : WORK_SETTINGS_FALLBACK.hoursPerDay
        }
        coverDuties={
          coverDutiesRes.ok
            ? coverDutiesRes.duties.map((d) => ({
                requestId: d.requestId,
                employeeName: d.employeeName,
                startDate: d.startDate,
                endDate: d.endDate,
                unit: d.unit,
                startTime: d.startTime,
                endTime: d.endTime,
              }))
            : []
        }
      />
    </>
  );
}

// ── page shell: paints instantly, all data streams in via Suspense ─────────
export default async function HomePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Local JWT check only — no network. The greeting needs the profile row, so
  // it lives inside the Suspense child; blocking the shell on that read cost
  // one Postgres round-trip before anything painted.
  const user = await getCachedUser();
  if (!user) return null;

  return (
    <main className="p-6 max-w-3xl mx-auto">
      <Suspense
        fallback={
          <div className="space-y-5">
            <Skeleton className="h-8 w-44" />
            <BoardSkeleton />
          </div>
        }
      >
        <HomeBoardData locale={locale} userId={user.id} />
      </Suspense>
    </main>
  );
}
