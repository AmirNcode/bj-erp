/**
 * Home = role-aware dashboard (FR-20; 2026-10 redesign). Approvers (admin, hr,
 * manager) get today's pulse band and the pending queue with inline decisions;
 * everyone gets their balance usage, the next official holiday and their recent
 * requests. Request entry points live on the Request page, not here.
 */

export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getCachedUser, getCachedRoles, getCachedProfile } from '@/lib/auth/context';
import { getPendingApprovals } from '@/lib/actions/leave/approvals';
import { getCalendarEntries } from '@/lib/actions/leave/calendar';
import { getWorkSettings } from '@/lib/actions/leave/reference';
import { getMyLeaveRequests, getMyCoverDuties } from '@/lib/actions/leave/requests';
import { getMyTeamDirectory } from '@/lib/actions/team-directory';
import {
  getMyBalanceUsage,
  getNextHoliday,
  getRequesterBalances,
  getTodayPulse,
} from '@/lib/actions/home';
import { APP_TIME_ZONE, nowInAppTz, todayInAppTz } from '@/lib/appDate';
import { buildHomeBoard } from '@/lib/home/board';
import { daysAgo, shortStaffedOthers } from '@/lib/home/pulse';
import { durationLabelsFrom } from '@/lib/leave/durationLabels';
import { signatureLabelsFrom } from '@/lib/leave/signatureLabels';
import { formatDuration } from '@/lib/leave/duration';
import { formatCalendarDate } from '@/lib/leave/calendarMonth';
import { formatTimeRange } from '@/lib/leave/formatTimeRange';
import { formatNumber, localizedLeaveTypeName } from '@/lib/i18n/format';
import { WORK_SETTINGS_FALLBACK } from '@/lib/leave/workSettings';
import { HomeBoard, type PulseCards } from './HomeBoard';
import { ProfileReminderCard } from './ProfileReminderCard';
import { ClearanceAwaitingCard } from './ClearanceAwaitingCard';
import { createClient } from '@/lib/supabase/server';
import type { PendingRow } from './PendingApprovalsCard';
import { BoardSkeleton } from '@/components/Skeletons';
import { Skeleton } from '@/components/ui/skeleton';

type Props = {
  params: Promise<{ locale: string }>;
};

/** Most pending rows shown inline; the rest are one link away. */
const PENDING_ROWS = 5;

function greetingKey(at: Date = new Date()) {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', { timeZone: APP_TIME_ZONE, hour: 'numeric', hourCycle: 'h23' }).format(at)
  );
  if (hour >= 5 && hour < 12) return 'greetingMorning' as const;
  if (hour >= 12 && hour < 16) return 'greetingNoon' as const;
  if (hour >= 16 && hour < 20) return 'greetingEvening' as const;
  return 'greetingNight' as const;
}

