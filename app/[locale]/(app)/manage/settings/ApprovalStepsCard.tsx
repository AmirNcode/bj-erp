'use client';

/**
 * Admin editor for the approval chain (FR-36).
 *
 * This card is the whole mechanism behind the owner's requirement that the order
 * be changeable later: the steps say WHO must sign and in what order, and the
 * switch says whether that order actually binds. It ships unbound — either
 * approver may sign first — and turning it on needs no code change.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  updateApprovalStep,
  deleteApprovalStep,
  setApprovalOrderEnforced,
  type ApprovalStepRow,
} from '@/lib/actions/settings';
import { AddApprovalStepDialog, type AddStepLabels } from './AddApprovalStepDialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EmptyState } from '@/components/EmptyState';

type Labels = {
  title: string;
  hint: string;
  orderEnforced: string;
  orderHint: string;
  stepOrder: string;
  active: string;
  saved: string;
  error: string;
  empty: string;
  steps: Record<string, string>;
  /** FR-42. */
  addStep: AddStepLabels;
  personStep: string;
  inactiveApprover: string;
  remove: string;
  removeConfirm: string;
  removed: string;
  orderAdminOnly: string;
};

type Props = {
  steps: ApprovalStepRow[];
  orderEnforced: boolean;
  labels: Labels;
  /**
   * FR-42: HR may edit the steps, but the order switch writes `work_settings`,
   * which stays admin-only. Passed in so the switch is disabled rather than
   * failing at the database.
   */
  canEnforceOrder: boolean;
};

export function ApprovalStepsCard({ steps, orderEnforced, labels, canEnforceOrder }: Props) {
  const router = useRouter();
  const [enforced, setEnforced] = useState(orderEnforced);
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setError('');
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(labels.saved);
      router.refresh();
    });
  };

  return (
    <Card data-testid="approval-steps-card">
      <CardHeader>
        <CardTitle>{labels.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{labels.hint}</p>

        {steps.length === 0 ? (
          <EmptyState message={labels.empty} />
        ) : (
          <ul className="divide-y divide-border" data-testid="approval-steps-list">
            {steps.map((step) => (
              <li
                key={step.id}
                className="flex flex-wrap items-center gap-3 py-3"
                data-testid={
                  step.approverId
                    ? `approval-step-person-${step.approverId}`
                    : `approval-step-${step.role}`
                }
              >
                <span className="min-w-32 text-sm font-medium">
                  {step.approverId ? (
                    <>
                      {step.approverName ?? '—'}
                      <span className="ms-1 text-xs font-normal text-muted-foreground">
                        ({labels.personStep})
                      </span>
                    </>
                  ) : (
                    (labels.steps[step.role] ?? step.role)
                  )}
                </span>

                {/* A named approver whose account is disabled can never fill this
                    step, so every request needing it is stuck. Say so here rather
                    than leaving those requests silently pending. */}
                {step.approverInactive && (
                  <span
                    className="rounded-md bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive"
                    data-testid={`approval-step-inactive-${step.id}`}
                  >
                    {labels.inactiveApprover}
                  </span>
                )}

                <div className="flex items-center gap-1.5">
                  <Label htmlFor={`step-order-${step.id}`} className="text-xs text-muted-foreground">
                    {labels.stepOrder}
                  </Label>
                  <Input
                    id={`step-order-${step.id}`}
                    type="number"
                    min={1}
                    max={99}
                    defaultValue={step.stepOrder}
                    disabled={isPending}
                    className="h-8 w-16"
                    data-testid={`approval-step-order-${step.approverId ?? step.role}`}
                    // Commit on blur rather than per keystroke: each save is a
                    // round-trip plus a router refresh.
                    onBlur={(e) => {
                      const next = Number(e.target.value);
                      if (!Number.isFinite(next) || next === step.stepOrder) return;
                      run(() => updateApprovalStep({ id: step.id, stepOrder: next }));
                    }}
                  />
                </div>

                <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={step.active}
                    disabled={isPending}
                    className="size-4 rounded border-input text-primary focus:ring-ring"
                    data-testid={`approval-step-active-${step.approverId ?? step.role}`}
                    onChange={(e) =>
                      run(() => updateApprovalStep({ id: step.id, active: e.target.checked }))
                    }
                  />
                  {labels.active}
                </label>

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="destructive"
                      size="xs"
                      disabled={isPending}
                      className="ms-auto"
                      data-testid={`approval-step-delete-${step.approverId ?? step.role}`}
                    >
                      {labels.remove}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent size="sm">
                    <AlertDialogHeader>
                      <AlertDialogTitle>{labels.remove}</AlertDialogTitle>
                      {/* Signed decisions survive: leave_request_approvals has no
                          foreign key here, precisely so history stays printable. */}
                      <AlertDialogDescription>{labels.removeConfirm}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{labels.addStep.cancel}</AlertDialogCancel>
                      <AlertDialogAction
                        variant="destructive"
                        data-testid={`approval-step-delete-confirm-${step.id}`}
                        onClick={() =>
                          run(async () => {
                            const result = await deleteApprovalStep(step.id);
                            if (result.ok) toast.success(labels.removed);
                            return result;
                          })
                        }
                      >
                        {labels.remove}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </li>
            ))}
          </ul>
        )}

        <AddApprovalStepDialog
          labels={labels.addStep}
          usedRoles={steps.filter((s) => !s.approverId).map((s) => s.role)}
          onAdded={() => router.refresh()}
        />

        <div className="space-y-1.5 rounded-lg border border-border bg-secondary/40 px-3 py-2">
          <label
            className={`flex items-center gap-2 text-sm font-medium ${
              canEnforceOrder ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'
            }`}
          >
            <input
              type="checkbox"
              checked={enforced}
              disabled={isPending || !canEnforceOrder}
              className="size-4 rounded border-input text-primary focus:ring-ring"
              data-testid="approval-order-enforced"
              onChange={(e) => {
                const next = e.target.checked;
                setEnforced(next);
                run(() => setApprovalOrderEnforced(next));
              }}
            />
            {labels.orderEnforced}
          </label>
          <p className="text-xs text-muted-foreground">
            {canEnforceOrder ? labels.orderHint : labels.orderAdminOnly}
          </p>
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive" data-testid="approval-steps-error">
            <strong>{labels.error}:</strong> {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
