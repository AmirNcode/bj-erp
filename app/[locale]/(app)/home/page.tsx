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
} from '@/lib/actions/leave';
import { getMyTeamDirectory } from '@/lib/actions/team-directory';
import { nowInAppTz } from '@/lib/appDate';
import { buildHomeBoard } from '@/lib/home/board';
import { HomeBoard } from './HomeBoard';
import { PageHeader } from '../_components/PageHeader';
import { BoardSkeleton } from '@/components/Skeletons';

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
  const t = await getTranslations('home');
  const tLeave = await getTranslations('leave');

  const roles = await getCachedRoles(userId);
  const canApprove = roles.includes('admin') || roles.includes('manager');

  const profile = await getCachedProfile(userId);
  const calendarPref = profile?.calendar_pref ?? 'jalali';

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

  const [requestsRes, balancesRes, calendarRes, directoryRes] = await Promise.all([
    getMyLeaveRequests(),
    getMyBalances(),
    getCalendarEntries(rangeStart, rangeEnd),
    getMyTeamDirectory(),
  ]);

  let pendingCount = 0;
  if (canApprove) {
    const approvals = await getPendingApprovals();
    pendingCount = approvals.ok ? approvals.requests.length : 0;
  }

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
    days: tLeave('days'),
    statusPending: tLeave('status.pending'),
    statusApproved: tLeave('status.approved'),
    statusRejected: tLeave('status.rejected'),
    statusCancelled: tLeave('status.cancelled'),
  };

  return <HomeBoard board={board} labels={labels} locale={locale} calendarPref={calendarPref} />;
}

// ── page shell: resolves locale then streams ───────────────────────────────
export default async function HomePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('home');

  // We need the user's name for the greeting header.
  // Read it here so the header can render immediately (outside Suspense).
  const user = await getCachedUser();
  if (!user) return null;

  const profile = await getCachedProfile(user.id);
  const fullName = profile?.full_name ?? '';

  return (
    <main className="p-6 max-w-3xl mx-auto">
      <PageHeader title={t('greeting', { name: fullName })} />
      <Suspense fallback={<BoardSkeleton />}>
        <HomeBoardData locale={locale} userId={user.id} />
      </Suspense>
    </main>
  );
}
