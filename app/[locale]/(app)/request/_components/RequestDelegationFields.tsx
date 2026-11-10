'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import type { WorkSettings } from '@/lib/actions/leave/reference';
import { formatLongPersianDate, formatNumber, formatTehranWindowEdge } from '@/lib/i18n/format';
import { returnToWork } from '@/lib/leave/returnToWork';
import type { useRequestDelegation } from './useRequestForm';

function clock(time: string, locale: string): string {
  const [h, m] = time.split(':');
  const two = (n: string) => formatNumber(Number(n), locale, { minimumIntegerDigits: 2, useGrouping: false });
  return `${two(h)}:${two(m)}`;
}

/**
 * The return-to-work day for everyone; the approval coverage box only for people
 * it concerns (approvers, the CEO, the CEO's delegate). The preview still loads
 * for everyone: submission needs its token to bind the exact absence hours.
 */
export function RequestDelegationFields({ delegation, workSettings, locale, idPrefix, showCover = true }: {
  delegation: ReturnType<typeof useRequestDelegation>;
  workSettings: WorkSettings;
  locale: string;
  idPrefix: string;
  showCover?: boolean;
}) {
  const t = useTranslations('delegation');
  const { preview, loading, error, query } = delegation;
  const back = query ? returnToWork({ unit: query.unit ?? 'day', dayPart: query.dayPart, end: query.end, endTime: query.endTime }, workSettings) : null;
  const backLine = back && (
    <div className="flex flex-wrap gap-x-2 text-sm" data-testid={`${idPrefix}-return-to-work`}>
      <dt className="text-muted-foreground">{t('backAtWork')}:</dt>
      <dd className="font-medium">{formatLongPersianDate(back.date, locale)}{back.time ? ` · ${clock(back.time, locale)}` : ''}</dd>
    </div>
  );
  const concernsApprover = !!preview && ((preview.can_approve && !!preview.saved) || preview.auto_approval_eligible);
  if (!error && !concernsApprover) return backLine ? <dl className="px-1">{backLine}</dl> : null;
  const fallback = preview?.saved;
  const edge = (value: string, side: 'start' | 'end') => {
    const { date, time } = formatTehranWindowEdge(value, locale, side);
    return `${date} · ${time ?? (side === 'start' ? t('startOfDay') : t('endOfDay'))}`;
  };
  return (
    <fieldset className="space-y-3 rounded-lg border p-4" data-testid={`${idPrefix}-delegation`} aria-busy={loading}>
      <legend className="px-1 text-sm font-semibold">{t('title')}</legend>
      {error && <div className="space-y-2"><p role="alert" className="text-sm text-destructive">{error}</p><Button type="button" variant="outline" onClick={delegation.refresh}>{t('refresh')}</Button></div>}
      {(preview?.bounds || backLine) && <dl className="space-y-1.5" data-testid={`${idPrefix}-delegation-bounds`}>
        {preview?.bounds && <>
          <div className="flex flex-wrap gap-x-2 text-sm"><dt className="text-muted-foreground">{t('awayFrom')}:</dt><dd className="font-medium">{edge(preview.bounds.starts_at, 'start')}</dd></div>
          <div className="flex flex-wrap gap-x-2 text-sm"><dt className="text-muted-foreground">{t('until')}:</dt><dd className="font-medium">{edge(preview.bounds.ends_at, 'end')}</dd></div>
        </>}
        {backLine}
      </dl>}
      {preview && <>
        {showCover && fallback && <div className="space-y-2 text-sm" data-testid={`${idPrefix}-approval-cover`}>
          <p>{t('savedContinues', { name: fallback.delegate_name })}</p>
        </div>}
        {preview.auto_approval_eligible && <div className="space-y-2" data-testid={`${idPrefix}-auto-approval-policy`}>
          <p className="text-sm">{t('autoPolicy')}</p>
          <div className="flex items-start gap-2">
            <input id={`${idPrefix}-auto-approval-consent`} type="checkbox" checked={delegation.autoApprovalConsent} onChange={(e) => delegation.setAutoApprovalConsent(e.target.checked)} aria-required="true" className="mt-0.5 size-4 shrink-0 accent-primary" data-testid={`${idPrefix}-auto-approval-consent`} />
            <Label htmlFor={`${idPrefix}-auto-approval-consent`} className="text-sm font-normal leading-5">{t('ownConsent')}</Label>
          </div>
        </div>}
        <Button type="button" variant="ghost" size="sm" onClick={delegation.refresh} data-testid={`${idPrefix}-delegation-refresh`}>{t('refresh')}</Button>
      </>}
    </fieldset>
  );
}
