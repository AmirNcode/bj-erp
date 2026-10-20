'use client';

/**
 * FR-70: after a trip is cancelled, procurement cancels the bookings outside the
 * app and records what could not be refunded — fees, non-refundable nights; 0 when
 * nothing was booked. Finance then sees only this amount for the trip.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { parseRials } from '@/lib/leave/perDiem';
import { settleTravelBooking } from '@/lib/actions/travel';

export function SettleForm({ requestId }: { requestId: string }) {
  const t = useTranslations('travel');
  const router = useRouter();
  const [lost, setLost] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  const settle = (lostRials: number) => {
    setError('');
    startTransition(async () => {
      const res = await settleTravelBooking({ requestId, lostRials, note });
      if (!res.ok) { setError(res.error); return; }
      router.refresh();
    });
  };

  const submit = () => {
    const value = lost.trim() === '' ? Number.NaN : parseRials(lost);
    if (Number.isNaN(value)) { setError(t('costInvalid')); return; }
    settle(value);
  };

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground">{t('settleHint')}</p>
      <div className="space-y-1.5">
        <Label htmlFor={`lost-${requestId}`}>{t('lostAmount')}</Label>
        <Input id={`lost-${requestId}`} inputMode="numeric" dir="ltr" autoComplete="off" value={lost}
          onChange={(e) => setLost(e.target.value)} placeholder="0" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`lost-note-${requestId}`}>{t('lostNote')}</Label>
        <Textarea id={`lost-note-${requestId}`} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={pending} onClick={submit} data-testid="settle-submit">{t('settle')}</Button>
        <Button type="button" variant="outline" disabled={pending} onClick={() => settle(0)} data-testid="settle-nothing">
          {t('nothingBooked')}
        </Button>
      </div>
    </div>
  );
}
