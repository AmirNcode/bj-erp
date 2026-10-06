'use client';

/**
 * What an Add & update / Replace import will do (FR-49): counts, the people
 * the file leaves out with their deactivate/keep choice, conflicts that must
 * be answered, and departments that will be deleted or kept. Pure rendering —
 * the plan comes from lib/csv/import-plan.ts.
 */

import type { ImportChoices, ImportPlan, MissingDecision } from '@/lib/csv/import-plan';
import type { ImportMode } from '@/lib/csv/import-rows';

export type PlanLabels = {
  summaryTitle: string;
  creates: string;
  updates: string;
  reactivations: string;
  deactivations: string;
  deptCreates: string;
  deptRenames: string;
  deptManagerChanges: string;
  deptDeletes: string;
  deptKept: string;
  pendingSignerChanges: string;
  updatesTitle: string;
  reactivationsTitle: string;
  missingTitle: string;
  missingHint: string;
  missingDefault: string;
  deactivate: string;
  keep: string;
  overridden: string;
  conflictsTitle: string;
  conflictsHint: string;
  conflict: { sameName: string; managerDeactivated: string; deptManagerReplaced: string };
  option: {
    deactivateOld: string;
    keepBoth: string;
    deactivateToo: string;
    noManager: string;
    pickManager: string;
    fileReplaces: string;
    keepAsManager: string;
  };
  pickManagerPlaceholder: string;
  deletedTitle: string;
  keptTitle: string;
  keptHint: string;
};

type Props = {
  plan: ImportPlan;
  mode: ImportMode;
  choices: ImportChoices;
  onChoices: (next: ImportChoices) => void;
  labels: PlanLabels;
  locale: string;
};

