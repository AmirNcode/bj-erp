/** FR-77 admin panel › Overview: usage stats for a period. */
import { ADMIN_LOCALE } from '@/lib/admin/locale';
import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getAdminOverview, getSmsLog } from '@/lib/actions/admin';
import { OVERVIEW_RANGES, parseOverviewRange } from '@/lib/admin/format';
import type { OverviewRequestCount, StuckRequest } from '@/lib/admin/types';
import { formatLongPersianDate, formatNumber } from '@/lib/i18n/format';
import { formatSerialLocalized } from '@/lib/leave/serial';
import { EmptyState } from '@/components/EmptyState';
import { ErrorNote, PillLinks, Section, StatTile } from './_components/parts';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const KIND_KEYS = {
  'leave-day': 'leaveDay',
  'leave-hour': 'leaveHour',
  'errand-day': 'errandDay',
  'errand-hour': 'errandHour',
} as const;
const STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;

export default async function AdminOverviewPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const range = parseOverviewRange((await searchParams).range);
  const t = await getTranslations({ locale: ADMIN_LOCALE, namespace: 'admin' });
  const [result, sms] = await Promise.all([getAdminOverview(range), getSmsLog({ page: 1 })]);
  if (!result.ok) return <ErrorNote message={result.error} />;
  const { overview } = result;
  const n = (value: number) => formatNumber(value, ADMIN_LOCALE);

  const stepLabel = (step: StuckRequest['waiting_on']) => {
    if (!step) return t('steps.none');
    if (step.step_role === 'manager') return step.manager_scope === 'department' ? t('steps.department') : t('steps.manager');
    if (step.step_role === 'hr') return t('steps.hr');
    return t('steps.employee');
  };

  // Requests: one row per type, one column per status.
  const kinds = Object.keys(KIND_KEYS) as (keyof typeof KIND_KEYS)[];
  const count = (kind: string, status: string) =>
    overview.requests
      .filter((r: OverviewRequestCount) => `${r.kind}-${r.unit}` === kind && (status === 'all' || r.status === status))
      .reduce((sum, r) => sum + r.count, 0);
  const typeRows = kinds.filter((k) => count(k, 'all') > 0);

  const maxMinutes = Math.max(1, ...overview.leave_by_department.map((d) => d.minutes));
  const perDay = overview.minutes_per_day || 480;

  const smsCounts = sms.ok ? sms.log.counts : {};
  const smsKeys = ['sent', 'dry_run', 'failed', 'skipped', 'queued'] as const;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <PillLinks
          label={t('range.label')}
          items={OVERVIEW_RANGES.map((r) => ({
            key: String(r),
            href: `/${locale}/admin?range=${r}`,
            label: t(`range.r${r}`),
            active: r === range,
          }))}
        />
        <p className="text-xs text-muted-foreground">
          {formatLongPersianDate(result.from, ADMIN_LOCALE)} – {formatLongPersianDate(result.to, ADMIN_LOCALE)}
        </p>
      </div>

      <Section title={t('overview.people')} testId="admin-people">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatTile label={t('overview.active')} value={n(overview.people.active)} />
          <StatTile label={t('overview.signedIn7')} value={n(overview.people.signed_in_7d)} />
          <StatTile label={t('overview.signedIn30')} value={n(overview.people.signed_in_30d)} />
          <StatTile label={t('overview.neverSignedIn')} value={n(overview.people.never_signed_in)}
            tone={overview.people.never_signed_in > 0 ? 'warning' : 'default'} />
          <StatTile label={t('overview.mustChangePassword')} value={n(overview.people.must_change_password)} />
          <StatTile label={t('overview.inactive')} value={n(overview.people.inactive)} />
        </div>
      </Section>

      <Section title={t('overview.requests')} testId="admin-requests">
        {typeRows.length === 0 ? (
          <EmptyState message={t('overview.requestsNone')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="py-1.5 text-start font-medium">{t('overview.type')}</th>
                  {STATUSES.map((s) => <th key={s} className="px-2 py-1.5 text-end font-medium">{t(`statuses.${s}`)}</th>)}
                  <th className="py-1.5 text-end font-medium">{t('overview.total')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-muted">
                {typeRows.map((k) => (
                  <tr key={k}>
                    <td className="py-2">{t(`kinds.${KIND_KEYS[k]}`)}</td>
                    {STATUSES.map((s) => <td key={s} className="px-2 py-2 text-end tabular-nums">{n(count(k, s))}</td>)}
                    <td className="py-2 text-end font-semibold tabular-nums">{n(count(k, 'all'))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title={t('overview.speed')} testId="admin-speed">
          {overview.speed.decided === 0 ? (
            <EmptyState message={t('overview.speedNone')} />
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <StatTile label={t('overview.median')} value={t('overview.hours', { value: n(overview.speed.median_hours ?? 0) })} />
              <StatTile label={t('overview.p90')} value={t('overview.hours', { value: n(overview.speed.p90_hours ?? 0) })} />
              <p className="col-span-2 text-xs text-muted-foreground">{t('overview.decided', { count: overview.speed.decided })}</p>
            </div>
          )}
        </Section>
        <Section title={t('overview.stuck')} testId="admin-stuck">
          {overview.stuck.length === 0 ? (
            <EmptyState message={t('overview.stuckNone')} />
          ) : (
            <ul className="divide-y divide-muted">
              {overview.stuck.map((r) => (
                <li key={r.id}>
                  <Link href={`/${locale}/manage/approvals`} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm hover:text-primary">
                    <span className="flex flex-col">
                      <span className="font-medium">
                        {r.employee_name} · {t(`kinds.${KIND_KEYS[`${r.kind}-${r.unit}`]}`)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatSerialLocalized(r.serial_year, r.serial_seq, ADMIN_LOCALE)} · {t('overview.waitingOn', { step: stepLabel(r.waiting_on) })}
                      </span>
                    </span>
                    <span className="rounded-full bg-warning-foreground px-2.5 py-0.5 text-xs font-semibold text-warning">
                      {t('overview.days', { count: r.days_waiting })}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title={t('overview.leave')} testId="admin-leave">
          {overview.leave_by_department.length === 0 ? (
            <EmptyState message={t('overview.leaveNone')} />
          ) : (
            <ul className="flex flex-col gap-3">
              {overview.leave_by_department.map((d) => {
                const name = (d.name_en ?? d.name_fa) ?? t('overview.noDepartment');
                const days = n(Math.round((d.minutes / perDay) * 10) / 10);
                return (
                  <li key={d.department_id ?? 'none'} className="text-sm">
                    <div className="mb-1 flex items-baseline justify-between gap-3">
                      <span>{name}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {t('overview.leaveDays', { value: days })} · {t('overview.leaveRequests', { count: d.requests })}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-muted" aria-hidden="true">
                      <div className="h-2 rounded-full bg-primary" style={{ width: `${(d.minutes / maxMinutes) * 100}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section
          title={t('overview.sms')}
          testId="admin-sms-counts"
          action={<Link href={`/${locale}/admin/sms`} className="text-sm text-primary hover:underline">{t('overview.smsLink')}</Link>}
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {smsKeys.map((k) => (
              <StatTile key={k} label={t(`sms.status.${k}`)} value={n(smsCounts[k] ?? 0)}
                tone={k === 'failed' && (smsCounts.failed ?? 0) > 0 ? 'warning' : 'default'} />
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}
