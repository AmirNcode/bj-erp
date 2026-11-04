/** FR-77 admin panel › System: version, service checks, database, migrations, jobs, backups. */
import { ADMIN_LOCALE } from '@/lib/admin/locale';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getAdminSystem } from '@/lib/actions/admin';
import { backupIsStale, formatBytes } from '@/lib/admin/format';
import { formatNumber, formatPersianConsentTimestamp } from '@/lib/i18n/format';
import { EmptyState } from '@/components/EmptyState';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { ErrorNote, Section, StatTile } from '../_components/parts';

type Props = { params: Promise<{ locale: string }> };

const okStyle = 'bg-success-foreground text-success border-success/20';
const badStyle = 'bg-destructive/10 text-destructive border-destructive/20';

export default async function AdminSystemPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale: ADMIN_LOCALE, namespace: 'admin.system' });
  const result = await getAdminSystem();
  if (!result.ok) return <ErrorNote message={result.error} />;
  const { db, services } = result;
  const when = (iso: string) => formatPersianConsentTimestamp(iso, ADMIN_LOCALE);
  const newestBackup = db.backups[0]?.finished_at ?? null;
  const stale = backupIsStale(newestBackup);
  // FR-77 v2: the copies on the owner's Mac. Older databases have no offsite block.
  const offsite = db.offsite ?? { last_report: null, newest_file: null, missing: [], mismatched: [] };
  const offsiteStale = backupIsStale(offsite.last_report);
  const offsiteBad = offsiteStale || offsite.missing.length > 0 || offsite.mismatched.length > 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title={t('version')} testId="admin-version">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">{t('commit')}</dt>
            <dd dir="ltr" className="font-mono text-xs">{result.version.slice(0, 12)}</dd>
            {result.builtAt && (<><dt className="text-muted-foreground">{t('built')}</dt><dd>{when(result.builtAt)}</dd></>)}
            <dt className="text-muted-foreground">{t('postgres')}</dt>
            <dd dir="ltr">{db.postgres_version}</dd>
          </dl>
        </Section>
        <Section title={t('services')} testId="admin-services">
          <ul className="flex flex-col gap-2 text-sm">
            {services.map((s) => (
              <li key={s.name} className="flex items-center justify-between gap-3">
                <span>{t(s.name)}</span>
                <span className="flex items-center gap-2">
                  {s.ms !== null && <span className="text-xs text-muted-foreground">{t('ms', { ms: formatNumber(s.ms, ADMIN_LOCALE) })}</span>}
                  <Badge variant="outline" className={s.ok ? okStyle : badStyle}>{s.ok ? t('up') : t('down')}</Badge>
                </span>
              </li>
            ))}
          </ul>
        </Section>
      </div>

      <Section title={t('backups')} testId="admin-backups">
        {db.backups.length === 0 ? (
          <EmptyState message={t('backupsNone')} />
        ) : (
          <div className="flex flex-col gap-3">
            <p className={cn('text-sm font-medium', stale ? 'text-destructive' : 'text-success')} role={stale ? 'alert' : undefined}>
              {stale ? t('backupStale') : t('backupFresh')}
            </p>
            <ul className="divide-y divide-muted text-sm">
              {db.backups.map((b) => (
                <li key={b.file_name} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span dir="ltr" className="font-mono text-xs">{b.file_name}</span>
                  <span className="text-xs text-muted-foreground">{formatBytes(b.size_bytes)} · {when(b.finished_at)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-4 flex flex-col gap-1.5 border-t border-muted pt-3 text-sm" data-testid="admin-offsite">
          <p className="font-medium">{t('offsite')}</p>
          {offsite.last_report === null ? (
            <p className="text-destructive" role="alert">{t('offsiteNone')}</p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                {t('offsiteLast', { time: when(offsite.last_report), file: offsite.newest_file ?? '—' })}
              </p>
              {offsiteStale && <p className="text-destructive" role="alert">{t('offsiteStale')}</p>}
              {offsite.missing.length > 0 && (
                <p className="text-destructive" role="alert">
                  {t('offsiteMissing', { count: offsite.missing.length, files: offsite.missing.join(', ') })}
                </p>
              )}
              {offsite.mismatched.length > 0 && (
                <p className="text-destructive" role="alert">{t('offsiteMismatch', { files: offsite.mismatched.join(', ') })}</p>
              )}
              {!offsiteBad && <p className="text-success">{t('offsiteOk')}</p>}
            </>
          )}
        </div>
      </Section>

      <Section title={t('jobs')} testId="admin-jobs">
        {db.jobs.length === 0 ? <EmptyState message={t('jobsNone')} /> : (
          <ul className="divide-y divide-muted text-sm">
            {db.jobs.map((j) => (
              <li key={j.jobname} className="flex flex-col gap-1 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span dir="ltr" className="font-mono text-xs">{j.jobname}</span>
                  <span dir="ltr" className="text-xs text-muted-foreground">{j.schedule}</span>
                  {j.last_status && (
                    <Badge variant="outline" className={j.last_status === 'succeeded' ? okStyle : badStyle}>
                      {j.last_status === 'succeeded' ? t('jobOk') : t('jobFailed')}
                    </Badge>
                  )}
                  {j.failures_24h > 0 && <span className="text-xs text-destructive">{t('failures', { count: j.failures_24h })}</span>}
                </div>
                <p className="text-xs text-muted-foreground">
                  {j.last_start ? t('lastRun', { time: when(j.last_start) }) : t('neverRun')}
                  {j.last_status && j.last_status !== 'succeeded' && j.last_message ? ` · ${j.last_message}` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title={t('database')} testId="admin-database">
          <div className="mb-4 grid grid-cols-2 gap-3">
            <StatTile label={t('size')} value={formatBytes(db.database_bytes)} />
          </div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">{t('tables')}</p>
          <ul className="divide-y divide-muted text-sm">
            {db.tables.map((tb) => (
              <li key={tb.name} className="flex items-center justify-between gap-3 py-1.5">
                <span dir="ltr" className="truncate font-mono text-xs">{tb.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {t('rows', { count: formatNumber(tb.rows, ADMIN_LOCALE) })} · {formatBytes(tb.bytes)}
                </span>
              </li>
            ))}
          </ul>
        </Section>
        <Section title={t('migrations')} testId="admin-migrations">
          {db.migration_count === 0 ? <EmptyState message={t('migrationsNone')} /> : (
            <>
              <p className="mb-2 text-xs text-muted-foreground">{t('migrationCount', { count: db.migration_count })}</p>
              <ul className="divide-y divide-muted text-sm">
                {db.migrations.map((m) => (
                  <li key={m.filename} dir="ltr" className="truncate py-1.5 font-mono text-xs">{m.filename}</li>
                ))}
              </ul>
            </>
          )}
        </Section>
      </div>
    </div>
  );
}
