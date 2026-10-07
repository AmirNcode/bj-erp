'use client';

/**
 * Bulk employee import v2 (FR-45). Stages: template → upload + preview
 * (errors, warnings, departments to create, department managers, balance date)
 * → import → one-time credentials. Validation is `validateImportRows`; the
 * database re-checks inside `app_bulk_create_employees`.
 */

import { useMemo, useState } from 'react';
import { parseCsv, buildCsv } from '@/lib/csv/parse';
import {
  IMPORT_COLUMNS,
  templateHeader,
  validateImportRows,
  type ImportContext,
  type ImportMode,
  type RowError,
  type RowWarning,
} from '@/lib/csv/import-rows';
import {
  importEmployees,
  type ImportEmployeesResult,
  type IssuedCredential,
} from '@/lib/actions/employees';
import {
  buildImportPlan,
  DEFAULT_CHOICES,
  type ExistingDepartment,
  type ExistingEmployee,
  type ImportChoices,
} from '@/lib/csv/import-plan';
import { ImportPlanPanel, type PlanLabels } from './ImportPlanPanel';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { CredentialsDownload } from '@/components/CredentialsDownload';
import { PersianDateField } from '@/components/PersianDateField';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  dateObjectToGregorian,
  firstMonthStartAfter,
  gregorianToPersianDateObject,
  type PickerDate,
} from '@/lib/leave/dateConvert';
import { formatCalendarDate } from '@/lib/leave/calendarMonth';

type Props = {
  context: ImportContext;
  /** FR-49: the app's current people and departments, for the plan. */
  employees: ExistingEmployee[];
  existingDepartments: ExistingDepartment[];
  /** Add & update / Replace are admin-only. */
  isAdmin: boolean;
  locale: string;
  /** Today in Asia/Tehran, Gregorian ISO — the balance date may not be later. */
  today: string;
  labels: {
    intro: string;
    template: string;
    templateHint: string;
    upload: string;
    rowsValid: string;
    rowsInvalid: string;
    line: string;
    column: string;
    problem: string;
    import: string;
    importing: string;
    errorLabel: string;
    errors: Record<RowError['messageKey'], string>;
    warningsTitle: string;
    warnings: Record<RowWarning['messageKey'], string>;
    balanceDate: string;
    balanceDateHint: string;
    balanceDateFuture: string;
    /** Raw template: {month} {start}. */
    accrualStarts: string;
    departmentsTitle: string;
    departmentsHint: string;
    deptCode: string;
    deptName: string;
    deptManager: string;
    deptStatus: string;
    deptNew: string;
    deptNewGenerated: string;
    deptExisting: string;
    deptKept: string;
    noManager: string;
    ackDepartments: string;
    deptRenamed: string;
    deptManagerChanged: string;
    modes: {
      title: string;
      add: string;
      addHint: string;
      update: string;
      updateHint: string;
      replace: string;
      replaceHint: string;
      overwriteBalances: string;
      overwriteBalancesHint: string;
      replaceConfirmTitle: string;
      /** Raw: {deactivate} {deleteDepartments} {update} {create}. */
      replaceConfirmBody: string;
      replaceConfirm: string;
      cancel: string;
      doneTitle: string;
      /** Raw: {created} {updated} {deactivated}. */
      doneSummary: string;
      /** Raw: {codes}. */
      doneNotDeleted: string;
    };
    plan: PlanLabels;
  };
};

/** Fills `{name}` placeholders in a raw message. */
function fill(template: string, params: Record<string, string> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => params[k] ?? `{${k}}`);
}

const EXAMPLE_ROWS = [
  ['رضا کریمی', '1042', 'سرپرست خط', 'manager', 'PROD', 'تولید', 'Production', '', '1001', '1404/04/22', '12', '3'],
  ['علی رضایی', '1043', 'جوشکار', 'employee', 'PROD', '', '', '1042', '1001', '', '-1', '-4'],
];

