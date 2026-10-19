import { getTranslations } from 'next-intl/server';
import { getApprovalWorkerHealth } from '@/lib/actions/approval-delegation';
import { formatNumber, formatPersianConsentTimestamp } from '@/lib/i18n/format';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/** Read-only operational status; enabling the scheduled worker is a separate release action. */
export async function ApprovalWorkerHealthCard({ locale }: { locale: string }) {
  const [t, result] = await Promise.all([
    getTranslations('rolesDelegation.worker'),
    getApprovalWorkerHealth(),
  ]);
  if (!result.ok) return (
    <Card data-testid="approval-worker-health"><CardHeader><CardTitle>{t('title')}</CardTitle></CardHeader>
      <CardContent><p role="alert" className="text-sm text-destructive">{t('queryFailed')} {result.error}</p></CardContent>
    </Card>
  );
  const { health } = result;
  const finished = health.last_run?.finished_at;
  const finishedAt = finished ? Date.parse(finished) : NaN;
  const completedAt = typeof finished === 'string' && Number.isFinite(finishedAt)
    ? formatPersianConsentTimestamp(finished, locale) : null;
  const inactive = health.job?.active !== true;
  // The worker is scheduled every minute. Allow a short delay, but an old
  // successful run is not evidence that the scheduler is still executing.
  // Measured against the action's read time so rendering stays pure.
  const executionAge = Date.parse(health.observed_at) - finishedAt;
  const stale = executionAge > 5 * 60_000 || executionAge < 0;
  const state = inactive ? 'inactive' : health.blocked > 0 ? 'blocked'
    : health.overdue > 0 ? 'overdue' : !completedAt ? 'notRun' : stale ? 'stale' : 'healthy';
  // Explicit translation calls avoid dynamic message-key differences between dev and production.
  const statuses = {
    inactive: { label: t('inactive'), hint: t('inactiveHint') },
    blocked: { label: t('blocked'), hint: t('blockedHint') },
    overdue: { label: t('overdue'), hint: t('overdueHint') },
    notRun: { label: t('notRun'), hint: t('notRunHint') },
    stale: { label: t('stale'), hint: t('staleHint') },
    healthy: { label: t('healthy'), hint: t('healthyHint') },
  };
  const status = statuses[state];
  return (
    <Card data-testid="approval-worker-health">
      <CardHeader className="gap-2"><CardTitle>{t('title')}</CardTitle>
        <Badge variant={state === 'blocked' ? 'destructive' : 'secondary'} data-testid={`approval-worker-${state}`}>{status.label}</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <p role="status" className="text-sm text-muted-foreground">{status.hint}</p>
        <dl className="grid gap-4 text-sm sm:grid-cols-3">
          <div><dt className="text-muted-foreground">{t('overdueCount')}</dt><dd className="mt-1 font-semibold" data-testid="approval-worker-overdue-count">{formatNumber(health.overdue, locale)}</dd></div>
          <div><dt className="text-muted-foreground">{t('blockedCount')}</dt><dd className="mt-1 font-semibold" data-testid="approval-worker-blocked-count">{formatNumber(health.blocked, locale)}</dd></div>
          <div><dt className="text-muted-foreground">{t('lastExecution')}</dt><dd className="mt-1 font-medium" data-testid="approval-worker-last-execution">{completedAt ?? t('noExecution')}</dd></div>
        </dl>
        {inactive && (health.overdue > 0 || health.blocked > 0) && <p className="text-sm">{t('inactiveOutstanding')}</p>}
        <p className="text-xs text-muted-foreground">{t('scopeHint')}</p>
      </CardContent>
    </Card>
  );
}
