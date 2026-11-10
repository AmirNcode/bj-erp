'use client';

/**
 * Admin editor for the approval chain (FR-36).
 *
 * This card is the whole mechanism behind the owner's requirement that the order
 * be changeable later: the steps say WHO must sign and in what order, and the
 * switch says whether that order actually binds. It ships unbound — either
 * approver may sign first — and turning it on needs no code change.
 */

import { useTranslations } from 'next-intl';
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
import type { DbErrorResult } from '@/lib/errors/db-error';

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
  orderNeedsStepsEdit: string;
  /** FR-47: explains the department-manager step under its row. */
  departmentHint: string;
  /** Spec 2026-11-09: the step's signature box title. */
  boxLabel: string;
  boxLabelHint: string;
  signedBy: string;
};

/** This screen's copy. */
function useLabels(): Labels {
  const tApproval = useTranslations('manage.settings.approvalSteps');
  const tAdd = useTranslations('manage.settings.approvalSteps.addStep');
  const tSteps = useTranslations('approvals.steps');
  return {
    title: tApproval('title'),
    hint: tApproval('hint'),
    orderEnforced: tApproval('orderEnforced'),
    orderHint: tApproval('orderHint'),
    stepOrder: tApproval('stepOrder'),
    active: tApproval('active'),
    saved: tApproval('saved'),
    error: tApproval('error'),
    empty: tApproval('empty'),
    personStep: tApproval('personStep'),
    inactiveApprover: tApproval('inactiveApprover'),
    remove: tApproval('remove'),
    removeConfirm: tApproval('removeConfirm'),
    removed: tApproval('removed'),
    orderNeedsStepsEdit: tApproval('orderNeedsStepsEdit'),
    departmentHint: tApproval('departmentHint'),
    boxLabel: tApproval('boxLabel'),
    boxLabelHint: tApproval('boxLabelHint'),
    signedBy: tApproval('signedBy'),
    steps: {
      manager: tSteps('manager'),
      departmentManager: tSteps('departmentManager'),
      hr: tSteps('hr'),
      security: tSteps('security'),
      admin: tSteps('admin'),
      employee: tSteps('employee'),
    },
    addStep: {
      button: tAdd('button'),
      title: tAdd('title'),
      intro: tAdd('intro'),
      kind: tAdd('kind'),
      kindRole: tAdd('kindRole'),
      kindPerson: tAdd('kindPerson'),
      role: tAdd('role'),
      person: tAdd('person'),
      personPlaceholder: tAdd('personPlaceholder'),
      personHint: tAdd('personHint'),
      searching: tAdd('searching'),
      noMatches: tAdd('noMatches'),
      // .raw(): the dialog fills {count}.
      selectOne: tAdd.raw('selectOne'),
      selected: tAdd('selected'),
      clear: tAdd('clear'),
      order: tAdd('order'),
      add: tAdd('add'),
      adding: tAdd('adding'),
      cancel: tAdd('cancel'),
      added: tAdd('added'),
      errorLabel: tAdd('errorLabel'),
      boxLabel: tAdd('boxLabel'),
      boxLabelPlaceholder: tAdd('boxLabelPlaceholder'),
      roles: {
        manager: tSteps('manager'),
        hr: tSteps('hr'),
        security: tSteps('security'),
        admin: tSteps('admin'),
        employee: tSteps('employee'),
      },
    },
  };
}


/** Box · signer · order · active · remove — shared by the header and every row. */
const ROW_GRID = 'sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_5rem_4rem_5rem] sm:gap-x-4';

type Props = {
  steps: ApprovalStepRow[];
  orderEnforced: boolean;
  /**
   * FR-66: approval_steps edit (the admin and the hr preset), the gate of
   * setApprovalOrderEnforced and its RPC. Passed in so the switch is disabled
   * rather than failing at the database.
   */
  canEnforceOrder: boolean;
  /**
   * FR-55: without approval_steps edit the card is a read-only view: order and
   * active are disabled, and Add and Remove are hidden. Defaults to true.
   */
  canEdit?: boolean;
};

