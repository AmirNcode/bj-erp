'use client';

/**
 * FR-92: bulk-converts negative annual balances to unpaid leave. Opening the
 * dialog loads everyone the caller may convert; the confirm step names the count
 * and the total. The database skips anyone no longer negative.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Scale } from 'lucide-react';
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
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  convertNegatives,
  getNegativeBalances,
  type NegativeBalanceRow,
} from '@/lib/actions/leave/unpaidConversions';
import { formatDuration } from '@/lib/leave/duration';
import { durationLabelsFrom } from '@/lib/leave/durationLabels';
import { formatNumber } from '@/lib/i18n/format';

export function ConvertNegativesDialog({ hoursPerDay }: { hoursPerDay: number }) {
  const t = useTranslations('manage.employees.convert');
  const tLeave = useTranslations('leave');
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<NegativeBalanceRow[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const [loading, startLoading] = useTransition();
  const [converting, startConverting] = useTransition();

  const dur = (m: number) => formatDuration(m, hoursPerDay, locale, durationLabelsFrom(tLeave));

  const onOpenChange = (next: boolean) => {
    if (converting) return;
    setOpen(next);
    setError('');
    if (!next) return;
    setRows(null);
    setSelected(new Set());
    startLoading(async () => {
      const r = await getNegativeBalances();
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setRows(r.rows);
    });
  };

  const all = rows ?? [];
  const chosen = all.filter((r) => selected.has(r.employeeId));
  const total = chosen.reduce((sum, r) => sum + r.balanceMinutes, 0);
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const run = () => {
    setError('');
    startConverting(async () => {
      const r = await convertNegatives(chosen.map((x) => x.employeeId));
      setConfirming(false);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      toast.success(t('done', { count: formatNumber(r.converted, locale) }));
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" data-testid="convert-negatives-open">
          <Scale aria-hidden="true" />
          {t('open')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('hint')}</DialogDescription>
        </DialogHeader>

        {loading && rows === null && <p className="text-sm text-muted-foreground">{t('loading')}</p>}
        {error && (
          <p role="alert" className="text-sm text-destructive" data-testid="convert-error">
            {error}
          </p>
        )}
        {rows && rows.length === 0 && (
          <p className="text-sm text-muted-foreground" data-testid="convert-empty">{t('empty')}</p>
        )}

        {rows && rows.length > 0 && (
          <div className="max-h-80 overflow-auto">
            <table className="data-table w-full text-sm" data-testid="convert-table">
              <thead>
                <tr>
                  <th className="w-10">
                    <input
                      type="checkbox"
                      aria-label={t('selectAll')}
                      data-testid="convert-select-all"
                      checked={selected.size === rows.length}
                      onChange={(e) =>
                        setSelected(e.target.checked ? new Set(rows.map((r) => r.employeeId)) : new Set())
                      }
                    />
                  </th>
                  <th className="text-start">{t('name')}</th>
                  <th className="text-start">{t('personnelNo')}</th>
                  <th className="text-start">{t('department')}</th>
                  <th className="text-start">{t('balance')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.employeeId}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={t('selectRow', { name: r.fullName })}
                        data-testid={`convert-row-${r.employeeId}`}
                        checked={selected.has(r.employeeId)}
                        onChange={() => toggle(r.employeeId)}
                      />
                    </td>
                    <td>{r.fullName}</td>
                    <td><bdi className="font-mono">{r.personnelNo ?? '—'}</bdi></td>
                    <td>{r.departmentName}</td>
                    <td className="text-destructive"><bdi>{dur(r.balanceMinutes)}</bdi></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {rows && rows.length > 0 && (
          <div className="flex justify-end">
            <Button
              type="button"
              disabled={chosen.length === 0 || converting}
              onClick={() => setConfirming(true)}
              data-testid="convert-negatives-submit"
            >
              {t('convert')}
            </Button>
          </div>
        )}

        <AlertDialog open={confirming} onOpenChange={(v) => !converting && setConfirming(v)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('title')}</AlertDialogTitle>
              <AlertDialogDescription data-testid="convert-confirm-body">
                {t('confirm', {
                  count: formatNumber(chosen.length, locale),
                  total: `⁨${dur(total)}⁩`,
                })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={converting}>{t('cancel')}</AlertDialogCancel>
              <AlertDialogAction
                disabled={converting}
                onClick={(e) => {
                  e.preventDefault();
                  run();
                }}
                data-testid="convert-confirm"
              >
                {converting ? t('converting') : t('convert')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
