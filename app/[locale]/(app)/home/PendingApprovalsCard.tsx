'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check, ChevronLeft, ChevronRight, TriangleAlert } from 'lucide-react';
import { approveRequest, rejectRequest, type DecisionResult } from '@/lib/actions/leave/approvals';
import { STATUS_BADGE_STYLES } from '@/components/StatusBadge';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  ApproveDialog,
  RejectDialog,
  type ApproveDialogLabels,
  type RejectDialogLabels,
} from '../manage/approvals/DecisionDialogs';

/** One pending request, pre-formatted on the server. */
export type PendingRow = {
  id: string;
  employeeName: string;
  departmentName: string | null;
  /** "{type} ، {dates} ، {duration}" */
  summary: string;
  cover: string | null;
  balanceAfter: string | null;
  /** Short-staffed warning; replaces the meta line when present. */
  warning: string | null;
};

type Labels = ApproveDialogLabels &
  RejectDialogLabels & {
    title: string;
    allApprovals: string;
    empty: string;
    approveSuccess: string;
    rejectSuccess: string;
  };

type Props = {
  rows: PendingRow[];
  /** Formatted total pending (may exceed the rows shown). */
  total: string;
  count: number;
  labels: Labels;
  locale: string;
};

/**
 * Home dashboard's pending queue with inline approve / reject. Decisions go
 * through the same dialogs and actions as /manage/approvals.
 */
export function PendingApprovalsCard({ rows, total, count, labels, locale }: Props) {
  const router = useRouter();
  const [localRows, setLocalRows] = useState(rows);
  const [isPending, startTransition] = useTransition();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const Chevron = locale === 'fa' ? ChevronLeft : ChevronRight;

  const decide = (id: string, successMsg: string, action: () => Promise<DecisionResult>) =>
    startTransition(async () => {
      const res = await action();
      if (res.ok) {
        setLocalRows((prev) => prev.filter((r) => r.id !== id));
        toast.success(successMsg);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });

  if (count === 0 || localRows.length === 0) {
    return (
      <Card className="flex-row items-center gap-3 px-[22px] py-4" data-testid="home-pending">
        <h2 className="text-base font-semibold">{labels.title}</h2>
        <p className="text-sm text-muted-foreground" data-testid="home-pending-empty">
          {labels.empty}
        </p>
      </Card>
    );
  }

  const actionClass = 'h-9 rounded-[10px] px-4';

  return (
    <Card className="gap-0 overflow-hidden py-0" data-testid="home-pending">
      <div className="flex items-center gap-2.5 px-[22px] py-4">
        <h2 className="text-base font-semibold">{labels.title}</h2>
        <Badge variant="outline" className={cn('rounded-full', STATUS_BADGE_STYLES.pending)}>
          {total}
        </Badge>
        <Link
          href={`/${locale}/manage/approvals`}
          className="ms-auto inline-flex items-center gap-1 whitespace-nowrap text-sm font-medium text-primary hover:underline"
        >
          {labels.allApprovals}
          <Chevron aria-hidden="true" className="size-4" />
        </Link>
      </div>
      <ul>
        {localRows.map((row) => (
          <li
            key={row.id}
            data-testid={`home-pending-row-${row.id}`}
            className="grid grid-cols-[40px_1fr] items-center gap-3.5 border-t border-muted px-[22px] py-3.5 sm:grid-cols-[40px_1fr_auto]"
          >
            <span
              aria-hidden="true"
              className="flex size-10 items-center justify-center rounded-full bg-secondary font-semibold text-secondary-foreground"
            >
              {row.employeeName.trim().charAt(0)}
            </span>
            <div className="min-w-0 space-y-0.5">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="whitespace-nowrap font-semibold">
                  <bdi>{row.employeeName}</bdi>
                </span>
                {row.departmentName && (
                  <span className="whitespace-nowrap text-[12.5px] text-muted-foreground">
                    {row.departmentName}
                  </span>
                )}
              </div>
              <p className="text-[13px]">{row.summary}</p>
              {row.warning ? (
                <p className="flex items-center gap-1 text-xs text-warning">
                  <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" />
                  {row.warning}
                </p>
              ) : (
                (row.cover || row.balanceAfter) && (
                  <p className="text-xs text-muted-foreground">
                    {[row.cover, row.balanceAfter].filter(Boolean).join(' - ')}
                  </p>
                )
              )}
            </div>
            <div className="col-span-2 flex justify-end gap-2 sm:col-span-1">
              <RejectDialog
                id={row.id}
                labels={labels}
                disabled={isPending}
                note={notes[row.id] ?? ''}
                onNoteChange={(v) => setNotes((n) => ({ ...n, [row.id]: v }))}
                onReject={() =>
                  decide(row.id, labels.rejectSuccess, () => rejectRequest(row.id, notes[row.id]))
                }
                triggerClassName={actionClass}
              />
              <ApproveDialog
                id={row.id}
                labels={labels}
                disabled={isPending}
                onApprove={(signatureData, signatureAuthorized) =>
                  decide(row.id, labels.approveSuccess, () =>
                    approveRequest(row.id, { signatureData, signatureAuthorized })
                  )
                }
                triggerClassName={actionClass}
                triggerIcon={<Check aria-hidden="true" />}
              />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
