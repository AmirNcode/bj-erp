'use client';

/**
 * FR-88: the replacement (جانشین) signs or declines a request, and the requester answers a
 * decline. Used on Home and in My requests. The signature reuses the requester/approver
 * pad and consent box (saved signature pre-filled, FR-52). Neither answer affects approval.
 */

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge } from '@/components/StatusBadge';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { signatureLabelsFrom } from '@/lib/leave/signatureLabels';
import { durationLabelsFrom } from '@/lib/leave/durationLabels';
import { formatDuration } from '@/lib/leave/duration';
import { formatCalendarDate } from '@/lib/leave/calendarMonth';
import { formatTimeRange } from '@/lib/leave/formatTimeRange';
import { formatSerialLocalized } from '@/lib/leave/serial';
import { localizedLeaveTypeName } from '@/lib/i18n/format';
import { nativeSelectClass } from '@/lib/native-select';
import { REPLACEMENT_NOTE_MAX, replacementCanAnswer } from '@/lib/leave/replacementSignoff';
import type { ReplacementCandidate } from '@/lib/leave/replacement';
import {
  changeReplacement,
  declineAsReplacement,
  signAsReplacement,
  type ReplacementRequest,
} from '@/lib/actions/leave/replacement';
import { getReplacementCandidates } from '@/lib/actions/leave/requests';
import { RequestSignatureFields } from './RequestSignature';

