import Link from 'next/link';
import type { HomeBoard as HomeBoardData } from '@/lib/home/board';

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

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  approved: 'bg-green-100 text-green-800 border-green-200',
  rejected: 'bg-red-100 text-red-800 border-red-200',
  cancelled: 'bg-gray-100 text-gray-500 border-gray-200',
};

export function HomeBoard({ board, labels, locale }: Props) {
  const statusLabel = (s: string) =>
    s === 'pending'
      ? labels.statusPending
      : s === 'approved'
        ? labels.statusApproved
        : s === 'rejected'
          ? labels.statusRejected
          : s === 'cancelled'
            ? labels.statusCancelled
            : s;

  return (
    <div className="space-y-6" data-testid="home-board">
      {board.showApprovals && (
        <Link
          href={`/${locale}/manage/approvals`}
          data-testid="home-approvals-card"
          className="block rounded-xl border border-blue-200 bg-blue-50 p-4 hover:bg-blue-100 transition-colors"
        >
          <div className="font-semibold text-blue-900">{labels.approvalsTitle}</div>
          <div className="text-sm text-blue-700">{labels.approvalsPending}</div>
        </Link>
      )}

      <section className="rounded-xl border border-gray-200 p-4">
        <h2 className="font-semibold mb-3">{labels.balancesTitle}</h2>
        {board.balances.length === 0 ? (
          <p className="text-sm text-gray-500">—</p>
        ) : (
          <ul className="space-y-1">
            {board.balances.map((b) => (
              <li key={b.leaveTypeId} className="flex justify-between text-sm">
                <span>{locale === 'fa' ? b.name_fa : b.name_en ?? b.name_fa}</span>
                <span className="font-medium">
                  {b.balance} {labels.days}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-gray-200 p-4">
        <h2 className="font-semibold mb-3">{labels.recentTitle}</h2>
        {board.recent.length === 0 ? (
          <p className="text-sm text-gray-500">{labels.noRecent}</p>
        ) : (
          <div className="space-y-2">
            {board.recent.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <div className="font-medium text-gray-900 truncate">
                    {r.leave_types?.name_fa ?? '—'}
                  </div>
                  <div className="text-xs text-gray-500">
                    {r.start_date} — {r.end_date} · {r.requested_days} {labels.days}
                  </div>
                </div>
                <span
                  className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium shrink-0 ${
                    STATUS_COLORS[r.status] ?? ''
                  }`}
                >
                  {statusLabel(r.status)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-gray-200 p-4">
        <h2 className="font-semibold mb-3">{labels.teamTitle}</h2>
        {board.team.length === 0 ? (
          <p className="text-sm text-gray-500">{labels.noTeam}</p>
        ) : (
          <div className="space-y-2">
            {board.team.map((e) => {
              const typeName =
                locale === 'fa' ? e.leave_type_name_fa : e.leave_type_name_en ?? e.leave_type_name_fa;
              const color = e.leave_type_color ?? '#64748b';
              return (
                <div key={e.id} className="flex items-center gap-2 text-sm">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                  <span className="flex-1 truncate">{e.employee_name}</span>
                  <span className="text-xs text-gray-500 shrink-0">
                    {e.start_date}
                    {e.start_date !== e.end_date ? ` — ${e.end_date}` : ''} · {typeName}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
