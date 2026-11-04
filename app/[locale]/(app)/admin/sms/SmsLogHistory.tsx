/** FR-78 SMS log: one text's steps (status changes, request to Melipayamak, its reply), behind a native <details>. */
import { getTranslations } from 'next-intl/server';
import { ChevronDown } from 'lucide-react';
import { ADMIN_LOCALE } from '@/lib/admin/locale';
import type { SmsLogEvent, SmsStatus } from '@/lib/admin/types';
import { formatPersianTimestampSeconds } from '@/lib/i18n/format';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const SKIP_REASONS = ['no_mobile', 'request_decided', 'sms_off'] as const;

export async function SmsLogHistory({ events, statusStyle }: {
  events: SmsLogEvent[];
  statusStyle: Record<SmsStatus, string>;
}) {
  const t = await getTranslations({ locale: ADMIN_LOCALE, namespace: 'admin.sms' });
  const h = (key: string, values?: Record<string, string | number>) =>
    t(`history.${key}` as Parameters<typeof t>[0], values);
  const time = (v: string) => formatPersianTimestampSeconds(v, ADMIN_LOCALE);
  const skip = (reason: string | null) =>
    reason && (SKIP_REASONS as readonly string[]).includes(reason)
      ? t(`skip.${reason as (typeof SKIP_REASONS)[number]}`) : reason ?? '';

  const lines = (e: SmsLogEvent): { text: string; tone?: 'error' }[] => {
    if (e.kind === 'request') {
      return [{ text: e.body_id !== null
        ? h('requestPattern', { endpoint: e.endpoint ?? '', bodyId: e.body_id, attempt: e.attempt ?? 1 })
        : h('request', { endpoint: e.endpoint ?? '', attempt: e.attempt ?? 1 }) }];
    }
    if (e.kind === 'reply') {
      const out: { text: string; tone?: 'error' }[] = [{
        text: e.http_status !== null ? h('reply', { code: e.http_status })
          : e.timed_out ? h('replyTimedOut') : h('replyNone'),
        tone: e.http_status !== null && e.http_status < 300 ? undefined : 'error',
      }];
      if (e.error) out.push({ text: h('error', { error: e.error }), tone: 'error' });
      return out;
    }
    switch (e.status) {
      case 'queued':
        return (e.attempt ?? 0) > 0 && e.retry_at
          ? [{ text: h('retry', { time: time(e.retry_at), attempt: (e.attempt ?? 0) + 1 }) },
             ...(e.error ? [{ text: h('error', { error: e.error }), tone: 'error' as const }] : [])]
          : [{ text: h('queued') }];
      case 'sending': return [{ text: h('sending') }];
      case 'sent':
        return [{ text: h('sent', { ref: e.provider_ref ?? '—' }) },
          ...(e.error ? [{ text: h('providerSaid', { message: e.error }) }] : [])];
      case 'dry_run': return [{ text: h('dryRun') }];
      case 'failed':
        return [{ text: h('failed'), tone: 'error' },
          ...(e.error ? [{ text: h('error', { error: e.error }), tone: 'error' as const }] : [])];
      case 'skipped': return [{ text: h('skipped', { reason: skip(e.skip_reason) }) }];
      default: return [];
    }
  };

  const backfilled = events.some((e) => e.backfilled);

  return (
    <details className="group text-xs" data-testid="sms-log-history">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded-md py-1 text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        <ChevronDown aria-hidden="true" className="size-3.5 transition-transform group-open:rotate-180" />
        <span className="group-open:hidden">{h('show', { count: events.length })}</span>
        <span className="hidden group-open:inline">{h('hide')}</span>
      </summary>
      <div className="mt-2 rounded-lg border border-border bg-muted/30 p-3">
        {events.length === 0 ? (
          <p className="text-muted-foreground">{h('empty')}</p>
        ) : (
          <ol className="flex flex-col gap-3 border-s border-border ps-4">
            {events.map((e, i) => (
              <li key={i} className="relative flex flex-col gap-1" data-testid="sms-log-step">
                <span aria-hidden="true" className="absolute -start-[1.3rem] top-1 size-2 rounded-full bg-border" />
                <div className="flex flex-wrap items-center gap-2">
                  <span className="tabular-nums text-muted-foreground">{time(e.at)}</span>
                  {e.kind === 'status' && e.status ? (
                    <Badge variant="outline" className={cn(statusStyle[e.status])}>{t(`status.${e.status}`)}</Badge>
                  ) : (
                    <Badge variant="outline">{h(e.kind === 'request' ? 'kindRequest' : 'kindReply')}</Badge>
                  )}
                </div>
                {lines(e).map((l, j) => (
                  <p key={j} dir="auto" className={cn('text-start', l.tone === 'error' ? 'text-destructive' : 'text-foreground')}>
                    {l.text}
                  </p>
                ))}
                {e.response && (
                  <div className="flex flex-col gap-0.5">
                    <span className="text-muted-foreground">{h('response')}</span>
                    <pre dir="ltr" className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-background p-2 font-mono text-[11px]">
                      {e.response}
                    </pre>
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
        {backfilled && <p className="mt-3 text-muted-foreground">{h('backfilled')}</p>}
      </div>
    </details>
  );
}