export function ImportWizard({ context, employees, existingDepartments, isAdmin, locale, today, labels }: Props) {
  const [csvRows, setCsvRows] = useState<string[][] | null>(null);
  const [mode, setMode] = useState<ImportMode>('add');
  const [choices, setChoices] = useState<ImportChoices>(DEFAULT_CHOICES);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [done, setDone] = useState<ImportEmployeesResult | null>(null);
  const [balanceDate, setBalanceDate] = useState<string | null>(null);
  const [ack, setAck] = useState(false);
  const [pending, setPending] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const columnLabel = useMemo(
    () => new Map<string, string>(IMPORT_COLUMNS.map((c) => [c.key, c.labelFa])),
    []
  );

  const downloadTemplate = () => {
    const blob = new Blob([buildCsv([templateHeader()])], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bj-employees-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setServerError(null);
    setAck(false);
    setChoices(DEFAULT_CHOICES);
    setCsvRows(parseCsv(await file.text()));
  };

  const result = useMemo(
    () => (csvRows ? validateImportRows(csvRows, context, mode) : null),
    [csvRows, context, mode]
  );
  const plan = useMemo(
    () =>
      result
        ? buildImportPlan({ result, mode, employees, departments: existingDepartments, choices })
        : null,
    [result, mode, employees, existingDepartments, choices]
  );

  const rows = result?.rows ?? [];
  const errors = result?.errors ?? [];
  const warnings = result?.warnings ?? [];
  const departments = plan?.departments ?? result?.departments ?? [];
  const creates = departments.some((d) => d.create);
  const futureDate = !!balanceDate && balanceDate > today;
  const accrualStart = balanceDate ? firstMonthStartAfter(balanceDate) : null;
  const canImport =
    !pending &&
    rows.length > 0 &&
    errors.length === 0 &&
    !!balanceDate &&
    !futureDate &&
    (!creates || ack) &&
    (plan?.ready ?? false);

  const runImport = async () => {
    if (!result || !plan || !balanceDate) return;
    setConfirmOpen(false);
    setPending(true);
    setServerError(null);
    const response = await importEmployees({
      mode,
      rows: result.rows,
      departments: plan.departments,
      balanceAsOf: balanceDate,
      overwriteBalances: mode !== 'add' && choices.overwriteBalances,
      deactivate: mode === 'replace' ? plan.deactivate : [],
      reassign: mode === 'replace' ? plan.reassign : [],
      deleteDepartments: mode === 'replace' ? plan.deleteDepartments : [],
    });
    setPending(false);
    if (!response.ok) {
      setServerError(response.error);
      return;
    }
    setDone(response);
  };

  if (done) {
    const credentials: IssuedCredential[] = done.credentials;
    return (
      <div className="space-y-6">
        <Card>
          <CardContent className="space-y-2" data-testid="import-done">
            <h2 className="text-base font-semibold">{labels.modes.doneTitle}</h2>
            <p className="text-sm">
              {fill(labels.modes.doneSummary, {
                created: String(credentials.length),
                updated: String(done.updated),
                deactivated: String(done.deactivated),
              })}
            </p>
            {done.notDeletedDepartments.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {fill(labels.modes.doneNotDeleted, { codes: done.notDeletedDepartments.join(', ') })}
              </p>
            )}
          </CardContent>
        </Card>
        {credentials.length > 0 && (
          <CredentialsDownload credentials={credentials} />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stage 1 — template + on-screen example */}
      <Card>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{labels.intro}</p>
          <Button variant="outline" onClick={downloadTemplate} data-testid="template-download">
            {labels.template}
          </Button>
          <p className="text-sm text-muted-foreground">{labels.templateHint}</p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead className="border-b bg-muted/40">
                <tr>
                  {IMPORT_COLUMNS.map((c) => (
                    <th key={c.key} className="text-start px-2 py-1.5 font-semibold whitespace-nowrap">
                      {c.labelFa}
                      {c.required && <span className="text-destructive"> *</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {EXAMPLE_ROWS.map((cells, r) => (
                  <tr key={r} className="text-muted-foreground">
                    {cells.map((v, i) => (
                      <td key={i} className="px-2 py-1.5 whitespace-nowrap" dir="auto">
                        {v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {context.departments.length > 0 && (
            <div className="text-sm text-muted-foreground">
              {context.departments.map((d) => (
                <span key={d.code} className="inline-block me-4">
                  <span className="font-mono" dir="ltr">
                    {d.code}
                  </span>{' '}
                  = {locale === 'fa' ? d.name_fa : (d.name_en ?? d.name_fa)}
                </span>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Stage 2 — upload + validation preview */}
      <Card>
        <CardContent className="space-y-5">
          {isAdmin && (
            <fieldset className="space-y-2" data-testid="import-mode">
              <legend className="text-sm font-semibold">{labels.modes.title}</legend>
              {(['add', 'update', 'replace'] as const).map((m) => (
                <label key={m} className="flex items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name="import-mode"
                    className="mt-1"
                    checked={mode === m}
                    onChange={() => {
                      setMode(m);
                      setChoices(DEFAULT_CHOICES);
                    }}
                    data-testid={`import-mode-${m}`}
                  />
                  <span>
                    <span className="font-medium">{labels.modes[m]}</span>
                    <span className="block text-xs text-muted-foreground">
                      {labels.modes[`${m}Hint` as 'addHint' | 'updateHint' | 'replaceHint']}
                    </span>
                  </span>
                </label>
              ))}
              {mode !== 'add' && (
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={choices.overwriteBalances}
                    onChange={(e) => setChoices({ ...choices, overwriteBalances: e.target.checked })}
                    data-testid="import-overwrite-balances"
                  />
                  <span>
                    <span className="font-medium">{labels.modes.overwriteBalances}</span>
                    <span className="block text-xs text-muted-foreground">{labels.modes.overwriteBalancesHint}</span>
                  </span>
                </label>
              )}
            </fieldset>
          )}

          <input
            type="file"
            accept=".csv,text/csv"
            data-testid="csv-file"
            aria-label={labels.upload}
            className="block w-full text-sm file:me-4 file:rounded-lg file:border-0 file:bg-primary file:px-4 file:py-2 file:text-primary-foreground file:cursor-pointer"
            onChange={(e) => onFile(e.target.files?.[0])}
          />

          {result && (
            <div className="space-y-5" data-testid="import-preview">
              <p className="text-sm">
                <span className="text-success font-medium">
                  {labels.rowsValid}: {rows.length}
                </span>
                {errors.length > 0 && (
                  <span className="text-destructive font-medium ms-4">
                    {labels.rowsInvalid}: {errors.length}
                  </span>
                )}
              </p>

              {errors.length > 0 && (
                <div className="overflow-x-auto rounded-lg border border-destructive/30">
                  <table className="w-full text-sm" data-testid="import-errors">
                    <thead className="border-b bg-destructive/5">
                      <tr>
                        <th className="text-start px-3 py-2 font-semibold">{labels.line}</th>
                        <th className="text-start px-3 py-2 font-semibold">{labels.column}</th>
                        <th className="text-start px-3 py-2 font-semibold">{labels.problem}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {errors.map((err, i) => (
                        <tr key={i}>
                          <td className="px-3 py-2">{err.line}</td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {err.field === 'row' ? '—' : (columnLabel.get(err.field) ?? err.field)}
                          </td>
                          <td className="px-3 py-2 text-destructive">{labels.errors[err.messageKey]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {warnings.length > 0 && (
                <div className="space-y-2" data-testid="import-warnings">
                  <h3 className="text-sm font-semibold">{labels.warningsTitle}</h3>
                  <div className="overflow-x-auto rounded-lg border border-amber-500/40">
                    <table className="w-full text-sm">
                      <tbody className="divide-y divide-border">
                        {warnings.map((w, i) => (
                          <tr key={i}>
                            <td className="px-3 py-2 w-16">{w.line}</td>
                            <td className="px-3 py-2">{fill(labels.warnings[w.messageKey], w.params)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {plan && mode !== 'add' && (
                <ImportPlanPanel
                  plan={plan}
                  mode={mode}
                  choices={choices}
                  onChoices={setChoices}
                  labels={labels.plan}
                  locale={locale}
                />
              )}

              {departments.length > 0 && (
                <div className="space-y-2" data-testid="import-departments">
                  <h3 className="text-sm font-semibold">{labels.departmentsTitle}</h3>
                  <p className="text-xs text-muted-foreground">{labels.departmentsHint}</p>
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full text-sm">
                      <thead className="border-b bg-muted/40">
                        <tr>
                          <th className="text-start px-3 py-2 font-semibold">{labels.deptCode}</th>
                          <th className="text-start px-3 py-2 font-semibold">{labels.deptName}</th>
                          <th className="text-start px-3 py-2 font-semibold">{labels.deptManager}</th>
                          <th className="text-start px-3 py-2 font-semibold">{labels.deptStatus}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {departments.map((d) => (
                          <tr key={d.code} data-testid={`import-dept-${d.code}`}>
                            <td className="px-3 py-2 font-mono" dir="ltr">
                              {d.code}
                            </td>
                            <td className="px-3 py-2">
                              {d.name_fa}
                              <span className="ms-2 text-xs text-muted-foreground" dir="ltr">
                                {d.name_en}
                              </span>
                            </td>
                            <td className="px-3 py-2">{d.managerName ?? labels.noManager}</td>
                            <td className="px-3 py-2 text-xs">
                              {d.create ? (
                                <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary">
                                  {d.generated ? labels.deptNewGenerated : labels.deptNew}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">
                                  {d.keptExistingManager
                                    ? labels.deptKept
                                    : d.rename && d.managerChange
                                      ? `${labels.deptRenamed} · ${labels.deptManagerChanged}`
                                      : d.rename
                                        ? labels.deptRenamed
                                        : d.managerChange
                                          ? labels.deptManagerChanged
                                          : labels.deptExisting}
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {creates && (
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={ack}
                        onChange={(e) => setAck(e.target.checked)}
                        className="size-4 rounded border-input"
                        data-testid="import-ack-departments"
                      />
                      {labels.ackDepartments}
                    </label>
                  )}
                </div>
              )}

              <div className="space-y-1.5" data-testid="import-balance-date">
                <label htmlFor="balance-date" className="text-sm font-semibold">
                  {labels.balanceDate}
                </label>
                <p className="text-xs text-muted-foreground">{labels.balanceDateHint}</p>
                <div className="max-w-xs">
                  <PersianDateField
                    id="balance-date"
                    locale={locale}
                    value={balanceDate ? gregorianToPersianDateObject(balanceDate, locale) : null}
                    onChange={(d: PickerDate | null) => setBalanceDate(d ? dateObjectToGregorian(d) : null)}
                    testId="import-balance-date-field"
                  />
                </div>
                {futureDate ? (
                  <p className="text-xs text-destructive" data-testid="import-balance-date-future">
                    {labels.balanceDateFuture}
                  </p>
                ) : balanceDate && accrualStart ? (
                  <p className="text-xs text-muted-foreground" data-testid="import-accrual-start">
                    {fill(labels.accrualStarts, {
                      month: formatCalendarDate(balanceDate, locale, 'MMMM YYYY'),
                      start: formatCalendarDate(accrualStart, locale, 'D MMMM YYYY'),
                    })}
                  </p>
                ) : null}
              </div>

              {serverError && (
                <p
                  role="alert"
                  className="bg-destructive/10 border border-destructive/20 text-destructive px-4 py-3 rounded-lg text-sm"
                >
                  {labels.errorLabel}: {serverError}
                </p>
              )}

              <Button
                onClick={() => (mode === 'replace' ? setConfirmOpen(true) : runImport())}
                disabled={!canImport}
                data-testid="import-submit"
              >
                {pending ? labels.importing : `${labels.import} (${rows.length})`}
              </Button>

              {/* Replace deactivates people and deletes departments: confirm with the counts. */}
              <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <AlertDialogContent size="sm">
                  <AlertDialogHeader>
                    <AlertDialogTitle>{labels.modes.replaceConfirmTitle}</AlertDialogTitle>
                    <AlertDialogDescription data-testid="import-replace-confirm-body">
                      {fill(labels.modes.replaceConfirmBody, {
                        create: String(plan?.creates.length ?? 0),
                        update: String(plan?.updates.length ?? 0),
                        deactivate: String(plan?.deactivate.length ?? 0),
                        deleteDepartments: String(plan?.deleteDepartments.length ?? 0),
                      })}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{labels.modes.cancel}</AlertDialogCancel>
                    <AlertDialogAction
                      variant="destructive"
                      onClick={runImport}
                      data-testid="import-replace-confirm"
                    >
                      {labels.modes.replaceConfirm}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
