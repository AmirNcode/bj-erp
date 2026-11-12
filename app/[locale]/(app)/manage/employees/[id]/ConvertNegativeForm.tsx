'use client';

/**
 * FR-92: converts part (or all) of a negative annual balance to unpaid leave,
 * saved at once and separately from the form's Save. It sits inside the Edit
 * Employee <form>, so its button is type="button" and Enter must not submit.
 */

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { convertNegative } from '@/lib/actions/leave/unpaidConversions';
import { readDaysHours, DaysHoursField } from '../_components/EmployeeFormParts';
import { PendingBalanceWarning } from './PendingBalanceWarning';

const NAME = 'convert_amount';

export function ConvertNegativeForm({ employeeId, balanceMinutes, hoursPerDay, pendingCount = 0, typeName = '' }: {
  employeeId: string;
  balanceMinutes: number;
  hoursPerDay: number;
  pendingCount?: number;
  typeName?: string;
}) {
  const t = useTranslations('manage.employees.convertOne');
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [pending, startTransition] = useTransition();

  if (balanceMinutes >= 0) return null;

  const submit = () => {
    if (busy.current || !box.current) return;
    setError(''); setDone('');
    const fd = new FormData();
    for (const part of ['days', 'hours', 'rest']) {
      const el = box.current.querySelector<HTMLInputElement>(`[name="${NAME}_${part}"]`);
      fd.set(`${NAME}_${part}`, el?.value ?? '');
    }
    const amount = readDaysHours(fd, NAME, hoursPerDay, { allowNegative: false });
    if (!amount.ok || amount.minutes <= 0) { setError(t('invalidAmount')); return; }

    busy.current = true;
    startTransition(async () => {
      const result = await convertNegative(employeeId, amount.minutes, note);
      busy.current = false;
      if (!result.ok) { setError(result.error); return; }
      setDone(t('done'));
      setNote('');
      router.refresh();
    });
  };

  return (
    <div
      ref={box}
      className="space-y-3"
      data-testid="convert-negative-form"
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target instanceof HTMLInputElement) e.preventDefault();
      }}
    >
      <span className="block text-sm font-semibold">{t('title')}</span>
      <PendingBalanceWarning count={pendingCount} typeName={typeName} />
      <DaysHoursField
        // Uncontrolled: remount when the balance changes so the default follows it.
        key={balanceMinutes}
        name={NAME}
        label={t('amount')}
        minutes={-balanceMinutes}
        hoursPerDay={hoursPerDay}
        allowNegative={false}
        testId="convert-one-days"
        hoursTestId="convert-one-hours"
      />
      <div className="space-y-1.5">
        <Label htmlFor="convert-one-note">{t('note')}</Label>
        <Textarea id="convert-one-note" rows={2} maxLength={500} value={note} disabled={pending}
          onChange={(e) => setNote(e.target.value)} data-testid="convert-one-note" />
      </div>
      {error && <p role="alert" className="text-sm text-destructive" data-testid="convert-one-error">{error}</p>}
      {done && <p role="status" className="text-sm text-primary" data-testid="convert-one-done">{done}</p>}
      <Button type="button" variant="outline" onClick={submit} disabled={pending} data-testid="convert-one-submit">
        {pending ? t('converting') : t('submit')}
      </Button>
    </div>
  );
}