function fill(template: string, params: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`));
}

export function ImportPlanPanel({ plan, mode, choices, onChoices, labels, locale }: Props) {
  const fmt = (n: number) => new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US').format(n);
  const count = (template: string, n: number) => fill(template, { count: fmt(n) });

  const deptCreates = plan.departments.filter((d) => d.create).length;
  const deptRenames = plan.departments.filter((d) => d.rename).length;
  const deptManagerChanges = plan.departments.filter((d) => d.managerChange).length;

  const summary: [string, number][] = [
    [labels.creates, plan.creates.length],
    [labels.updates, plan.updates.length],
    [labels.reactivations, plan.reactivations.length],
    [labels.deactivations, plan.deactivate.length],
    [labels.deptCreates, deptCreates],
    [labels.deptRenames, deptRenames],
    [labels.deptManagerChanges, deptManagerChanges],
    [labels.deptDeletes, plan.deleteDepartments.length],
    [labels.deptKept, plan.keptDepartments.length],
  ];

  const setOverride = (id: string, decision: MissingDecision) =>
    onChoices({ ...choices, overrides: { ...choices.overrides, [id]: decision } });

  return (
    <div className="space-y-5" data-testid="import-plan">
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">{labels.summaryTitle}</h3>
        <ul className="flex flex-wrap gap-2 text-xs" data-testid="import-plan-summary">
          {summary
            .filter(([, n]) => n > 0)
            .map(([template, n]) => (
              <li key={template} className="rounded-full bg-secondary px-2.5 py-1">
                {count(template, n)}
              </li>
            ))}
        </ul>
        {plan.pendingSignerChanges > 0 && (
          <p className="text-xs text-muted-foreground" data-testid="import-plan-pending">
            {count(labels.pendingSignerChanges, plan.pendingSignerChanges)}
          </p>
        )}
      </div>

      {plan.updates.length > 0 && (
        <details className="rounded-lg border border-border px-3 py-2 text-sm" data-testid="import-plan-updates">
          <summary className="cursor-pointer font-medium">{count(labels.updatesTitle, plan.updates.length)}</summary>
          <p className="mt-2 text-muted-foreground">{plan.updates.map((r) => r.full_name).join('، ')}</p>
        </details>
      )}

      {plan.reactivations.length > 0 && (
        <details className="rounded-lg border border-border px-3 py-2 text-sm" data-testid="import-plan-reactivations">
          <summary className="cursor-pointer font-medium">
            {count(labels.reactivationsTitle, plan.reactivations.length)}
          </summary>
          <p className="mt-2 text-muted-foreground">{plan.reactivations.map((r) => r.full_name).join('، ')}</p>
        </details>
      )}

      {mode === 'replace' && plan.missing.length > 0 && (
        <div className="space-y-2" data-testid="import-missing">
          <h3 className="text-sm font-semibold">{count(labels.missingTitle, plan.missing.length)}</h3>
          <p className="text-xs text-muted-foreground">{labels.missingHint}</p>
          <fieldset className="flex flex-wrap items-center gap-4 text-sm">
            <legend className="sr-only">{labels.missingDefault}</legend>
            <span className="text-muted-foreground">{labels.missingDefault}:</span>
            {(['deactivate', 'keep'] as const).map((d) => (
              <label key={d} className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="missing-default"
                  checked={choices.missingDefault === d}
                  onChange={() => onChoices({ ...choices, missingDefault: d, overrides: {} })}
                  data-testid={`import-missing-default-${d}`}
                />
                {d === 'deactivate' ? labels.deactivate : labels.keep}
              </label>
            ))}
          </fieldset>
          <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border">
            {plan.missing.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm" data-testid={`import-missing-${m.id}`}>
                <span>
                  {m.fullName}
                  {m.personnelNo && (
                    <span className="ms-2 font-mono text-xs text-muted-foreground" dir="ltr">
                      {m.personnelNo}
                    </span>
                  )}
                  {m.overridden && (
                    <span className="ms-2 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">{labels.overridden}</span>
                  )}
                </span>
                <select
                  value={m.decision}
                  onChange={(e) => setOverride(m.id, e.target.value as MissingDecision)}
                  className="h-8 rounded-md border border-input bg-background ps-2 text-sm"
                  data-testid={`import-missing-decision-${m.id}`}
                >
                  <option value="deactivate">{labels.deactivate}</option>
                  <option value="keep">{labels.keep}</option>
                </select>
              </li>
            ))}
          </ul>
        </div>
      )}

      {plan.conflicts.length > 0 && (
        <div className="space-y-2" data-testid="import-conflicts">
          <h3 className="text-sm font-semibold text-destructive">{count(labels.conflictsTitle, plan.conflicts.length)}</h3>
          <p className="text-xs text-muted-foreground">{labels.conflictsHint}</p>
          <ul className="space-y-2">
            {plan.conflicts.map((c) => (
              <li
                key={c.id}
                className="space-y-2 rounded-lg border border-destructive/30 px-3 py-2 text-sm"
                data-testid={`import-conflict-${c.id}`}
              >
                <p>{fill(labels.conflict[c.kind], { name: c.personName, ...c.params })}</p>
                <div className="flex flex-wrap items-center gap-4">
                  {c.options.map((o) => (
                    <label key={o} className="flex items-center gap-1.5">
                      <input
                        type="radio"
                        name={c.id}
                        checked={c.choice === o}
                        onChange={() => onChoices({ ...choices, resolutions: { ...choices.resolutions, [c.id]: o } })}
                        data-testid={`import-conflict-${c.id}-${o}`}
                      />
                      {labels.option[o]}
                    </label>
                  ))}
                  {c.choice === 'pickManager' && (
                    <select
                      value={choices.pickedManagers[c.id] ?? ''}
                      onChange={(e) =>
                        onChoices({ ...choices, pickedManagers: { ...choices.pickedManagers, [c.id]: e.target.value } })
                      }
                      className="h-8 rounded-md border border-input bg-background ps-2 text-sm"
                      data-testid={`import-conflict-${c.id}-picked`}
                    >
                      <option value="">{labels.pickManagerPlaceholder}</option>
                      {plan.managerCandidates.map((m) => (
                        <option key={m.personnelNo} value={m.personnelNo}>
                          {m.fullName}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {plan.deleteDepartments.length > 0 && (
        <p className="text-sm" data-testid="import-dept-deletes">
          <span className="font-semibold">{labels.deletedTitle}: </span>
          <span className="font-mono" dir="ltr">
            {plan.deleteDepartments.join(', ')}
          </span>
        </p>
      )}
      {plan.keptDepartments.length > 0 && (
        <p className="text-sm" data-testid="import-dept-kept">
          <span className="font-semibold">{labels.keptTitle}: </span>
          <span className="font-mono" dir="ltr">
            {plan.keptDepartments.join(', ')}
          </span>
          <span className="block text-xs text-muted-foreground">{labels.keptHint}</span>
        </p>
      )}
    </div>
  );
}
