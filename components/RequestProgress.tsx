'use client';

/**
 * Expandable approval progress of one request (FR-64): every step in order,
 * who signed it and when, and who it still waits on. Loaded on first expand,
 * so the Home list costs nothing until someone asks; `defaultOpen` (a pending
 * request on My Requests) loads it on mount instead.
 */

import { useCallback, useEffect, useState, useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { CircleCheck, CircleDashed, CircleX, ChevronDown } from 'lucide-react';
import { getRequestProgress, type ProgressStep } from '@/lib/actions/leave/progress';
import { formatNumber, formatPersianConsentTimestamp } from '@/lib/i18n/format';
import { cn } from '@/lib/utils';

export function RequestProgress({
  requestId,
  defaultOpen = false,
}: {
  requestId: string;
  defaultOpen?: boolean;
}) {
  const t = useTranslations('requestProgress');
  const tSteps = useTranslations('approvals.steps');
  const locale = useLocale();
  const [open, setOpen] = useState(defaultOpen);
  const [steps, setSteps] = useState<ProgressStep[] | null>(null);
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

  const load = useCallback(
    () =>
      startTransition(async () => {
        const res = await getRequestProgress(requestId);
        if (res.ok) setSteps(res.steps);
        else setError(res.error);
      }),
    [requestId]
  );

  // Open from the start: load once on mount rather than on the first click.
  useEffect(() => {
    if (defaultOpen) load();
  }, [defaultOpen, load]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && steps === null && !isPending) load();
  };

  // Explicit map, not tSteps(label): dynamic message keys are avoided here.
  const stepName: Record<ProgressStep['label'], string> = {
    manager: tSteps('manager'),
    departmentManager: tSteps('departmentManager'),
    hr: tSteps('hr'),
    security: tSteps('security'),
    admin: tSteps('admin'),
    employee: tSteps('employee'),
  };

  const panelId = `progress-${requestId}`;

  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        data-testid={`progress-toggle-${requestId}`}
      >
        {t('toggle')}
        <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} aria-hidden="true" />
      </button>

      {open && (
        <div id={panelId} className="mt-2 rounded-lg border bg-muted/30 p-3" data-testid={`progress-${requestId}`}>
          {isPending && steps === null && <p className="text-xs text-muted-foreground">{t('loading')}</p>}
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          {steps !== null && steps.length === 0 && (
            <p className="text-xs text-muted-foreground">{t('none')}</p>
          )}
          {steps !== null && steps.length > 0 && (
            <ol className="space-y-2.5">
              {steps.map((s, i) => {
                const title = s.named ? (s.expectedName ?? s.signerName ?? stepName.employee) : stepName[s.label];
                return (
                  <li
                    key={i}
                    className="flex items-start gap-2.5"
                    data-testid={`progress-step-${requestId}-${i}`}
                    data-state={s.decision ?? 'waiting'}
                  >
                    {s.decision === 'approved' ? (
                      <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden="true" />
                    ) : s.decision === 'rejected' ? (
                      <CircleX className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
                    ) : (
                      <CircleDashed className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden="true" />
                    )}
                    <div className="min-w-0 text-xs">
                      <p className="font-medium">
                        <span className="text-muted-foreground">{formatNumber(i + 1, locale)}. </span>
                        {title}
                      </p>
                      <p className="text-muted-foreground">
                        {s.decision === 'approved'
                          ? t('approvedBy', { name: s.signerName ?? '—' })
                          : s.decision === 'rejected'
                            ? t('rejectedBy', { name: s.signerName ?? '—' })
                            : s.expectedName && !s.named
                              ? t('waitingOnPerson', { name: s.expectedName })
                              : t('waiting')}
                        {s.signedAt && <> · {formatPersianConsentTimestamp(s.signedAt, locale)}</>}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
