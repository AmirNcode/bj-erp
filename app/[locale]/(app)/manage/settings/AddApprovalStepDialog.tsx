'use client';

/**
 * Add an approval step (FR-42) — a role, or one named person.
 *
 * The person branch is the point of this dialog: a company can require a
 * specific individual's signature on every request, not just "somebody with the
 * HR role". That person is then the ONLY one who can fill the step — an admin
 * cannot sign in their place, which is why the choice is worth a deliberate
 * screen rather than an inline control.
 */

import { useEffect, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import {
  createApprovalStep,
  searchApproverCandidates,
  type ApproverCandidate,
} from '@/lib/actions/settings';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { nativeSelectClass } from '@/lib/native-select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

export type AddStepLabels = {
  button: string;
  title: string;
  intro: string;
  kind: string;
  kindRole: string;
  kindPerson: string;
  role: string;
  person: string;
  personPlaceholder: string;
  personHint: string;
  searching: string;
  noMatches: string;
  selected: string;
  clear: string;
  order: string;
  add: string;
  adding: string;
  cancel: string;
  added: string;
  errorLabel: string;
  /** Localized role names, shared with the queue. */
  roles: Record<string, string>;
};

type Props = {
  labels: AddStepLabels;
  /** Roles already taken by a role-step — the database refuses a duplicate. */
  usedRoles: string[];
  onAdded: () => void;
};

const ROLE_OPTIONS = ['manager', 'hr', 'security', 'admin'] as const;

export function AddApprovalStepDialog({ labels, usedRoles, onAdded }: Props) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'role' | 'person'>('role');
  const [role, setRole] = useState<string>('');
  const [order, setOrder] = useState(3);
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<ApproverCandidate[]>([]);
  const [picked, setPicked] = useState<ApproverCandidate | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();
  const searchSeq = useRef(0);

  const available = ROLE_OPTIONS.filter((r) => !usedRoles.includes(r));

  const reset = () => {
    setMode('role');
    setRole('');
    setOrder(3);
    setQuery('');
    setCandidates([]);
    setPicked(null);
    setError('');
  };

  // Debounced search. `searchSeq` discards a slow response that arrives after a
  // newer one — otherwise typing quickly can leave stale results on screen.
  useEffect(() => {
    if (mode !== 'person' || picked) return;
    const term = query.trim();
    // No setState in the effect body itself — `react-hooks/set-state-in-effect`
    // forbids it, and a too-short term needs no state change anyway: the list
    // below is derived from the current query rather than cleared here.
    if (term.length < 2) return;

    const seq = ++searchSeq.current;
    const timer = setTimeout(async () => {
      setSearching(true);
      const result = await searchApproverCandidates(term);
      // A slower earlier request must not overwrite a newer one's results.
      if (seq !== searchSeq.current) return;
      setSearching(false);
      if (result.ok) setCandidates(result.candidates);
      else setError(result.error);
    }, 250);
    return () => clearTimeout(timer);
  }, [query, mode, picked]);

  // Derived, not stored: a term shorter than the threshold shows nothing without
  // needing an extra render to clear the list.
  const shown = query.trim().length >= 2 ? candidates : [];

  const submit = () => {
    setError('');
    if (mode === 'role' && !role) return;
    if (mode === 'person' && !picked) return;

    startTransition(async () => {
      const result = await createApprovalStep({
        // A person-step still carries a role, because that is what decides which
        // signature box it prints in. `employee` is the neutral choice when the
        // named person is not being picked FOR a role.
        role: mode === 'person' ? 'employee' : role,
        approverId: mode === 'person' ? picked!.id : null,
        stepOrder: order,
      });
      if (!result.ok) {
        setError(result.error);
        toast.error(`${labels.errorLabel}: ${result.error}`);
        return;
      }
      toast.success(labels.added);
      reset();
      setOpen(false);
      onAdded();
    });
  };

  const canSubmit = mode === 'role' ? !!role : !!picked;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" data-testid="approval-step-add-open">
          {labels.button}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription>{labels.intro}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="step-kind">{labels.kind}</Label>
            {/* Native <select> — must stay native for Playwright selectOption. */}
            <select
              id="step-kind"
              value={mode}
              disabled={isPending}
              data-testid="approval-step-kind"
              className={nativeSelectClass}
              onChange={(e) => {
                setMode(e.target.value as 'role' | 'person');
                setPicked(null);
                setCandidates([]);
                setError('');
              }}
            >
              <option value="role">{labels.kindRole}</option>
              <option value="person">{labels.kindPerson}</option>
            </select>
          </div>

          {mode === 'role' ? (
            <div className="space-y-1.5">
              <Label htmlFor="step-role">{labels.role}</Label>
              <select
                id="step-role"
                value={role}
                disabled={isPending}
                data-testid="approval-step-role"
                className={nativeSelectClass}
                onChange={(e) => setRole(e.target.value)}
              >
                <option value="">—</option>
                {available.map((r) => (
                  <option key={r} value={r}>
                    {labels.roles[r] ?? r}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="step-person">{labels.person}</Label>
              {picked ? (
                <div
                  className="flex items-center justify-between gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm"
                  data-testid="approval-step-person-selected"
                >
                  <span>
                    <span className="font-medium">{picked.fullName}</span>
                    {picked.personnelNo && (
                      <span className="ms-2 font-mono text-xs text-muted-foreground">
                        {picked.personnelNo}
                      </span>
                    )}
                  </span>
                  <Button
                    variant="ghost"
                    size="xs"
                    disabled={isPending}
                    data-testid="approval-step-person-clear"
                    onClick={() => {
                      setPicked(null);
                      setQuery('');
                    }}
                  >
                    {labels.clear}
                  </Button>
                </div>
              ) : (
                <>
                  <Input
                    id="step-person"
                    value={query}
                    disabled={isPending}
                    placeholder={labels.personPlaceholder}
                    data-testid="approval-step-person-search"
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">{labels.personHint}</p>
                  {searching && (
                    <p className="text-xs text-muted-foreground">{labels.searching}</p>
                  )}
                  {!searching && query.trim().length >= 2 && shown.length === 0 && (
                    <p className="text-xs text-muted-foreground" data-testid="approval-step-no-matches">
                      {labels.noMatches}
                    </p>
                  )}
                  {shown.length > 0 && (
                    <ul
                      className="max-h-48 divide-y divide-border overflow-y-auto rounded-lg border border-border"
                      data-testid="approval-step-person-results"
                    >
                      {shown.map((c) => (
                        <li key={c.id}>
                          <button
                            type="button"
                            disabled={isPending}
                            data-testid={`approval-step-person-${c.id}`}
                            onClick={() => setPicked(c)}
                            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm hover:bg-accent"
                          >
                            <span>{c.fullName}</span>
                            <span className="font-mono text-xs text-muted-foreground">
                              {c.personnelNo ?? c.employeeCode}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="step-order">{labels.order}</Label>
            <Input
              id="step-order"
              type="number"
              min={1}
              max={99}
              value={order}
              disabled={isPending}
              className="w-24"
              data-testid="approval-step-new-order"
              onChange={(e) => setOrder(Number(e.target.value))}
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive" data-testid="approval-step-add-error">
              {labels.errorLabel}: {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            disabled={isPending}
            data-testid="approval-step-add-cancel"
            onClick={() => setOpen(false)}
          >
            {labels.cancel}
          </Button>
          <Button
            disabled={!canSubmit || isPending}
            data-testid="approval-step-add-confirm"
            onClick={submit}
          >
            {isPending ? labels.adding : labels.add}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
