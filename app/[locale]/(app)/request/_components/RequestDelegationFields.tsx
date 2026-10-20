'use client';

import Link from 'next/link';
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
export function RequestDelegationFields({ delegation, workSettings, locale, idPrefix, hasReplacement = false, showCover = true }: {
  delegation: ReturnType<typeof useRequestDelegation>;
  workSettings: WorkSettings;
  locale: string;
  idPrefix: string;
  hasReplacement?: boolean;
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
  const concernsApprover = !!preview && (preview.can_approve || preview.auto_approval_eligible || (preview.is_ceo && preview.temporary_eligible));
  if (!error && !concernsApprover) return backLine ? <dl className="px-1">{backLine}</dl> : null;
  const fallback = preview?.saved;
  const needsCover = preview?.can_approve === true;
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
        {showCover && needsCover && <div className="space-y-2 text-sm" data-testid={`${idPrefix}-approval-cover`}>
          {preview.temporary_eligible
            ? <><p>{t('temporary', { name: preview.temporary_delegate_name ?? '' })}</p><p className="text-xs text-muted-foreground">{t('temporaryConditions')}</p><p className="text-xs text-muted-foreground">{fallback ? t('savedResumes', { name: fallback.delegate_name }) : t('noSavedFallback')}</p></>
            : fallback
              ? <p>{hasReplacement ? t('workCoverFallback', { name: fallback.delegate_name }) : t('savedContinues', { name: fallback.delegate_name })}</p>
              : <p className="rounded-md bg-amber-50 p-3 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" role="note" data-testid={`${idPrefix}-no-approval-delegate`}>{hasReplacement ? t('workCoverWarning') : t('noDelegateWarning')}</p>}
          {!preview.temporary_eligible && !fallback && (preview.can_delegate
            ? <Link href={`/${locale}/settings/roles`} className="inline-flex min-h-10 items-center text-primary underline underline-offset-4">{t('configureDelegate')}</Link>
            : <p className="text-xs text-muted-foreground">{t('contactAdmin')}</p>)}
        </div>}
        {preview.is_ceo && preview.temporary_eligible && <div className="flex items-start gap-2 rounded-md border p-3">
          <input id={`${idPrefix}-temporary-ceo-authorized`} type="checkbox" checked={delegation.temporaryCeoAuthorized} onChange={(e) => delegation.setTemporaryCeoAuthorized(e.target.checked)} aria-required="true" className="mt-0.5 size-4 shrink-0 accent-primary" data-testid={`${idPrefix}-temporary-ceo-authorized`} />
          <Label htmlFor={`${idPrefix}-temporary-ceo-authorized`} className="text-sm font-normal leading-5">{t('temporaryCeoAuthorization', { name: preview.temporary_delegate_name ?? '' })}</Label>
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
