'use client';

/**
 * Bulk holiday upload (FR-40).
 *
 * Deliberately a dialog beside the existing Add form rather than its own page,
 * unlike the employee import: an employee import issues credentials and needs a
 * result screen the admin must act on, whereas this returns to the list it just
 * changed.
 *
 * Nothing is written until the whole file parses. The confirm button is the only
 * thing that writes, and it is not offered while any line has a problem — so the
 * admin cannot half-import a file and then wonder which rows landed.
 */

import { useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { parseCsv, buildCsv } from '@/lib/csv/parse';
import {
  holidayTemplateHeader,
  holidayTemplateRows,
  validateHolidayRows,
  importCounts,
  type HolidayRow,
  type HolidayRowError,
} from '@/lib/csv/holiday-rows';
import { bulkUpsertHolidays } from '@/lib/actions/settings';
import { formatCalendarDate } from '@/lib/leave/calendarMonth';
import { formatNumber } from '@/lib/i18n/format';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

export type HolidayImportLabels = {
  button: string;
  title: string;
  intro: string;
  template: string;
  templateHint: string;
  upload: string;
  recurringWarning: string;
  previewTitle: string;
  willAdd: string;
  willUpdate: string;
  problemsTitle: string;
  line: string;
  problem: string;
  confirm: string;
  importing: string;
  done: string;
  cancel: string;
  columnDate: string;
  columnNameFa: string;
  columnNameEn: string;
  columnRecurring: string;
  yes: string;
  no: string;
  errors: Record<HolidayRowError['messageKey'], string>;
};

type Props = {
  /** Gregorian ISO dates already stored — decides added vs overwritten. */
  existingDates: string[];
  locale: string;
  labels: HolidayImportLabels;
  errorLabel: string;
  /** Re-read the list after a successful import. */
  onImported: () => void;
};

export function HolidayImportDialog({
  existingDates,
  locale,
  labels,
  errorLabel,
  onImported,
}: Props) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<HolidayRow[]>([]);
  const [errors, setErrors] = useState<HolidayRowError[]>([]);
  const [fileLoaded, setFileLoaded] = useState(false);
  const [serverError, setServerError] = useState('');
  const [isPending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  const reset = () => {
    setRows([]);
    setErrors([]);
    setFileLoaded(false);
    setServerError('');
    if (fileInput.current) fileInput.current.value = '';
  };

  const downloadTemplate = () => {
    const csv = buildCsv([holidayTemplateHeader(), ...holidayTemplateRows()]);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bj-holidays-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setServerError('');
    const text = await file.text();
    const result = validateHolidayRows(parseCsv(text), { existingDates });
    setRows(result.rows);
    setErrors(result.errors);
    setFileLoaded(true);
  };

  const runImport = () => {
    setServerError('');
    startTransition(async () => {
      const result = await bulkUpsertHolidays(
        rows.map((r) => ({
          date: r.holiday_date,
          nameFa: r.name_fa,
          nameEn: r.name_en,
          isRecurring: r.is_recurring,
        }))
      );
      if (!result.ok) {
        setServerError(result.error);
        toast.error(`${errorLabel}: ${result.error}`);
        return;
      }
      toast.success(
        labels.done
          .replace('{added}', formatNumber(result.added, locale))
          .replace('{updated}', formatNumber(result.updated, locale))
      );
      reset();
      setOpen(false);
      onImported();
    });
  };

  const counts = importCounts(rows);
  const canImport = fileLoaded && errors.length === 0 && rows.length > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" data-testid="holiday-import-open">
          {labels.button}
        </Button>
      </DialogTrigger>
      <DialogContent
        className="sm:max-w-2xl"
        // A parsed file is unsaved work. Radix closes on Escape and on a click
        // outside, and the dialog grows when the preview table renders — which
        // moved the footer far enough that a click aimed at Confirm could land on
        // the overlay instead, dismissing the dialog and silently discarding the
        // upload with no message. Both dismissals are refused while rows are
        // waiting; Cancel and the X still work, because those are deliberate.
        onEscapeKeyDown={(e) => {
          if (rows.length > 0) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          if (rows.length > 0) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription>{labels.intro}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Button
              variant="outline"
              onClick={downloadTemplate}
              data-testid="holiday-template-download"
            >
              {labels.template}
            </Button>
            <p className="text-xs text-muted-foreground">{labels.templateHint}</p>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="holiday-csv"
              className="block text-sm font-medium leading-none"
            >
              {labels.upload}
            </label>
            <input
              id="holiday-csv"
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              data-testid="holiday-csv-input"
              disabled={isPending}
              onChange={(e) => onFile(e.target.files?.[0])}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
            />
          </div>

          {/* The same caveat the editor already carries: is_recurring is a note,
              not a rule — day counting matches exact dates. */}
          <p className="rounded-lg bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
            {labels.recurringWarning}
          </p>

          {fileLoaded && errors.length > 0 && (
            <div className="space-y-2" data-testid="holiday-import-errors">
              <p className="text-sm font-medium text-destructive">{labels.problemsTitle}</p>
              <div className="max-h-48 overflow-auto rounded-lg border border-destructive/30">
                <table className="w-full text-xs">
                  <thead className="border-b bg-destructive/10">
                    <tr>
                      <th className="px-2 py-1 text-start">{labels.line}</th>
                      <th className="px-2 py-1 text-start">{labels.problem}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {errors.map((e, i) => (
                      <tr key={`${e.line}-${e.field}-${i}`} className="border-b last:border-0">
                        <td className="px-2 py-1 font-mono">{e.line}</td>
                        <td className="px-2 py-1">{labels.errors[e.messageKey]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {canImport && (
            <div className="space-y-2" data-testid="holiday-import-preview">
              <p className="text-sm font-medium">{labels.previewTitle}</p>
              <p className="text-xs text-muted-foreground">
                <span data-testid="holiday-import-added">
                  {labels.willAdd.replace('{count}', formatNumber(counts.added, locale))}
                </span>
                {counts.updated > 0 && (
                  <>
                    {' · '}
                    <span data-testid="holiday-import-updated">
                      {labels.willUpdate.replace('{count}', formatNumber(counts.updated, locale))}
                    </span>
                  </>
                )}
              </p>
              <div className="max-h-56 overflow-auto rounded-lg border border-border">
                <table className="w-full text-xs">
                  <thead className="border-b bg-muted/40">
                    <tr>
                      <th className="px-2 py-1 text-start">{labels.columnDate}</th>
                      <th className="px-2 py-1 text-start">{labels.columnNameFa}</th>
                      <th className="px-2 py-1 text-start">{labels.columnNameEn}</th>
                      <th className="px-2 py-1 text-start">{labels.columnRecurring}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.holiday_date} className="border-b last:border-0">
                        {/* Rendered from the stored Gregorian value, so the admin
                            sees what the app will show, not what they typed. */}
                        <td className="px-2 py-1">
                          {formatCalendarDate(r.holiday_date, locale)}
                        </td>
                        <td className="px-2 py-1">{r.name_fa}</td>
                        <td className="px-2 py-1">{r.name_en ?? '—'}</td>
                        <td className="px-2 py-1">{r.is_recurring ? labels.yes : labels.no}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {serverError && (
            <p
              role="alert"
              data-testid="holiday-import-error"
              className="text-sm text-destructive"
            >
              {errorLabel}: {serverError}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={isPending}
            data-testid="holiday-import-cancel"
          >
            {labels.cancel}
          </Button>
          <Button
            onClick={runImport}
            disabled={!canImport || isPending}
            data-testid="holiday-import-confirm"
          >
            {isPending ? labels.importing : labels.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
