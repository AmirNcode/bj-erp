/**
 * Requests for finance (FR-62) — finance read (FR-55: the finance and hr
 * presets; the admin implicitly).
 *
 * Every approved and pending request overlapping a Jalali month range, in two
 * sections with their own totals, with the per diem HR entered on errands and
 * FR-70 travel costs, and a CSV export of both. The range is a URL
 * parameter like the reports screen's, defaulting to the current month.
 */

export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getCachedUser, getCachedPermissions } from '@/lib/auth/context';
import { can } from '@/lib/permissions/catalog';
import { getFinanceApprovals } from '@/lib/actions/finance';
import { getReportMonths } from '@/lib/actions/reports';
import { getWorkSettings } from '@/lib/actions/leave/reference';
import { WORK_SETTINGS_FALLBACK } from '@/lib/leave/workSettings';
import { todayInAppTz } from '@/lib/appDate';
import { PageHeader } from '../_components/PageHeader';
import { FinanceList } from './FinanceList';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export default async function FinancePage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await getCachedUser();
  if (!user) redirect(`/${locale}/login`);
  const perms = await getCachedPermissions(user.id);
  if (!can(perms, 'finance', 'read')) redirect(`/${locale}/home`);

  const [t, months, settings] = await Promise.all([
    getTranslations('finance'),
    getReportMonths(),
    getWorkSettings(),
  ]);
  const today = todayInAppTz();
  const current = months.find((m) => m.gregorianStart <= today && m.gregorianEnd >= today);
  const { from: rawFrom, to: rawTo } = await searchParams;
  const from = rawFrom && ISO.test(rawFrom) ? rawFrom : current?.gregorianStart ?? today;
  const to = rawTo && ISO.test(rawTo) ? rawTo : current?.gregorianEnd ?? today;

  const result = await getFinanceApprovals(from, to);
  const hoursPerDay = settings.ok ? settings.settings.hoursPerDay : WORK_SETTINGS_FALLBACK.hoursPerDay;

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col">
      <PageHeader title={t('title')} />
      {result.ok ? (
        <FinanceList
          rows={result.rows}
          months={months}
          from={from}
          to={to}
          locale={locale}
          hoursPerDay={hoursPerDay}
        />
      ) : (
        <p role="alert" className="text-sm text-destructive" data-testid="finance-error">
          {result.error}
        </p>
      )}
    </div>
  );
}
