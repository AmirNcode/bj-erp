'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { runAllAccruals } from '@/lib/actions/leave';
import { Button } from '@/components/ui/button';
import { formatNumber } from '@/lib/i18n/format';

type Labels = {
  title: string;
  hint: string;
  run: string;
  resultTitle: string;
  /** e.g. "{employees} employees · {rows} entries posted" — filled here, not by next-intl. */
  employeesLabel: string;
  rowsLabel: string;
  nothingToDo: string;
  errorLabel: string;
};

/**
 * Manual trigger for monthly accrual (spec §6.4).
 *
 * Accrual is lazy — it also runs whenever anyone reads a balance — so this button
 * is not what makes it correct. It exists so an admin can force it and *see the
 * result*, instead of trusting invisible machinery, and so a month can be posted
 * for everyone at once rather than one employee at a time as pages are opened.
 */
export function AccrualRunner({ labels, locale }: { labels: Labels; locale: string }) {
  const [result, setResult] = useState<{ employees: number; rowsPosted: number } | null>(null);
  const [errMsg, setErrMsg] = useState('');
  const [isPending, startTransition] = useTransition();

  const onRun = () => {
    setErrMsg('');
    setResult(null);
    startTransition(async () => {
      const res = await runAllAccruals();
      if (res.ok) {
        setResult({ employees: res.employees, rowsPosted: res.rowsPosted });
        toast.success(res.rowsPosted > 0 ? labels.resultTitle : labels.nothingToDo);
      } else {
        setErrMsg(res.error);
        toast.error(`${labels.errorLabel}: ${res.error}`);
      }
    });
  };

  return (
    <section className="space-y-4" data-testid="accrual-runner">
      <div>
        <p className="text-sm font-medium">{labels.title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{labels.hint}</p>
      </div>

      <Button onClick={onRun} disabled={isPending} data-testid="accrual-run-btn">
        {isPending ? '…' : labels.run}
      </Button>

      {result && (
        <div
          className="rounded-lg border border-success/20 bg-success/10 px-4 py-3 text-sm text-success"
          data-testid="accrual-result"
        >
          {result.rowsPosted === 0 ? (
            labels.nothingToDo
          ) : (
            <>
              {formatNumber(result.employees, locale)} {labels.employeesLabel} ·{' '}
              {formatNumber(result.rowsPosted, locale)} {labels.rowsLabel}
            </>
          )}
        </div>
      )}

      {errMsg && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          data-testid="accrual-error"
        >
          {labels.errorLabel}: {errMsg}
        </p>
      )}
    </section>
  );
}