export function ApprovalStepsCard({ steps, orderEnforced, canEnforceOrder, canEdit = true }: Props) {
  const labels = useLabels();
  const router = useRouter();
  const [enforced, setEnforced] = useState(orderEnforced);
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: true } | DbErrorResult>) => {
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
          <div data-testid="approval-steps-list">
            {/* Fixed columns, so Order / Active / Remove sit in the same place on
                every row however long the box or signer name is. Phones stack. */}
            <div
              className={`hidden border-b border-border pb-2 text-xs font-medium text-muted-foreground sm:grid ${ROW_GRID}`}
              aria-hidden
            >
              <span>{labels.boxLabel}</span>
              <span>{labels.signedBy}</span>
              <span>{labels.stepOrder}</span>
              <span>{labels.active}</span>
              <span />
            </div>
            <ul className="divide-y divide-border">
            {steps.map((step) => {
              const isDepartment = step.managerScope === 'department';
              // Test-id key: the department step shares role `manager` with the
              // direct step, so it gets its own.
              const key = step.approverId ?? (isDepartment ? 'department-manager' : step.role);
              const signer = step.approverId ? (
                <>
                  {step.approverName ?? '—'}
                  <span className="ms-1 text-xs font-normal text-muted-foreground">
                    ({labels.personStep})
                  </span>
                </>
              ) : isDepartment ? (
                labels.steps.departmentManager
              ) : (
                (labels.steps[step.role] ?? step.role)
              );
              return (
                <li
                  key={step.id}
                  className={`grid grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 py-3 sm:grid ${ROW_GRID}`}
                  data-testid={
                    step.approverId
                      ? `approval-step-person-${step.approverId}`
                      : `approval-step-${key}`
                  }
                >
                  <div className="col-span-3 min-w-0 sm:col-span-1">
                    <Label htmlFor={`step-box-${step.id}`} className="mb-1 text-xs text-muted-foreground sm:sr-only">
                      {labels.boxLabel}
                    </Label>
                    <Input
                      id={`step-box-${step.id}`}
                      // Re-mount on a saved rename so the field shows the stored value.
                      key={step.boxLabel ?? ''}
                      defaultValue={step.boxLabel ?? ''}
                      maxLength={60}
                      title={labels.boxLabelHint}
                      disabled={isPending || !canEdit}
                      className="h-8"
                      data-testid={`approval-step-box-label-${key}`}
                      onBlur={(e) => {
                        const next = e.target.value.trim();
                        if (next === (step.boxLabel ?? '')) return;
                        if (!next) {
                          e.target.value = step.boxLabel ?? '';
                          return;
                        }
                        run(() => updateApprovalStep({ id: step.id, boxLabel: next }));
                      }}
                    />
                  </div>

                  <div className="col-span-3 min-w-0 text-sm font-medium sm:col-span-1">
                    <span className="break-words">{signer}</span>
                    {/* A named approver whose account is disabled can never fill this
                        step, so every request needing it is stuck. Say so here rather
                        than leaving those requests silently pending. */}
                    {step.approverInactive && (
                      <span
                        className="mt-1 block rounded-md bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive"
                        data-testid={`approval-step-inactive-${step.id}`}
                      >
                        {labels.inactiveApprover}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    <Label htmlFor={`step-order-${step.id}`} className="text-xs text-muted-foreground sm:sr-only">
                      {labels.stepOrder}
                    </Label>
                    <Input
                      id={`step-order-${step.id}`}
                      type="number"
                      min={1}
                      max={99}
                      defaultValue={step.stepOrder}
                      disabled={isPending || !canEdit}
                      className="h-8 w-16"
                      data-testid={`approval-step-order-${key}`}
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
                      // FR-56/58: a retired security/admin step cannot come back.
                      disabled={isPending || !canEdit || step.role === 'security' || step.role === 'admin'}
                      className="size-4 rounded border-input text-primary focus:ring-ring"
                      data-testid={`approval-step-active-${key}`}
                      onChange={(e) =>
                        run(() => updateApprovalStep({ id: step.id, active: e.target.checked }))
                      }
                    />
                    <span className="sm:sr-only">{labels.active}</span>
                  </label>

                  <div className="justify-self-end">
                  {/* The department step is seeded by migration and the Add dialog
                      cannot recreate it, so it is switched off rather than removed. */}
                  {!isDepartment && canEdit && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="destructive"
                        size="xs"
                        disabled={isPending}
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
                  )}
                  </div>
                  {isDepartment && (
                    <p className="col-span-full text-xs text-muted-foreground" data-testid="approval-step-department-hint">
                      {labels.departmentHint}
                    </p>
                  )}
                </li>
              );
            })}
            </ul>
          </div>
        )}

        {canEdit && (
          <AddApprovalStepDialog
            labels={labels.addStep}
            usedRoles={steps
              .filter((s) => !s.approverId && s.managerScope !== 'department')
              .map((s) => s.role)}
            onAdded={() => router.refresh()}
          />
        )}

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
            {canEnforceOrder ? labels.orderHint : labels.orderNeedsStepsEdit}
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
