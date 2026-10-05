import Link from 'next/link';
import type { ReactNode } from 'react';
import type { HomeBoard as HomeBoardData } from '@/lib/home/board';
import { formatCalendarDate } from '@/lib/leave/calendarMonth';
import { localizedLeaveTypeName } from '@/lib/i18n/format';
import { formatDuration } from '@/lib/leave/duration';
import { formatTimeRange } from '@/lib/leave/formatTimeRange';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/StatusBadge';
import { EmptyState } from '@/components/EmptyState';
import { cn } from '@/lib/utils';
import { RequestCancelButton } from '../request/_components/RequestCancelButton';
import { PendingApprovalsCard, type PendingRow } from './PendingApprovalsCard';

type Labels = {
  balancesTitle: string;
  recentTitle: string;
  teamTitle: string;
  managerLabel: string;
  teammatesLabel: string;
  rolesLabel: string;
  titleLabel: string;
  upcomingLabel: string;
  noUpcoming: string;
  noRecent: string;
  noTeam: string;
  errandBadge: string;
  coveringTitle: string;
  coveringFor: string;
  days: string;
  hours: string;
  minutes: string;
  and: string;
  statusPending: string;
  statusApproved: string;
  statusRejected: string;
  statusCancelled: string;
  pulsePresent: string;
  pulseOnLeave: string;
  pulseErrand: string;
  pulsePending: string;
  nextHolidayTitle: string;
  noHoliday: string;
};

/** Pre-formatted pulse band figures (server-side, locale digits). */
export type PulseCards = {
  present: string;
  presentOf: string;
  /** 0..1 for the progress bar. */
  presentRatio: number;
  onLeave: string;
  onLeaveSplit: string;
  errand: string;
  errandSplit: string;
  pending: string;
  pendingSub: string;
};

type UsageRow = {
  id: string;
  name: string;
  hasBalance: boolean;
  /** "<b>{left}</b> از {entitled}" */
  leftOf: ReactNode;
  used: string;
  /** left / entitled, 0..1. */
  ratio: number;
};

type Props = {
  board: HomeBoardData;
  labels: Labels;
  locale: string;
  /** Company day length — balances and durations are stored in minutes. */
  hoursPerDay: number;
  /** Approvers only; null when the read failed (cards then show "—"). */
  pulse: PulseCards | null;
  pending: {
    rows: PendingRow[];
    total: string;
    count: number;
    labels: React.ComponentProps<typeof PendingApprovalsCard>['labels'];
  } | null;
  usage: UsageRow[];
  nextHoliday: { name: string; month: string; day: string; when: string } | null;
  /** Requests where this person is the named cover (D15: never a surprise). */
  coverDuties: {
    requestId: string;
    employeeName: string;
    startDate: string;
    endDate: string;
    unit: 'day' | 'hour';
    startTime: string | null;
    endTime: string | null;
  }[];
};

function Bar({ ratio, className }: { ratio: number; className?: string }) {
  const pct = Math.round(Math.min(Math.max(ratio, 0), 1) * 100);
  return (
    <div className={cn('h-1.5 overflow-hidden rounded-full bg-muted', className)}>
      <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
    </div>
  );
}

