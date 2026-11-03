/** FR-78 admin panel › SMS: settings, test, balance and the log. */
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getSmsLog, getSmsSettings } from '@/lib/actions/admin';
import { SMS_PAGE_SIZE, parsePage } from '@/lib/admin/format';
import type { SmsEvent, SmsStatus } from '@/lib/admin/types';
import { formatNumber, formatPersianConsentTimestamp } from '@/lib/i18n/format';
import { EmptyState } from '@/components/EmptyState';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { ErrorNote, Pager, PillLinks, Section } from '../_components/parts';
import { SmsSettingsForm } from './SmsSettingsForm';
import { SmsCreditButton, SmsTestForm } from './SmsActions';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const STATUSES: SmsStatus[] = ['queued', 'sending', 'sent', 'dry_run', 'failed', 'skipped'];
const EVENTS: SmsEvent[] = ['approver_new', 'employee_decision', 'password_reset', 'test'];
const SKIP_REASONS = ['no_mobile', 'request_decided', 'sms_off'] as const;

const STATUS_STYLE: Record<SmsStatus, string> = {
  queued: 'bg-muted text-muted-foreground border-border',
  sending: 'bg-muted text-muted-foreground border-border',
  sent: 'bg-success-foreground text-success border-success/20',
  dry_run: 'bg-primary/10 text-primary border-primary/20',
  failed: 'bg-destructive/10 text-destructive border-destructive/20',
  skipped: 'bg-warning-foreground text-warning border-warning/20',
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function AdminSmsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const status = STATUSES.find((s) => s === one(sp.status)) ?? null;
  const event = EVENTS.find((e) => e === one(sp.event)) ?? null;
  const page = parsePage(sp.page);
  const t = await getTranslations('admin');
  const [settings, log] = await Promise.all([getSmsSettings(), getSmsLog({ status, event, page })]);
  if (!settings.ok) return <ErrorNote message={settings.error} />;
  const s = settings.settings;

  const href = (next: { status?: string | null; event?: string | null; page?: number }) => {
    const q = new URLSearchParams();
    const st = next.status !== undefined ? next.status : status;
    const ev = next.event !== undefined ? next.event : event;
    if (st) q.set('status', st);
    if (ev) q.set('event', ev);
    if (next.page && next.page > 1) q.set('page', String(next.page));
    const qs = q.toString();
    return `/${locale}/admin/sms${qs ? `?${qs}` : ''}`;
  };
  const pages = log.ok ? Math.max(1, Math.ceil(log.log.total / SMS_PAGE_SIZE)) : 1;
  const skipLabel = (reason: string | null) =>
    reason && (SKIP_REASONS as readonly string[]).includes(reason) ? t(`sms.skip.${reason as (typeof SKIP_REASONS)[number]}`) : reason;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
        <Section title={t('sms.settings')} testId="admin-sms-settings">
          <SmsSettingsForm initial={s} />
        </Section>
        <div className="flex flex-col gap-5">
          <Section title={t('sms.test')}>
            <SmsTestForm disabled={s.mode === 'off'} />
          </Section>
          <Section title={t('sms.credit')} testId="admin-sms-credit">
            <div className="flex flex-col gap-2 text-sm">
              {s.credit_amount !== null && (
                <p className="text-lg font-semibold tabular-nums">{t('sms.creditAmount', { amount: formatNumber(s.credit_amount, locale) })}</p>
              )}
              <p className="text-xs text-muted-foreground">
                {s.credit_pending ? t('sms.creditPending')
                  : s.credit_checked_at ? t('sms.creditChecked', { time: formatPersianConsentTimestamp(s.credit_checked_at, locale) })
                    : t('sms.creditNever')}
              </p>
              {s.credit_error && <p className="text-xs text-destructive">{t('sms.creditError', { error: s.credit_error })}</p>}
              <SmsCreditButton disabled={!s.has_api_key} />
            </div>
          </Section>
        </div>
      </div>

      <Section title={t('sms.log')} testId="admin-sms-log">
        <div className="mb-4 flex flex-col gap-2">
          <PillLinks label={t('sms.filterStatus')} items={[null, ...STATUSES].map((st) => ({
            key: st ?? 'all', href: href({ status: st, page: 1 }), active: st === status,
            label: st ? t(`sms.status.${st}`) : t('sms.all'),
          }))} />
          <PillLinks label={t('sms.filterEvent')} items={[null, ...EVENTS].map((ev) => ({
            key: ev ?? 'all', href: href({ event: ev, page: 1 }), active: ev === event,
            label: ev ? t(`sms.event.${ev}`) : t('sms.all'),
          }))} />
        </div>
        {!log.ok ? <ErrorNote message={log.error} /> : log.log.rows.length === 0 ? (
          <EmptyState message={t('sms.logEmpty')} />
        ) : (
          <>
            <ul className="divide-y divide-muted">
              {log.log.rows.map((row) => (
                <li key={row.id} className="flex flex-col gap-1.5 py-3 text-sm" data-testid="sms-log-row">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={cn(STATUS_STYLE[row.status])}>{t(`sms.status.${row.status}`)}</Badge>
                    <Badge variant="outline">{t(`sms.event.${row.event}`)}</Badge>
                    <span className="font-medium">{row.recipient_name ?? t('sms.noRecipient')}</span>
                    {row.to_mobile && <span dir="ltr" className="text-xs text-muted-foreground tabular-nums">{row.to_mobile}</span>}
                    <span className="ms-auto text-xs text-muted-foreground">{formatPersianConsentTimestamp(row.created_at, locale)}</span>
                  </div>
                  <p dir="auto" className="whitespace-pre-line text-start text-muted-foreground">{row.body}</p>
                  {(row.skip_reason || row.error || row.attempts > 1) && (
                    <p className={cn('text-xs', row.status === 'failed' ? 'text-destructive' : 'text-muted-foreground')}>
                      {[skipLabel(row.skip_reason), row.error, row.attempts > 1 ? t('sms.attempts', { count: row.attempts }) : null]
                        .filter(Boolean).join(' · ')}
                    </p>
                  )}
                </li>
              ))}
            </ul>
            <Pager page={page} pages={pages} hrefFor={(p) => href({ page: p })}
              labels={{ newer: t('pager.newer'), older: t('pager.older'), page: t('pager.page', { page, pages }) }} />
          </>
        )}
      </Section>
    </div>
  );
}
