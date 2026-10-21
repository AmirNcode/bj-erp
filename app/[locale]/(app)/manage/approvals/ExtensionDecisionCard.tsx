'use client';

/**
 * FR-70: HR decides a trip extension — HR alone, even when the errand's chain has
 * other steps. Approval is signed and may set the per diem; rejection takes a note.
 * Both ask for confirmation.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { RequestSignatureFields } from '../../request/_components/RequestSignature';
import { signatureLabelsFrom } from '@/lib/leave/signatureLabels';
import { formatCalendarDate } from '@/lib/leave/calendarMonth';
import { formatRials, parseRials } from '@/lib/leave/perDiem';
import { formatSerialLocalized } from '@/lib/leave/serial';
import { decideExtension, type PendingExtension } from '@/lib/actions/travel';

/** `bare`: no card frame, for a row inside Home's pending list. */
export function ExtensionDecisionCard({ ext, locale, bare = false }: { ext: PendingExtension; locale: string; bare?: boolean }) {
  const t = useTranslations('travel.extension');
  const ta = useTranslations('approvals');
  const tc = useTranslations('common');
  const tSignature = useTranslations('signature');
  const router = useRouter();
  const [note, setNote] = useState('');
  const [perDiem, setPerDiem] = useState('');
  const [signatureData, setSignatureData] = useState('');
  const [signatureAuthorized, setSignatureAuthorized] = useState(false);
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();
  const id = ext.extension_id;
  const date = (d: string) => formatCalendarDate(d, locale);
  const signatureLabels = signatureLabelsFrom(tSignature, 'approverTitle');

  const decide = (approve: boolean) => {
    setError('');
    let perDiemRials: number | null = null;
    if (approve) {
      if (!signatureData) { setError(signatureLabels.validationSignature); return; }
      if (!signatureAuthorized) { setError(signatureLabels.validationAuthorization); return; }
      if (perDiem.trim() !== '') {
        perDiemRials = parseRials(perDiem);
        if (Number.isNaN(perDiemRials)) { setError(ta('perDiemInvalid')); return; }
      }
    }
    startTransition(async () => {
      const res = await decideExtension({
        extensionId: id, approve, signatureData: approve ? signatureData : null,
        signatureAuthorized: approve && signatureAuthorized, perDiemRials, note,
      });
      if (!res.ok) { setError(res.error); return; }
      router.refresh();
    });
  };

  const body = (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">{ext.employee_name} — {ext.errand_location ?? '—'}</span>
        <span className="font-mono text-xs text-muted-foreground" dir="ltr">{formatSerialLocalized(ext.serial_year, ext.serial_seq, locale)}</span>
      </div>
      <div>{t('dates', { start: date(ext.start_date), from: date(ext.old_end_date), to: date(ext.new_end_date) })}</div>
      <div>{t('reasonBy', { name: ext.requested_by_name })}: {ext.reason}</div>
      {ext.per_diem_rials !== null && <div className="text-muted-foreground">{t('currentPerDiem', { amount: formatRials(ext.per_diem_rials, locale) })}</div>}
      {ext.delegation_uncovered && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900" data-testid={`extension-delegation-${id}`}>{t('delegationUncovered')}</p>
      )}
      <div className="space-y-1.5">
        <Label htmlFor={`extension-note-${id}`}>{t('note')}</Label>
        <Textarea id={`extension-note-${id}`} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" disabled={pending} data-testid={`extension-approve-open-${id}`}>{t('approve')}</Button>
          </AlertDialogTrigger>
          <AlertDialogContent size="default">
            <AlertDialogHeader>
              <AlertDialogTitle>{t('approveTitle')}</AlertDialogTitle>
              <AlertDialogDescription>{t('approveBody', { date: date(ext.new_end_date) })}</AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor={`extension-per-diem-${id}`}>{ta('perDiemLabel')}</Label>
              <Input id={`extension-per-diem-${id}`} inputMode="numeric" dir="ltr" autoComplete="off"
                value={perDiem} onChange={(e) => setPerDiem(e.target.value)} placeholder="0" />
              <p className="text-xs text-muted-foreground">{t('perDiemHint')}</p>
            </div>
            <RequestSignatureFields
              idPrefix={`extension-${id}`}
              value={signatureData}
              onChange={setSignatureData}
              authorized={signatureAuthorized}
              onAuthorizedChange={setSignatureAuthorized}
              labels={signatureLabels}
            />
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <AlertDialogFooter>
              <AlertDialogCancel>{tc('dismiss')}</AlertDialogCancel>
              <Button disabled={pending} onClick={() => decide(true)} data-testid={`extension-approve-${id}`}>{t('approve')}</Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="outline" disabled={pending} data-testid={`extension-reject-open-${id}`}>{t('reject')}</Button>
          </AlertDialogTrigger>
          <AlertDialogContent size="default">
            <AlertDialogHeader>
              <AlertDialogTitle>{t('rejectTitle')}</AlertDialogTitle>
              <AlertDialogDescription>{t('rejectBody', { date: date(ext.old_end_date) })}</AlertDialogDescription>
            </AlertDialogHeader>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <AlertDialogFooter>
              <AlertDialogCancel>{tc('dismiss')}</AlertDialogCancel>
              <Button variant="destructive" disabled={pending} onClick={() => decide(false)} data-testid={`extension-reject-${id}`}>{t('reject')}</Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </>
  );
  if (bare) return <div className="space-y-2 text-sm" data-testid={`extension-${id}`}>{body}</div>;
  return (
    <Card data-testid={`extension-${id}`}>
      <CardContent className="space-y-2 text-sm">{body}</CardContent>
    </Card>
  );
}
