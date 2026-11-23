'use client';

/**
 * Sales record removal (admin only): the Delete / Archive dialog opened from the record header.
 * Archive moves the record to its flow's Archived stage; Delete hides it everywhere (soft delete,
 * restorable from Records › Deleted). Nothing is preselected. The database re-checks everything.
 * Spec: docs/specs/2026-11-23-sales-record-delete-archive-design.md §4.2.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { archiveSalesRecord, deleteSalesRecord } from '@/lib/actions/sales';
import { archiveDisabled, canConfirm, countsParts, type RemoveChoice } from '@/lib/sales/removeDialog';
import type { RecordDetail } from '@/lib/sales/types';
import { cn } from '@/lib/utils';
import { ModalContent, useSalesFormat } from './parts';

export function RemoveRecordDialog({ detail, onClose }: { detail: RecordDetail; onClose: () => void }) {
  const t = useTranslations('sales');
  const f = useSalesFormat();
  const router = useRouter();
  const r = detail.record;
  const [choice, setChoice] = useState<RemoveChoice>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const archivedAlready = archiveDisabled(r.stage_kind);
  const parts = countsParts({ items: detail.nodes.length, payments: detail.payments?.length ?? 0, files: detail.files.length });
  const destructive = choice === 'delete';

  async function confirm() {
    if (!choice) return;
    setPending(true);
    setError(null);
    try {
      const out = choice === 'archive' ? await archiveSalesRecord(r.id) : await deleteSalesRecord(r.id);
      if (!out.ok) { setError(out.error); return; }
      if (choice === 'archive') {
        toast.success(t('remove.archivedToast'));
        onClose();
        router.refresh();
      } else {
        toast.success(t('remove.deletedToast'));
        onClose();
        router.push(`/${f.locale}/sales`);
      }
    } finally {
      setPending(false);
    }
  }

  const option = (value: 'archive' | 'delete', disabled: boolean) => (
    <label
      className={cn('flex cursor-pointer items-start gap-3 border border-border p-3 text-sm', choice === value && 'border-primary bg-secondary/40', disabled && 'cursor-not-allowed opacity-60')}
    >
      <input type="radio" name="sales-remove-choice" className="mt-1 size-4 accent-primary" value={value} disabled={disabled || pending}
        checked={choice === value} onChange={() => setChoice(value)} data-testid={`sales-remove-${value}`} />
      <span className="flex flex-col gap-0.5">
        <span className="font-semibold">{t(`remove.${value}`)}</span>
        <span className="text-muted-foreground">{t(`remove.${value}Body`)}</span>
        {disabled ? <span className="text-xs text-muted-foreground">{t('remove.alreadyArchived')}</span> : null}
      </span>
    </label>
  );

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !pending) onClose(); }}>
      <ModalContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('remove.title', { no: f.recordNo(r.record_no), title: r.title })}</DialogTitle>
          <DialogDescription>{t('remove.intro')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3" role="radiogroup" aria-label={t('remove.button')}>
          {option('archive', archivedAlready)}
          {option('delete', false)}
        </div>
        {destructive && parts.length > 0 ? (
          <p className="text-sm text-destructive" data-testid="sales-remove-counts">
            {t('remove.counts', { list: parts.map((p) => t(`remove.count.${p.key}`, { count: p.count })).join(f.locale === 'fa' ? '، ' : ', ') })}
          </p>
        ) : null}
        {error ? <p className="text-sm text-destructive" role="alert" data-testid="sales-remove-error">{error}</p> : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending} data-testid="sales-remove-cancel">{t('cancel')}</Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            disabled={pending || !canConfirm(choice, r.stage_kind)}
            onClick={() => void confirm()}
            data-testid="sales-remove-confirm"
          >
            {t('remove.confirm')}
          </Button>
        </DialogFooter>
      </ModalContent>
    </Dialog>
  );
}
