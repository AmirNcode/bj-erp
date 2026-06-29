import Link from 'next/link';
import type { HomeBoard as HomeBoardData } from '@/lib/home/board';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/StatusBadge';
import { EmptyState } from '@/components/EmptyState';

type Labels = {
  balancesTitle: string;
  recentTitle: string;
  teamTitle: string;
  approvalsTitle: string;
  approvalsPending: string;
  noRecent: string;
  noTeam: string;
  days: string;
  statusPending: string;
  statusApproved: string;
  statusRejected: string;
  statusCancelled: string;
};

type Props = {
  board: HomeBoardData;
  labels: Labels;
  locale: string;
};

export function HomeBoard({ board, labels, locale }: Props) {
  const statusLabels = {
    pending: labels.statusPending,
    approved: labels.statusApproved,
    rejected: labels.statusRejected,
    cancelled: labels.statusCancelled,
  };

  return (
    <div className="space-y-4" data-testid="home-board">
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
                    <span className="text-2xl font-bold tabular-nums leading-none">
                      {b.balance}
                      <span className="ms-1 text-xs font-normal text-muted-foreground">
                        {labels.days}
                      </span>
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
                        {r.leave_types?.name_fa ?? '—'}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {r.start_date} — {r.end_date} · {r.requested_days} {labels.days}
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
            {board.team.length === 0 ? (
              <EmptyState message={labels.noTeam} />
            ) : (
              <div className="space-y-3">
                {board.team.map((e) => {
                  const typeName =
                    locale === 'fa'
                      ? e.leave_type_name_fa
                      : e.leave_type_name_en ?? e.leave_type_name_fa;
                  const color = e.leave_type_color ?? '#64748b';
                  return (
                    <div key={e.id} className="flex items-center gap-2 text-sm">
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: color }}
                      />
                      <span className="flex-1 truncate">{e.employee_name}</span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {e.start_date}
                        {e.start_date !== e.end_date ? ` — ${e.end_date}` : ''} · {typeName}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
