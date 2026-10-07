/**
 * Clearance forms (FR-54, فرم تسویه حساب). Admin and hr reach it from Manage ›
 * Employees; signers and finance from the Home notice. Its own path, outside
 * Manage, because signers, finance and the leaver may not enter Manage.
 *
 * Sections: what waits on the caller's signature, the caller's own form (as the
 * leaver), and every other form they may read (all of them for admin, hr and
 * finance; the ones they sign for everyone else).
 */

export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getClearanceOverview, type ClearanceListItem } from '@/lib/actions/clearance';
import { formatCalendarDate } from '@/lib/leave/calendarMonth';
import { formatNumber } from '@/lib/i18n/format';
import { PageHeader } from '../_components/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ClearanceStatus } from './_components/ClearanceStatus';

type Props = { params: Promise<{ locale: string }> };

export default async function ClearanceListPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('clearance');
  const res = await getClearanceOverview();

  const statusLabel = {
    in_progress: t('status.in_progress'),
    awaiting_finance: t('status.awaiting_finance'),
    completed: t('status.completed'),
    cancelled: t('status.cancelled'),
  };
  const reasonLabel = {
    resignation: t('reasons.resignation'),
    dismissal: t('reasons.dismissal'),
    contract_end: t('reasons.contract_end'),
    abandonment: t('reasons.abandonment'),
    redundancy: t('reasons.redundancy'),
  };

  const list = (items: ClearanceListItem[], testId: string) =>
    items.length === 0 ? (
      <p className="text-sm text-muted-foreground">{t('sections.empty')}</p>
    ) : (
      <ul className="divide-y divide-border" data-testid={testId}>
        {items.map((f) => (
          <li key={f.id}>
            <Link
              href={`/${locale}/clearance/${f.id}`}
              className="flex items-center justify-between gap-3 py-3 hover:bg-muted/40"
              data-testid={`clearance-item-${f.id}`}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">
                  {f.employeeName}
                  {f.personnelNo ? (
                    <span className="ms-2 font-mono text-xs text-muted-foreground">{f.personnelNo}</span>
                  ) : null}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {reasonLabel[f.reason]} · {t('fields.lastWorkingDay')}{' '}
                  {formatCalendarDate(f.lastWorkingDay, locale)} ·{' '}
                  {t('fields.rowsProgress', {
                    signed: formatNumber(f.rowsSigned, locale),
                    total: formatNumber(f.rowsTotal, locale),
                  })}
                </span>
              </span>
              <ClearanceStatus status={f.status} label={statusLabel[f.status]} />
            </Link>
          </li>
        ))}
      </ul>
    );

  return (
    <main className="p-4 max-w-2xl mx-auto space-y-4">
      <PageHeader title={t('title')} />
      {res.ok && res.canManage && (
        <Link href={`/${locale}/manage/employees`} className="block text-sm text-primary hover:underline">
          {t('back')}
        </Link>
      )}

      {!res.ok ? (
        <p role="alert" className="text-sm text-destructive">
          {res.error}
        </p>
      ) : (
        <>
          {res.canManage && (
            <div className="flex flex-wrap gap-2">
              <Button asChild data-testid="clearance-new">
                <Link href={`/${locale}/clearance/new`}>{t('newForm')}</Link>
              </Button>
              <Button asChild variant="outline" data-testid="clearance-units">
                <Link href={`/${locale}/clearance/units`}>{t('defaultRows')}</Link>
              </Button>
            </div>
          )}

          <Card>
            <CardHeader className="border-b pb-4">
              <CardTitle>{t('sections.awaiting')}</CardTitle>
            </CardHeader>
            <CardContent className="pt-2">{list(res.awaiting, 'clearance-awaiting')}</CardContent>
          </Card>

          {res.mine.length > 0 && (
            <Card>
              <CardHeader className="border-b pb-4">
                <CardTitle>{t('sections.mine')}</CardTitle>
              </CardHeader>
              <CardContent className="pt-2">{list(res.mine, 'clearance-mine')}</CardContent>
            </Card>
          )}

          {(res.canViewAll || res.others.length > 0) && (
            <Card>
              <CardHeader className="border-b pb-4">
                <CardTitle>{res.canViewAll ? t('sections.others') : t('sections.related')}</CardTitle>
              </CardHeader>
              <CardContent className="pt-2">{list(res.others, 'clearance-others')}</CardContent>
            </Card>
          )}
        </>
      )}
    </main>
  );
}