function SignDialog({ requestId, employeeName }: { requestId: string; employeeName: string }) {
  const t = useTranslations('replacement');
  const tSig = useTranslations('signature');
  const tc = useTranslations('common');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [signatureData, setSignatureData] = useState('');
  const [authorized, setAuthorized] = useState(false);
  const [error, setError] = useState('');
  const labels = { ...signatureLabelsFrom(tSig), title: t('signatureTitle') };

  const submit = () => {
    setError('');
    if (!signatureData) return setError(labels.validationSignature);
    if (!authorized) return setError(labels.validationAuthorization);
    startTransition(async () => {
      const res = await signAsReplacement(requestId, { signatureData, signatureAuthorized: authorized });
      if (!res.ok) return setError(res.error);
      setOpen(false);
      toast.success(t('signSuccess'));
      router.refresh();
    });
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setSignatureData('');
          setAuthorized(false);
          setError('');
        }
      }}
    >
      <AlertDialogTrigger asChild>
        <Button size="sm" data-testid={`replacement-sign-${requestId}`}>{t('sign')}</Button>
      </AlertDialogTrigger>
      <AlertDialogContent size="default">
        <AlertDialogHeader>
          <AlertDialogTitle>{t('signTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('signBody', { name: employeeName })}</AlertDialogDescription>
        </AlertDialogHeader>
        <RequestSignatureFields
          idPrefix={`replacement-${requestId}`}
          value={signatureData}
          onChange={setSignatureData}
          authorized={authorized}
          onAuthorizedChange={setAuthorized}
          labels={labels}
        />
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>{tc('dismiss')}</AlertDialogCancel>
          <Button type="button" onClick={submit} disabled={isPending} data-testid={`replacement-sign-confirm-${requestId}`}>
            {t('sign')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DeclineDialog({ requestId, employeeName }: { requestId: string; employeeName: string }) {
  const t = useTranslations('replacement');
  const tc = useTranslations('common');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const submit = () => {
    setError('');
    startTransition(async () => {
      const res = await declineAsReplacement(requestId, note);
      if (!res.ok) return setError(res.error);
      setOpen(false);
      toast.success(t('declineSuccess'));
      router.refresh();
    });
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setNote('');
          setError('');
        }
      }}
    >
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="outline" data-testid={`replacement-decline-${requestId}`}>{t('decline')}</Button>
      </AlertDialogTrigger>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>{t('declineTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('declineBody', { name: employeeName })}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-1.5 text-start">
          <Label htmlFor={`replacement-decline-note-${requestId}`}>{t('declineNoteLabel')}</Label>
          <Textarea
            id={`replacement-decline-note-${requestId}`}
            data-testid={`replacement-decline-note-${requestId}`}
            rows={3}
            maxLength={REPLACEMENT_NOTE_MAX}
            placeholder={t('declineNotePlaceholder')}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>{tc('dismiss')}</AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            onClick={submit}
            disabled={isPending}
            data-testid={`replacement-decline-confirm-${requestId}`}
          >
            {t('decline')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** One request that names the caller as replacement: summary, their answer, and actions. */
export function ReplacementRequestCard({
  req,
  locale,
  hoursPerDay,
}: {
  req: ReplacementRequest;
  locale: string;
  hoursPerDay: number;
}) {
  const t = useTranslations('replacement');
  const tLeave = useTranslations('leave');
  const tErrand = useTranslations('errand');
  const typeName =
    req.kind === 'errand'
      ? tErrand('badge')
      : localizedLeaveTypeName({ name_fa: req.leave_type_name_fa ?? '—', name_en: req.leave_type_name_en }, locale);
  const dates =
    req.unit === 'hour'
      ? `${formatCalendarDate(req.start_date, locale)} ${formatTimeRange(req.start_time, req.end_time, locale) ?? ''}`.trim()
      : req.start_date === req.end_date
        ? formatCalendarDate(req.start_date, locale)
        : `${formatCalendarDate(req.start_date, locale)} — ${formatCalendarDate(req.end_date, locale)}`;
  const canAnswer = replacementCanAnswer({ status: req.status, signoffStatus: req.signoff_status });

  return (
    <Card className="p-4 gap-0" data-testid={`replacement-request-${req.request_id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="text-sm font-medium">
            {t.rich('forPerson', { name: req.employee_name, bdi: (chunks) => <bdi>{chunks}</bdi> })}
          </div>
          <div className="text-xs text-muted-foreground">
            {[typeName, dates, formatDuration(req.requested_minutes, hoursPerDay, locale, durationLabelsFrom(tLeave))].join(' ، ')}
          </div>
          <div className="text-xs text-muted-foreground">
            {tLeave('trackingNo')}:{' '}
            <span className="font-mono" dir="ltr">{formatSerialLocalized(req.serial_year, req.serial_seq, locale)}</span>
          </div>
          {req.signoff_status === 'signed' && (
            <div className="text-xs text-muted-foreground" data-testid={`replacement-signed-${req.request_id}`}>
              {t('youSigned')}
            </div>
          )}
          {req.signoff_status === 'declined' && (
            <div className="text-xs text-muted-foreground" data-testid={`replacement-declined-${req.request_id}`}>
              {t('youDeclined')}
            </div>
          )}
        </div>
        <span className="shrink-0">
          <StatusBadge
            status={req.status}
            labels={{
              pending: tLeave('status.pending'),
              approved: tLeave('status.approved'),
              rejected: tLeave('status.rejected'),
              cancelled: tLeave('status.cancelled'),
            }}
          />
        </span>
      </div>
      {canAnswer && (
        <div className="mt-3 flex flex-wrap gap-2">
          <SignDialog requestId={req.request_id} employeeName={req.employee_name} />
          <DeclineDialog requestId={req.request_id} employeeName={req.employee_name} />
        </div>
      )}
    </Card>
  );
}

/**
 * The requester's side after a decline: the note, then someone else or "no replacement".
 * Candidates are loaded when the box first shows, for this request's dates.
 */
export function ReplacementDeclinedNotice({
  req,
  summary,
}: {
  /** Which request, when shown away from its card (Home). */
  summary?: string;
  req: {
    id: string;
    start_date: string;
    end_date: string;
    unit: 'day' | 'hour';
    start_time: string | null;
    end_time: string | null;
    replacement_id?: string | null;
    replacement_name: string | null;
    replacement_signoff_note?: string | null;
  };
}) {
  const t = useTranslations('replacement');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [candidates, setCandidates] = useState<ReplacementCandidate[] | null>(null);
  const [choice, setChoice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    getReplacementCandidates({
      start: req.start_date,
      end: req.end_date,
      unit: req.unit,
      startTime: req.start_time,
      endTime: req.end_time,
    }).then((res) => {
      if (!cancelled) setCandidates(res.ok ? res.candidates : []);
    });
    return () => {
      cancelled = true;
    };
  }, [req.start_date, req.end_date, req.unit, req.start_time, req.end_time]);

  const save = (replacementId: string | null) => {
    setError('');
    startTransition(async () => {
      const res = await changeReplacement(req.id, replacementId);
      if (!res.ok) return setError(res.error);
      toast.success(t('changeSaved'));
      router.refresh();
    });
  };

  const options = (candidates ?? []).filter((c) => c.profileId !== req.replacement_id);

  return (
    <div
      className="mt-2 space-y-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950"
      data-testid={`replacement-declined-notice-${req.id}`}
    >
      <div className="font-medium">
        {t('declinedTitle')}
        {summary && <span className="font-normal"> · {summary}</span>}
      </div>
      <div>{t.rich('declinedBody', { name: req.replacement_name ?? '—', bdi: (chunks) => <bdi>{chunks}</bdi> })}</div>
      {req.replacement_signoff_note && (
        <div>
          <span className="font-medium">{t('declinedNote')}:</span> {req.replacement_signoff_note}
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor={`replacement-new-${req.id}`} className="text-xs">{t('newReplacement')}</Label>
        <select
          id={`replacement-new-${req.id}`}
          data-testid={`replacement-new-${req.id}`}
          className={nativeSelectClass}
          value={choice}
          disabled={candidates === null || isPending}
          onChange={(e) => setChoice(e.target.value)}
        >
          <option value="">{candidates === null ? t('loading') : t('select')}</option>
          {options.map((c) => (
            <option key={c.profileId} value={c.profileId} disabled={c.unavailable}>
              {c.fullName}
              {c.unavailable ? ` (${t('onLeave')})` : ''}
            </option>
          ))}
        </select>
      </div>
      {error && <p className="text-destructive" role="alert">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={!choice || isPending}
          onClick={() => save(choice)}
          data-testid={`replacement-new-save-${req.id}`}
        >
          {t('saveReplacement')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={() => save(null)}
          data-testid={`replacement-none-save-${req.id}`}
        >
          {t('saveNoReplacement')}
        </Button>
      </div>
    </div>
  );
}
