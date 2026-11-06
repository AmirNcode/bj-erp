'use client';

/**
 * FR-85: adds time to a leave balance with a reason, saved at once and separately
 * from the form's Save. It sits inside the Edit Employee <form>, so its inputs are
 * unnamed, its button is type="button", and Enter must not submit the main form.
 */

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { addLeaveBalance } from '@/lib/actions/leave/balances';
import type { BalanceItem } from '@/lib/leave/balances';
import { daysHoursToMinutes, formatDuration } from '@/lib/leave/duration';
import { durationLabelsFrom } from '@/lib/leave/durationLabels';
import { nativeSelectClass } from '@/lib/native-select';

export function BalanceQuickAdd({ employeeId, balances, hoursPerDay }: {
  employeeId: string;
  balances: BalanceItem[];
  hoursPerDay: number;
}) {
  const t = useTranslations('manage.employees.quickAdd');
  const tLeave = useTranslations('leave');
  const locale = useLocale();
  const router = useRouter();
  const [leaveTypeId, setLeaveTypeId] = useState(balances[0]?.leaveTypeId ?? '');
  const [days, setDays] = useState('');
  const [hours, setHours] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [pending, startTransition] = useTransition();
  // A double click lands before the disabled state has rendered.
  const busy = useRef(false);

  const submit = () => {
    if (busy.current) return;
    setError(''); setDone('');
    const amount = daysHoursToMinutes(
      { days: Number(days || 0), hours: Number(hours || 0), restMinutes: 0 },
      hoursPerDay,
      { allowNegative: false }
    );
    if (!amount.ok || amount.minutes <= 0) { setError(t('invalidAmount')); return; }
    if (reason.trim() === '') { setError(t('reasonRequired')); return; }

    busy.current = true;
    startTransition(async () => {
      const result = await addLeaveBalance(employeeId, leaveTypeId, amount.minutes, reason);
      busy.current = false;
      if (!result.ok) { setError(result.error); return; }
      setDone(t('done', {
        balance: formatDuration(result.balanceMinutes, hoursPerDay, locale, durationLabelsFrom(tLeave)),
      }));
      setDays(''); setHours(''); setReason('');
      router.refresh();
    });
  };

  return (
    <div className="space-y-3" onKeyDown={(e) => {
      if (e.key === 'Enter' && e.target instanceof HTMLInputElement) e.preventDefault();
    }}>
      {balances.length > 1 && (
        <div className="space-y-1.5">
          <Label htmlFor="quick-add-type">{t('leaveType')}</Label>
          <select id="quick-add-type" className={nativeSelectClass} value={leaveTypeId} disabled={pending}
            onChange={(e) => setLeaveTypeId(e.target.value)} data-testid="quick-add-type">
            {balances.map((b) => (
              <option key={b.leaveTypeId} value={b.leaveTypeId}>
                {locale === 'fa' ? b.name_fa : b.name_en ?? b.name_fa}
              </option>
            ))}
          </select>
        </div>
      )}
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">{t('amount')}</legend>
        <div className="flex gap-2">
          <div className="flex flex-1 items-center gap-1.5">
            <Input id="quick-add-days" type="number" min={0} step={1} value={days} disabled={pending}
              onChange={(e) => setDays(e.target.value)} className="min-w-0" data-testid="quick-add-amount-days" />
            <Label htmlFor="quick-add-days" className="shrink-0 text-xs font-normal text-muted-foreground">{tLeave('days')}</Label>
          </div>
          <div className="flex flex-1 items-center gap-1.5">
            <Input id="quick-add-hours" type="number" min={0} step={1} value={hours} disabled={pending}
              onChange={(e) => setHours(e.target.value)} className="min-w-0" data-testid="quick-add-amount-hours" />
            <Label htmlFor="quick-add-hours" className="shrink-0 text-xs font-normal text-muted-foreground">{tLeave('hours')}</Label>
          </div>
        </div>
      </fieldset>
      <div className="space-y-1.5">
        <Label htmlFor="quick-add-reason">{t('reason')}</Label>
        <Textarea id="quick-add-reason" rows={2} maxLength={500} value={reason} disabled={pending}
          onChange={(e) => setReason(e.target.value)} data-testid="quick-add-reason" />
        <p className="text-xs text-muted-foreground">{t('hint')}</p>
      </div>
      {error && <p role="alert" className="text-sm text-destructive" data-testid="quick-add-error">{error}</p>}
      {done && <p role="status" className="text-sm text-primary" data-testid="quick-add-done">{done}</p>}
      <Button type="button" variant="outline" onClick={submit} disabled={pending} data-testid="quick-add-submit">
        {pending ? t('adding') : t('submit')}
      </Button>
    </div>
  );
}
