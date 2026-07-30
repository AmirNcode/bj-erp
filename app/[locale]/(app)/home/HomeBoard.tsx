import Link from 'next/link';
import type { HomeBoard as HomeBoardData } from '@/lib/home/board';
import { formatCalendarDate } from '@/lib/leave/calendarMonth';
import { localizedLeaveTypeName } from '@/lib/i18n/format';
import { formatDuration } from '@/lib/leave/duration';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/StatusBadge';
import { EmptyState } from '@/components/EmptyState';

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
  approvalsTitle: string;
  approvalsPending: string;
  noRecent: string;
  noTeam: string;
  requestDaily: string;
  requestHourly: string;
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
};

type Props = {
  board: HomeBoardData;
  labels: Labels;
  locale: string;
  calendarPref: string;
  /** Company day length — balances and durations are stored in minutes. */
  hoursPerDay: number;
  /** Requests where this person is the named cover (D15: never a surprise). */
  coverDuties: { requestId: string; employeeName: string; startDate: string; endDate: string }[];
};

export function HomeBoard({
  board,
  labels,
  locale,
  calendarPref,
  hoursPerDay,
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

  const formatDate = (date: string) => formatCalendarDate(date, calendarPref, locale);
  const titleFor = (member: HomeBoardData['directory'][number]) =>
    locale === 'fa'
      ? member.departmentNameFa ?? member.departmentNameEn ?? '—'
      : member.departmentNameEn ?? member.departmentNameFa ?? '—';

  return (
    <div className="space-y-4" data-testid="home-board">
      {/* Two entry points, mirroring the client's two paper forms (D13). */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Link
          href={`/${locale}/request`}
          data-testid="home-request-daily"
          className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-center text-sm font-semibold text-primary transition-colors hover:bg-primary/10"
        >
          {labels.requestDaily}
        </Link>
        <Link
          href={`/${locale}/request/hourly`}
          data-testid="home-request-hourly"
          className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-center text-sm font-semibold text-primary transition-colors hover:bg-primary/10"
        >
          {labels.requestHourly}
        </Link>
      </div>

      {board.showApprovals && (
        <Link
          href={`/${locale}/manage/approvals`}
          data-testid="home-approvals-card"
          className="block"
        >
          <Card className="border-primary/30 bg-primary/5 hover:bg-primary/10 transition-colors cursor-pointer">
            <CardHeader>
              <CardTitle className="text-primary">{labels.approvalsTitle}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-primary/80">{labels.approvalsPending}</p>
            </CardContent>
          </Card>
        </Link>
      )}

      {/* Named as someone's cover — D15 surfaces it here instead of gating approval. */}
      {coverDuties.length > 0 && (
        <Card className="border-primary/30 bg-primary/5" data-testid="home-covering">
          <CardHeader>
            <CardTitle className="text-primary">{labels.coveringTitle}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm text-primary/90">
              {coverDuties.map((duty) => (
                <li key={duty.requestId}>
                  {labels.coveringFor} {duty.employeeName} · {formatDate(duty.startDate)} —{' '}
                  {formatDate(duty.endDate)}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{labels.balancesTitle}</CardTitle>
          </CardHeader>
          <CardContent>
            {board.balances.length === 0 ? (
              <EmptyState message="—" />
            ) : (
              <ul className="space-y-3">
                {board.balances.map((b) => (
                  <li key={b.leaveTypeId} className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      {locale === 'fa' ? b.name_fa : b.name_en ?? b.name_fa}
                    </span>
                    {/* formatDuration carries its own units ("۹ روز و ۴ ساعت"), so the
                        separate unit suffix that used to follow the number is gone. */}
                    <span className="text-xl font-bold leading-none">
                      {formatDuration(b.balanceMinutes, hoursPerDay, locale, labels)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

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
                  <div key={r.id} className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">
                        {r.leave_types ? localizedLeaveTypeName(r.leave_types, locale) : '—'}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatDate(r.start_date)} — {formatDate(r.end_date)} ·{' '}
                        {formatDuration(r.requested_minutes, hoursPerDay, locale, labels)}
                      </div>
                    </div>
                    <StatusBadge
                      status={r.status as 'pending' | 'approved' | 'rejected' | 'cancelled'}
                      labels={statusLabels}
                    />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
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
                      calendarPref={calendarPref}
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
                          calendarPref={calendarPref}
                        />
                      ))}
                    </div>
                  )}
                </section>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function TeamMemberRow({
  member,
  title,
  labels,
  locale,
  calendarPref,
}: {
  member: HomeBoardData['directory'][number];
  title: string;
  labels: Labels;
  locale: string;
  calendarPref: string;
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
                      {formatCalendarDate(leave.start_date, calendarPref, locale)}
                      {leave.start_date !== leave.end_date
                        ? ` — ${formatCalendarDate(leave.end_date, calendarPref, locale)}`
                        : ''}{' '}
                      · {typeName}
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
