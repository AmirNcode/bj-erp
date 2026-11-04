/** FR-77 admin panel › Audit log: filterable public.audit_log; secrets arrive already hidden. */
import { ADMIN_LOCALE } from '@/lib/admin/locale';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getAuditLog, getAuditPeople } from '@/lib/actions/admin';
import { AUDIT_PAGE_SIZE, OVERVIEW_RANGES, parsePage } from '@/lib/admin/format';
import { todayInAppTz } from '@/lib/appDate';
import { addDays } from '@/lib/leave/isoDate';
import { formatPersianConsentTimestamp } from '@/lib/i18n/format';
import { nativeSelectClass } from '@/lib/native-select';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { ErrorNote, Pager, Section } from '../_components/parts';
import { AuditPersonFilters } from './AuditPersonFilters';
import { AuditRows } from './AuditRows';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || null;

export default async function AdminAuditPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const rangeParam = Number(one(sp.range));
  const range = (OVERVIEW_RANGES as readonly number[]).includes(rangeParam) ? rangeParam : null;
  const entity = one(sp.entity);
  const action = one(sp.action);
  const uuid = (v: string | null) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : null);
  const actor = uuid(one(sp.actor));
  const about = uuid(one(sp.about));
  const page = parsePage(sp.page);
  const t = await getTranslations({ locale: ADMIN_LOCALE, namespace: 'admin' });
  const today = todayInAppTz();
  const [result, roster] = await Promise.all([
    getAuditLog({ from: range ? addDays(today, -(range - 1)) : null, to: null, entity, action, actor, target: about, page }),
    getAuditPeople(),
  ]);
  if (!result.ok) return <ErrorNote message={result.error} />;
  if (!roster.ok) return <ErrorNote message={roster.error} />;
  const { log } = result;
  const pages = Math.max(1, Math.ceil(log.total / AUDIT_PAGE_SIZE));
  const times = Object.fromEntries(log.rows.map((r) => [r.id, formatPersianConsentTimestamp(r.created_at, ADMIN_LOCALE)]));
  const href = (p: number) => {
    const q = new URLSearchParams();
    if (range) q.set('range', String(range));
    if (entity) q.set('entity', entity);
    if (action) q.set('action', action);
    if (actor) q.set('actor', actor);
    if (about) q.set('about', about);
    if (p > 1) q.set('page', String(p));
    const qs = q.toString();
    return `/${locale}/admin/audit${qs ? `?${qs}` : ''}`;
  };

  return (
    <Section title={t('tabs.audit')} testId="admin-audit"
      action={<span className="text-xs text-muted-foreground">{t('audit.total', { count: log.total })}</span>}>
      <form method="get" className="mb-4 grid gap-3 sm:grid-cols-3 sm:items-end">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t('audit.range')}
          <select name="range" defaultValue={range ? String(range) : ''} className={nativeSelectClass}>
            <option value="">{t('audit.rAll')}</option>
            {OVERVIEW_RANGES.map((r) => <option key={r} value={r}>{t(`range.r${r}`)}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t('audit.entity')}
          <select name="entity" defaultValue={entity ?? ''} className={nativeSelectClass} dir="ltr">
            <option value="">{t('audit.all')}</option>
            {log.entities.sort().map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t('audit.action')}
          <select name="action" defaultValue={action ?? ''} className={nativeSelectClass} dir="ltr">
            <option value="">{t('audit.all')}</option>
            {log.actions.sort().map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <AuditPersonFilters people={roster.people} actor={actor} about={about} />
        <div className="flex gap-2">
          <Button type="submit" variant="outline">{t('audit.filter')}</Button>
          {(range || entity || action || actor || about) && (
            <Button asChild variant="ghost"><a href={`/${locale}/admin/audit`}>{t('audit.clear')}</a></Button>
          )}
        </div>
      </form>
      {about && <p className="-mt-2 mb-4 text-xs text-muted-foreground">{t('audit.aboutGap')}</p>}
      {log.rows.length === 0 ? <EmptyState message={t('audit.empty')} /> : (
        <>
          <AuditRows rows={log.rows} times={times} />
          <Pager page={page} pages={pages} hrefFor={href}
            labels={{ newer: t('pager.newer'), older: t('pager.older'), page: t('pager.page', { page, pages }) }} />
        </>
      )}
    </Section>
  );
}