function PulseCard({
  label,
  value,
  sub,
  children,
  tinted,
}: {
  label: string;
  value: string;
  sub: string;
  children?: ReactNode;
  tinted?: boolean;
}) {
  return (
    <div
      className={cn(
        'h-full rounded-xl border px-[18px] py-4 shadow-sm',
        tinted ? 'border-primary/30 bg-secondary transition-colors hover:bg-primary/10' : 'bg-card'
      )}
    >
      <p className={cn('text-[13px]', tinted ? 'font-semibold text-primary' : 'text-muted-foreground')}>
        {label}
      </p>
      <p
        className={cn(
          'mt-1 text-[28px] font-bold leading-tight',
          tinted && 'text-secondary-foreground'
        )}
      >
        {value}
      </p>
      {children}
      <p className="mt-1 truncate text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}

export function HomeBoard({
  board,
  labels,
  locale,
  hoursPerDay,
  pulse,
  pending,
  usage,
  nextHoliday,
  coverDuties,
}: Props) {
  const statusLabels = {
    pending: labels.statusPending,
    approved: labels.statusApproved,
    rejected: labels.statusRejected,
    cancelled: labels.statusCancelled,
  };
  const manager = board.directory.find((member) => member.relation === 'manager');
  const teammates = board.directory.filter((member) => member.relation === 'teammate');
  const none = '—';

  const formatDate = (date: string) => formatCalendarDate(date, locale);
  const titleFor = (member: HomeBoardData['directory'][number]) =>
    locale === 'fa'
      ? member.departmentNameFa ?? member.departmentNameEn ?? '—'
      : member.departmentNameEn ?? member.departmentNameFa ?? '—';

  return (
    <>
      {/* Pulse band — approvers (admin, hr, manager). Scoped server-side. */}
      {board.showApprovals && (
        <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4" data-testid="home-pulse">
          <PulseCard
            label={labels.pulsePresent}
            value={pulse?.present ?? none}
            sub={pulse?.presentOf ?? none}
          >
            <Bar ratio={pulse?.presentRatio ?? 0} className="mt-2" />
          </PulseCard>
          <PulseCard
            label={labels.pulseOnLeave}
            value={pulse?.onLeave ?? none}
            sub={pulse?.onLeaveSplit ?? none}
          />
          <PulseCard
            label={labels.pulseErrand}
            value={pulse?.errand ?? none}
            sub={pulse?.errandSplit ?? none}
          />
          <Link
            href={`/${locale}/manage/approvals`}
            data-testid="home-approvals-card"
            className="block rounded-xl focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <PulseCard
              tinted
              label={labels.pulsePending}
              value={pulse?.pending ?? String(board.pendingCount)}
              sub={pulse?.pendingSub ?? none}
            />
          </Link>
        </div>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-5">
          {pending && (
            <PendingApprovalsCard
              rows={pending.rows}
              total={pending.total}
              count={pending.count}
              labels={pending.labels}
              locale={locale}
            />
          )}

          <Card>
            <CardHeader>
              <CardTitle>{labels.recentTitle}</CardTitle>
            </CardHeader>
            <CardContent>
              {board.recent.length === 0 ? (
                <EmptyState message={labels.noRecent} />
              ) : (
                <div className="space-y-3">
                  {board.recent.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center justify-between gap-3"
                      data-testid={`home-recent-request-${r.id}`}
                    >
                      <div className="min-w-0">
                        {/* An errand has no leave type; naming it by its tag keeps
                            the row from rendering as a bare em dash. */}
                        <div className="text-sm font-medium truncate">
                          {r.kind === 'errand'
                            ? `${labels.errandBadge}: ${r.errand_location ?? '—'}`
                            : r.leave_types
                              ? localizedLeaveTypeName(r.leave_types, locale)
                              : '—'}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatDate(r.start_date)} — {formatDate(r.end_date)} -{' '}
                          {formatDuration(r.requested_minutes, hoursPerDay, locale, labels)}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <span data-testid={`home-status-${r.id}`}>
                          <StatusBadge
                            status={r.status as 'pending' | 'approved' | 'rejected' | 'cancelled'}
                            labels={statusLabels}
                          />
                        </span>
                        <RequestCancelButton
                          requestId={r.id}
                          status={r.status}
                          startDate={r.start_date}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Non-approvers keep the My Team panel. */}
          {!board.showApprovals && (
            <Card>
              <CardHeader>
                <CardTitle>{labels.teamTitle}</CardTitle>
              </CardHeader>
              <CardContent>
                {board.directory.length === 0 ? (
                  <EmptyState message={labels.noTeam} />
                ) : (
                  <div className="space-y-4" data-testid="home-my-team">
                    {manager && (
                      <section>
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {labels.managerLabel}
                        </h3>
                        <TeamMemberRow
                          member={manager}
                          title={titleFor(manager)}
                          labels={labels}
                          locale={locale}
                        />
                      </section>
                    )}

                    <section>
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {labels.teammatesLabel}
                      </h3>
                      {teammates.length === 0 ? (
                        <p className="mt-2 text-sm text-muted-foreground">{labels.noTeam}</p>
                      ) : (
                        <div className="mt-2 divide-y divide-border">
                          {teammates.map((member) => (
                            <TeamMemberRow
                              key={member.id}
                              member={member}
                              title={titleFor(member)}
                              labels={labels}
                              locale={locale}
                            />
                          ))}
                        </div>
                      )}
                    </section>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        <aside className="flex min-w-0 flex-col gap-5">
          {/* Named as someone's cover — D15 surfaces it here instead of gating approval. */}
          {coverDuties.length > 0 && (
            <Card className="border-primary/30 bg-primary/5" data-testid="home-covering">
              <CardHeader>
                <CardTitle className="text-primary">{labels.coveringTitle}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1 text-sm text-primary/90">
                  {/* An hourly cover is one date plus a window — rendering the same
                      date twice with no hours read as a full day off. */}
                  {coverDuties.map((duty) => (
                    <li key={duty.requestId}>
                      {labels.coveringFor} <bdi>{duty.employeeName}</bdi> -{' '}
                      {duty.unit === 'hour'
                        ? `${formatDate(duty.startDate)} - ${formatTimeRange(duty.startTime, duty.endTime, locale)}`
                        : duty.startDate === duty.endDate
                          ? formatDate(duty.startDate)
                          : `${formatDate(duty.startDate)} — ${formatDate(duty.endDate)}`}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <Card className="gap-4 px-5 py-5" data-testid="home-balances">
            <h2 className="text-base font-semibold">{labels.balancesTitle}</h2>
            {usage.length === 0 ? (
              <EmptyState message="—" />
            ) : (
              <ul className="space-y-4">
                {usage.map((u) => (
                  <li key={u.id} data-testid={`home-balance-${u.id}`}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="whitespace-nowrap text-sm text-muted-foreground">{u.name}</span>
                      {u.hasBalance && (
                        <span className="whitespace-nowrap text-sm text-muted-foreground">{u.leftOf}</span>
                      )}
                    </div>
                    {u.hasBalance && <Bar ratio={u.ratio} className="mt-2" />}
                    <p className="mt-1.5 text-xs text-muted-foreground">{u.used}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="flex-row items-center gap-4 px-5 py-5" data-testid="home-next-holiday">
            {nextHoliday ? (
              <>
                <div
                  aria-hidden="true"
                  className="w-14 shrink-0 overflow-hidden rounded-[10px] border text-center"
                >
                  <div className="truncate bg-primary px-1 py-0.5 text-[11px] text-primary-foreground">
                    {nextHoliday.month}
                  </div>
                  <div className="py-1 text-[22px] font-bold leading-tight">{nextHoliday.day}</div>
                </div>
                <div className="min-w-0">
                  <p className="text-[12.5px] text-muted-foreground">{labels.nextHolidayTitle}</p>
                  <p className="font-semibold">{nextHoliday.name}</p>
                  <p className="text-xs text-muted-foreground">{nextHoliday.when}</p>
                </div>
              </>
            ) : (
              <div>
                <p className="text-[12.5px] text-muted-foreground">{labels.nextHolidayTitle}</p>
                <p className="text-sm text-muted-foreground">{labels.noHoliday}</p>
              </div>
            )}
          </Card>
        </aside>
      </div>
    </>
  );
}

function TeamMemberRow({
  member,
  title,
  labels,
  locale,
}: {
  member: HomeBoardData['directory'][number];
  title: string;
  labels: Labels;
  locale: string;
}) {
  const roleText = member.roles.length > 0 ? member.roles.join(', ') : '—';

  return (
    <div className="py-3 first:pt-2 last:pb-0" data-testid={`team-member-${member.id}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">{member.fullName}</div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>
              {labels.rolesLabel}: {roleText}
            </span>
            <span>
              {labels.titleLabel}: {title}
            </span>
            {member.managerName && member.relation !== 'manager' && (
              <span>
                {labels.managerLabel}: {member.managerName}
              </span>
            )}
          </div>
        </div>

        <div className="sm:min-w-56">
          <div className="text-xs font-semibold text-muted-foreground">
            {labels.upcomingLabel}
          </div>
          {member.upcomingTimeOff.length === 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">{labels.noUpcoming}</p>
          ) : (
            <div className="mt-1 space-y-1.5">
              {member.upcomingTimeOff.map((leave) => {
                const typeName = localizedLeaveTypeName(
                  { name_fa: leave.leave_type_name_fa, name_en: leave.leave_type_name_en },
                  locale
                );
                const color = leave.leave_type_color ?? '#64748b';
                return (
                  <div key={leave.id} className="flex items-center gap-2 text-xs">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                    <span className="text-muted-foreground">
                      {formatCalendarDate(leave.start_date, locale)}
                      {leave.start_date !== leave.end_date
                        ? ` — ${formatCalendarDate(leave.end_date, locale)}`
                        : ''}{' '}
                      - {typeName}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
