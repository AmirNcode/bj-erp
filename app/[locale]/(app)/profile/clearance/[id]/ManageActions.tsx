'use client';

/**
 * Admin / hr actions on one clearance form (FR-54 A4, D11): change reason, last
 * working day and note until the account is switched off; add, remove or
 * reassign unsigned rows while sign-offs are open; cancel until switched off.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PersianDateField } from '@/components/PersianDateField';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  dateObjectToGregorian,
  gregorianToPersianDateObject,
  type PickerDate,
} from '@/lib/leave/dateConvert';
import {
  cancelClearance,
  setClearanceRows,
  updateClearance,
  type PersonOption,
} from '@/lib/actions/clearance';
import {
  SEPARATION_REASONS,
  type DraftRow,
  type SeparationReason,
  type SeparationStatus,
  type SignoffRow,
} from '@/lib/clearance/model';
import { RowsEditor } from '../_components/RowsEditor';

type Props = {
  id: string;
  locale: string;
  status: SeparationStatus;
  deactivated: boolean;
  reason: SeparationReason;
  lastWorkingDay: string;
  note: string | null;
  rows: SignoffRow[];
  people: PersonOption[];
  leaverId: string;
};

const toDraft = (rows: SignoffRow[]): DraftRow[] =>
  rows.map((r) => ({
    key: r.id,
    id: r.id,
    isHr: r.isHr,
    nameFa: r.nameFa,
    nameEn: r.nameEn,
    departmentId: r.departmentId,
    signerId: r.signerId,
    signed: !!r.signedAt,
  }));

export function ManageActions(props: Props) {
  const t = useTranslations('clearance');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [mode, setMode] = useState<'none' | 'details' | 'rows'>('none');
  const [error, setError] = useState('');

  const [reason, setReason] = useState<SeparationReason>(props.reason);
  const [lastDay, setLastDay] = useState<PickerDate | null>(
    gregorianToPersianDateObject(props.lastWorkingDay, props.locale)
  );
  const [note, setNote] = useState(props.note ?? '');
  const [rows, setRows] = useState<DraftRow[]>(() => toDraft(props.rows));

  const reasonLabel: Record<SeparationReason, string> = {
    resignation: t('reasons.resignation'),
    dismissal: t('reasons.dismissal'),
    contract_end: t('reasons.contract_end'),
    abandonment: t('reasons.abandonment'),
    redundancy: t('reasons.redundancy'),
  };

  const open = !props.deactivated && props.status !== 'cancelled';
  const rowsOpen = props.status === 'in_progress';
  if (!open) return null;

  const run = (action: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setError('');
    startTransition(async () => {
      const res = await action();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setMode('none');
      router.refresh();
    });
  };

  return (
    <div className="space-y-3" data-testid="clearance-manage">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setMode(mode === 'details' ? 'none' : 'details')}
          data-testid="clearance-edit-details"
        >
          {t('detail.edit')}
        </Button>
        {rowsOpen && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setRows(toDraft(props.rows));
              setMode(mode === 'rows' ? 'none' : 'rows');
            }}
            data-testid="clearance-edit-rows"
          >
            {t('detail.editRows')}
          </Button>
        )}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button type="button" variant="destructive" size="sm" data-testid="clearance-cancel">
              {t('detail.cancelForm')}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('detail.cancelTitle')}</AlertDialogTitle>
              <AlertDialogDescription>{t('detail.cancelBody')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('detail.keep')}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => run(() => cancelClearance(props.id))}
                data-testid="clearance-cancel-confirm"
              >
                {t('detail.cancelConfirm')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {mode === 'details' && (
        <div className="space-y-3 rounded-lg border border-border p-3" data-testid="clearance-details-editor">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t('fields.reason')}</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {SEPARATION_REASONS.map((r) => (
                <label key={r} className="flex items-center gap-2 text-sm">
                  <input type="radio" name="edit-reason" checked={reason === r} onChange={() => setReason(r)} className="size-4" />
                  {reasonLabel[r]}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="space-y-1.5">
            <Label htmlFor="clearance-edit-last-day">{t('fields.lastWorkingDay')}</Label>
            <PersianDateField
              id="clearance-edit-last-day"
              locale={props.locale}
              value={lastDay}
              onChange={setLastDay}
              testId="clearance-edit-last-day"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="clearance-edit-note">{t('fields.note')}</Label>
            <Textarea id="clearance-edit-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          </div>
          <Button
            type="button"
            size="sm"
            disabled={isPending || !lastDay}
            onClick={() =>
              lastDay &&
              run(() =>
                updateClearance(props.id, { reason, lastWorkingDay: dateObjectToGregorian(lastDay), note })
              )
            }
            data-testid="clearance-details-save"
          >
            {isPending ? t('detail.saving') : t('detail.save')}
          </Button>
        </div>
      )}

      {mode === 'rows' && (
        <div className="space-y-3 rounded-lg border border-border p-3">
          <RowsEditor rows={rows} onChange={setRows} people={props.people} leaverId={props.leaverId} locale={props.locale} />
          <Button
            type="button"
            size="sm"
            disabled={isPending}
            onClick={() => run(() => setClearanceRows(props.id, rows))}
            data-testid="clearance-rows-save"
          >
            {isPending ? t('detail.saving') : t('detail.save')}
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