// ── async child that owns all data fetching ────────────────────────────────
async function HomeBoardData({ locale, userId }: { locale: string; userId: string }) {
  const [t, tLeave, tRepl, tErrand, tApprovals, tSignature, roles] = await Promise.all([
    getTranslations('home'),
    getTranslations('leave'),
    getTranslations('replacement'),
    getTranslations('errand'),
    getTranslations('approvals'),
    getTranslations('signature'),
    getCachedRoles(userId),
  ]);
  const canApprove =
    roles.includes('admin') || roles.includes('manager') || roles.includes('hr');

  // Upcoming time off for the team directory (non-approvers only). "Today" in
  // the company timezone, not the server's (UTC).
  const now = nowInAppTz();
  const today = todayInAppTz();
  const rangeEnd = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 90)
  )
    .toISOString()
    .slice(0, 10);

  // One parallel burst.
  const [
    profile,
    requestsRes,
    usageRes,
    calendarRes,
    directoryRes,
    approvalsRes,
    workSettingsRes,
    coverDutiesRes,
    pulseRes,
    holiday,
  ] = await Promise.all([
    getCachedProfile(userId),
    getMyLeaveRequests(),
    getMyBalanceUsage(),
    canApprove ? Promise.resolve(null) : getCalendarEntries(today, rangeEnd),
    canApprove ? Promise.resolve(null) : getMyTeamDirectory(),
    canApprove ? getPendingApprovals() : Promise.resolve(null),
    // Balances and durations are stored in minutes; rendering them as days and
    // hours needs the company day length.
    getWorkSettings(),
    // Requests this person is the named cover for, over the same 90-day window.
    getMyCoverDuties(today, rangeEnd),
    canApprove ? getTodayPulse() : Promise.resolve(null),
    getNextHoliday(),
  ]);

  const hoursPerDay = workSettingsRes.ok
    ? workSettingsRes.settings.hoursPerDay
    : WORK_SETTINGS_FALLBACK.hoursPerDay;
  const durationLabels = durationLabelsFrom(tLeave);
  const duration = (minutes: number) => formatDuration(minutes, hoursPerDay, locale, durationLabels);
  const num = (n: number) => formatNumber(n, locale);
  const date = (iso: string) => formatCalendarDate(iso, locale);

  const pending = approvalsRes?.ok ? approvalsRes.requests : [];
  const pendingCount = pending.length;

  const board = buildHomeBoard({
    roles,
    requests: requestsRes.ok ? requestsRes.requests : [],
    team: calendarRes?.ok ? calendarRes.entries : [],
    directory: directoryRes?.ok ? directoryRes.members : [],
    pendingCount,
  });

  // ── pulse band ───────────────────────────────────────────────────────────
  let pulse: PulseCards | null = null;
  const pulseData = pulseRes?.ok ? pulseRes.pulse : null;
  if (pulseData) {
    const oldest = pending.reduce<number | null>((max, r) => {
      const d = daysAgo(r.submitted_at, today);
      return max === null || d > max ? d : max;
    }, null);
    pulse = {
      present: num(pulseData.present),
      presentOf: t('pulsePresentOf', { present: num(pulseData.present), total: num(pulseData.total) }),
      presentRatio: pulseData.total > 0 ? pulseData.present / pulseData.total : 0,
      onLeave: num(pulseData.onLeave),
      onLeaveSplit:
        pulseData.onLeaveByType.length > 0
          ? pulseData.onLeaveByType
              .map((b) => `${localizedLeaveTypeName(b, locale)} ${num(b.count)}`)
              .join('، ')
          : t('pulseNone'),
      errand: num(pulseData.errandDaily + pulseData.errandHourly),
      errandSplit: t('pulseErrandSplit', {
        daily: num(pulseData.errandDaily),
        hourly: num(pulseData.errandHourly),
      }),
      pending: num(pendingCount),
      pendingSub:
        oldest === null
          ? t('pulseNone')
          : oldest === 0
            ? t('pulseOldestToday')
            : t('pulseOldest', { days: num(oldest) }),
    };
  }

  // ── pending rows ─────────────────────────────────────────────────────────
  const shown = pending.slice(0, PENDING_ROWS);
  const requesterBalances = canApprove
    ? await getRequesterBalances(shown.filter((r) => r.affects_balance).map((r) => r.employee_id))
    : {};
  const pendingRows: PendingRow[] = shown.map((r) => {
    const typeName =
      r.kind === 'errand'
        ? tErrand('badge')
        : localizedLeaveTypeName({ name_fa: r.leave_type_name_fa, name_en: r.leave_type_name_en }, locale);
    const dates =
      r.unit === 'hour'
        ? `${date(r.start_date)} ${formatTimeRange(r.start_time, r.end_time, locale) ?? ''}`.trim()
        : r.start_date === r.end_date
          ? date(r.start_date)
          : `${date(r.start_date)} — ${date(r.end_date)}`;
    const departmentName =
      locale === 'fa'
        ? r.department_name_fa ?? r.department_name_en
        : r.department_name_en ?? r.department_name_fa;
    const others = pulseData
      ? shortStaffedOthers({ departmentId: r.department_id, employeeId: r.employee_id, pulse: pulseData })
      : null;
    const balance =
      r.affects_balance && r.leave_type_id
        ? requesterBalances[`${r.employee_id}:${r.leave_type_id}`]
        : undefined;
    return {
      id: r.id,
      employeeName: r.employee_name,
      departmentName: departmentName ?? null,
      summary: [typeName, dates, duration(r.requested_minutes)].join(' ، '),
      cover: r.replacement_name ? `${tRepl('coverLabel')}: ${r.replacement_name}` : null,
      balanceAfter:
        balance === undefined
          ? null
          : t('balanceAfter', { value: duration(Math.max(balance - r.requested_minutes, 0)) }),
      warning:
        others !== null && departmentName
          ? t('shortStaffed', { count: num(others), department: departmentName })
          : null,
    };
  });

  // ── my balance ───────────────────────────────────────────────────────────
  // Only the remaining amount (owner, 2026-10-07). Types without a balance
  // (unpaid leave) have nothing to show, so they are left out.
  const usage = (usageRes.ok ? usageRes.usage : [])
    .filter((u) => u.hasBalance)
    .map((u) => ({
      id: u.leaveTypeId,
      name: localizedLeaveTypeName(u, locale),
      remaining: t.rich('balanceRemaining', {
        left: duration(u.leftMinutes),
        b: (chunks) => <b className="font-bold text-foreground">{chunks}</b>,
      }),
    }));

  // ── next holiday ─────────────────────────────────────────────────────────
  const nextHoliday = holiday
    ? {
        name: localizedLeaveTypeName(holiday, locale),
        month: formatCalendarDate(holiday.date, locale, 'MMMM'),
        day: formatCalendarDate(holiday.date, locale, 'D'),
        when:
          daysAgo(today, holiday.date) === 0
            ? t('holidayToday', { weekday: formatCalendarDate(holiday.date, locale, 'dddd') })
            : t('holidayIn', {
                weekday: formatCalendarDate(holiday.date, locale, 'dddd'),
                days: num(daysAgo(today, holiday.date)),
              }),
      }
    : null;

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
    noRecent: t('noRecent'),
    noTeam: t('noTeam'),
    coveringTitle: tRepl('coveringTitle'),
    coveringFor: tRepl('coveringFor'),
    errandBadge: tErrand('badge'),
    ...durationLabels, // provides days/hours/minutes/and
    statusPending: tLeave('status.pending'),
    statusApproved: tLeave('status.approved'),
    statusRejected: tLeave('status.rejected'),
    statusCancelled: tLeave('status.cancelled'),
    pulsePresent: t('pulsePresent'),
    pulseOnLeave: t('pulseOnLeave'),
    pulseErrand: t('pulseErrand'),
    pulsePending: t('pulsePending'),
    nextHolidayTitle: t('nextHolidayTitle'),
    noHoliday: t('noHoliday'),
  };

  const pendingLabels = {
    title: t('pendingTitle'),
    allApprovals: t('allApprovals'),
    empty: t('noPending'),
    approve: tApprovals('approve'),
    reject: tApprovals('reject'),
    approveConfirm: tApprovals('approveConfirm'),
    rejectConfirm: tApprovals('rejectConfirm'),
    rejectReasonLabel: tApprovals('rejectReasonLabel'),
    rejectReasonPlaceholder: tApprovals('rejectReasonPlaceholder'),
    approveSuccess: tApprovals('approveSuccess'),
    rejectSuccess: tApprovals('rejectSuccess'),
    approverSignature: signatureLabelsFrom(tSignature, 'approverTitle'),
  };

  return (
    <div className="flex flex-col gap-5" data-testid="home-board">
      <div>
        <p className="text-[13px] text-muted-foreground">
          {formatCalendarDate(today, locale, 'dddd D MMMM YYYY')}
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">
          {t.rich(greetingKey(), {
            name: profile?.full_name ?? '',
            bdi: (chunks) => <bdi>{chunks}</bdi>,
          })}
        </h1>
      </div>
      <HomeBoard
        board={board}
        labels={labels}
        locale={locale}
        hoursPerDay={hoursPerDay}
        pulse={pulse}
        pending={
          board.showApprovals
            ? { rows: pendingRows, total: num(pendingCount), count: pendingCount, labels: pendingLabels }
            : null
        }
        usage={usage}
        nextHoliday={nextHoliday}
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
    </div>
  );
}

// ── FR-52/53 nudge: two tiny own-row reads, streamed separately ─────────────
async function ProfileReminder({ locale, userId }: { locale: string; userId: string }) {
  const supabase = await createClient();
  const [{ data: info }, { count }] = await Promise.all([
    supabase.from('employee_personal_info').select('complete').eq('employee_id', userId).maybeSingle(),
    supabase.from('user_signatures').select('user_id', { count: 'exact', head: true }).eq('user_id', userId),
  ]);
  const needsInfo = info ? !info.complete : false;
  const needsSignature = count === 0;
  if (!needsInfo && !needsSignature) return null;
  return <ProfileReminderCard locale={locale} needsInfo={needsInfo} needsSignature={needsSignature} />;
}

// ── page shell: paints instantly, all data streams in via Suspense ─────────
export default async function HomePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Local JWT check only — no network. The greeting needs the profile row, so
  // it lives inside the Suspense child.
  const user = await getCachedUser();
  if (!user) return null;

  return (
    <>
      <Suspense fallback={null}>
        <ProfileReminder locale={locale} userId={user.id} />
      </Suspense>
      <Suspense fallback={null}>
        <ClearanceAwaitingCard locale={locale} />
      </Suspense>
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
    </>
  );
}
