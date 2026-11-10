'use client';

/**
 * Admin editor for the approval chain (FR-36).
 *
 * This card is the whole mechanism behind the owner's requirement that the order
 * be changeable later: the steps say WHO must sign and in what order, and the
 * switch says whether that order actually binds. It ships unbound — either
 * approver may sign first — and turning it on needs no code change.
 *
 * Box names, order, active and the switch are edited as a draft and written only
 * by Save (disabled until something differs from the stored values). Add and
 * Remove still act at once, each behind its own dialog.
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

type Labels = {
  title: string;
  hint: string;
  orderEnforced: string;
  orderHint: string;
  stepOrder: string;
  active: string;
  save: string;
  saving: string;
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
    save: tApproval('save'),
    saving: tApproval('saving'),
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

type StepEdit = { boxLabel?: string; stepOrder?: string; active?: boolean };

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
  // Unsaved edits, by step id. An edit equal to the stored value is not a change.
  // A save with no refusal clears the draft, so a later change by someone else is not
  // shown as ours and written back by the next Save.
  const [edits, setEdits] = useState<Record<string, StepEdit>>({});
  const [enforcedEdit, setEnforcedEdit] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

  const enforced = enforcedEdit ?? orderEnforced;
  const edit = (id: string, patch: StepEdit) =>
    setEdits((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  const changes = steps.flatMap((step) => {
    const e = edits[step.id];
    if (!e) return [];
    const patch: { id: string; boxLabel?: string; stepOrder?: number; active?: boolean } = { id: step.id };
    if (e.boxLabel !== undefined && e.boxLabel.trim() !== (step.boxLabel ?? '')) patch.boxLabel = e.boxLabel.trim();
    // A blank or non-numeric order goes to the server as it is, which refuses it.
    if (e.stepOrder !== undefined && Number(e.stepOrder) !== step.stepOrder) patch.stepOrder = Number(e.stepOrder);
    if (e.active !== undefined && e.active !== step.active) patch.active = e.active;
    return Object.keys(patch).length > 1 ? [patch] : [];
  });
  const enforcedChanged = enforced !== orderEnforced;
  const dirty = changes.length > 0 || enforcedChanged;

  const save = () => {
    setError('');
    startTransition(async () => {
      // One write per changed step, then the switch. A refusal stops there; what was
      // already written shows as saved after the refresh, the rest stays as a draft.
      let failure = '';
      for (const patch of changes) {
        const result = await updateApprovalStep(patch);
        if (!result.ok) { failure = result.error; break; }
      }
      if (!failure && enforcedChanged) {
        const result = await setApprovalOrderEnforced(enforced);
        if (!result.ok) failure = result.error;
      }
      if (failure) setError(failure);
      else {
        toast.success(labels.saved);
        setEdits({});
        setEnforcedEdit(null);
      }
      router.refresh();
    });
  };

  const remove = (id: string) => {
    setError('');
    startTransition(async () => {
      const result = await deleteApprovalStep(id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(labels.removed);
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
                      value={edits[step.id]?.boxLabel ?? step.boxLabel ?? ''}
                      maxLength={60}
                      title={labels.boxLabelHint}
                      disabled={isPending || !canEdit}
                      className="h-8"
                      data-testid={`approval-step-box-label-${key}`}
                      onChange={(e) => edit(step.id, { boxLabel: e.target.value })}
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
                      value={edits[step.id]?.stepOrder ?? String(step.stepOrder)}
                      disabled={isPending || !canEdit}
                      className="h-8 w-16"
                      data-testid={`approval-step-order-${key}`}
                      onChange={(e) => edit(step.id, { stepOrder: e.target.value })}
                    />
                  </div>

                  <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      checked={edits[step.id]?.active ?? step.active}
                      // FR-56/58: a retired security/admin step cannot come back.
                      disabled={isPending || !canEdit || step.role === 'security' || step.role === 'admin'}
                      className="size-4 rounded border-input text-primary focus:ring-ring"
                      data-testid={`approval-step-active-${key}`}
                      onChange={(e) => edit(step.id, { active: e.target.checked })}
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
                          onClick={() => remove(step.id)}
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
              onChange={(e) => setEnforcedEdit(e.target.checked)}
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

        {(canEdit || canEnforceOrder) && (
          <div className="flex justify-end">
            <Button onClick={save} disabled={!dirty || isPending} data-testid="approval-steps-save">
              {isPending ? labels.saving : labels.save}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
